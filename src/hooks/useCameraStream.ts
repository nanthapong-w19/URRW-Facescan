import { useCallback, useEffect, useRef, useState } from 'react'
import { loadFaceModels } from '@/lib/faceEngine'
import { describeGetUserMediaError, sampleCanvasBrightness } from '@/lib/cameraHelpers'

// Camera-lifecycle module (see CONTEXT.md "Camera stream"): permission
// request, device enumeration/switching, the OverconstrainedError
// retry-without-constraints fallback, the noFrames/blackFrames/trackMuted
// diagnostics, and the mirrored canvas paint loop. Knows nothing about face
// recognition — callers set whatever overlay they want painted via `paint()`.

export type CameraState = 'idle' | 'loading' | 'ready' | 'error'

export interface CameraOverlay {
  box: { x: number; y: number; width: number; height: number }
  color: string
  label?: string
}

const DEFAULT_MODEL_LOAD_ERROR =
  'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ อาจเกิดจากข้อจำกัดเครือข่าย กรุณาลองใหม่อีกครั้ง หรือใช้การเช็คอินแบบ Manual แทน'

export interface UseCameraStreamOptions {
  // Overrides the generic model-load failure message — each screen has a
  // different fallback action available (manual check-in, employee-ID
  // login, etc.), so the copy naming that fallback stays caller-supplied.
  modelLoadErrorMessage?: string
}

export function useCameraStream(options: UseCameraStreamOptions = {}) {
  const { modelLoadErrorMessage = DEFAULT_MODEL_LOAD_ERROR } = options

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const overlayRef = useRef<CameraOverlay | null>(null)
  const framesPaintedRef = useRef(0)
  const brightnessSamplesRef = useRef<number[]>([])

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined)
  const [trackMuted, setTrackMuted] = useState(false)
  const [noFrames, setNoFrames] = useState(false)
  const [blackFrames, setBlackFrames] = useState(false)

  // Labels are only populated once permission has been granted at least
  // once, so this is called again right after a successful getUserMedia.
  const refreshDeviceList = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'videoinput'))
    } catch {
      // non-critical: the camera switcher just won't show if this fails
    }
  }, [])

  // Continuously paints the current video frame onto a visible <canvas>
  // (mirrored), plus whatever overlay box/label the caller last set via
  // `paint()`, instead of relying on the browser to composite a raw
  // <video> element with a CSS transform. Some Chromium/GPU/driver
  // combinations on Windows fail to paint a transformed <video> element at
  // all (renders solid black) even though the underlying MediaStream is
  // perfectly valid — drawing frames through a 2D canvas sidesteps that
  // rendering path entirely and is far more consistent across devices.
  const paintLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const overlay = overlayRef.current
        if (overlay) {
          ctx.strokeStyle = overlay.color
          ctx.lineWidth = 4
          ctx.strokeRect(overlay.box.x, overlay.box.y, overlay.box.width, overlay.box.height)
        }
        ctx.restore()

        // Name label above the box — box coordinates come from the
        // un-mirrored detector, so the label's x has to be mirrored
        // separately to line up with the mirrored box drawn above.
        if (overlay?.label) {
          const { box, color, label } = overlay
          const mirroredX = canvas.width - box.x - box.width
          ctx.font = '600 20px "IBM Plex Sans Thai", "IBM Plex Sans", sans-serif'
          const textWidth = ctx.measureText(label).width
          ctx.fillStyle = color
          ctx.fillRect(mirroredX - 2, box.y - 34, textWidth + 16, 30)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(label, mirroredX + 6, box.y - 11)
        }

        framesPaintedRef.current += 1
        if (framesPaintedRef.current % 15 === 0) {
          const brightness = sampleCanvasBrightness(canvas)
          if (brightness !== null) {
            const samples = brightnessSamplesRef.current
            samples.push(brightness)
            if (samples.length > 8) samples.shift()
          }
        }
      }
    }
    paintRafRef.current = requestAnimationFrame(paintLoop)
  }, [])

  const start = useCallback(
    async (deviceId?: string, isRetryWithoutConstraints = false) => {
      setCameraState('loading')
      setErrorMsg('')
      setTrackMuted(false)
      setNoFrames(false)
      setBlackFrames(false)
      framesPaintedRef.current = 0
      brightnessSamplesRef.current = []
      try {
        await loadFaceModels()
      } catch {
        setErrorMsg(modelLoadErrorMessage)
        setCameraState('error')
        return
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId && !isRetryWithoutConstraints ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const track = stream.getVideoTracks()[0]
        setActiveDeviceId(track?.getSettings().deviceId ?? deviceId)
        if (track) {
          setTrackMuted(track.muted)
          track.onmute = () => setTrackMuted(true)
          track.onunmute = () => setTrackMuted(false)
        }
        setCameraState('ready')
        refreshDeviceList()

        // A few seconds in, check two distinct failure modes that both
        // *look* like "black screen" to the user but need different fixes:
        // 1. The paint loop never received a single real frame at all.
        // 2. Frames ARE being decoded and painted, but their content is
        //    consistently near-black — the camera/OS/security software is
        //    delivering genuine blackout frames, unfixable from app code.
        window.setTimeout(() => {
          const painted = framesPaintedRef.current
          setNoFrames(painted === 0)
          if (painted > 0) {
            const samples = brightnessSamplesRef.current
            const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0
            setBlackFrames(avg < 8)
          }
        }, 3000)
      } catch (err) {
        // If a specific camera device fails with "overconstrained" (e.g.
        // it disappeared, or its exact deviceId is no longer valid),
        // automatically retry once with plain default constraints instead
        // of just showing an error — covers a lot of "works on some
        // devices, not others" cases without the user needing to do anything.
        const name = err instanceof DOMException ? err.name : ''
        if (deviceId && !isRetryWithoutConstraints && (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError')) {
          start(undefined, true)
          return
        }
        setErrorMsg(describeGetUserMediaError(err))
        setCameraState('error')
      }
    },
    [refreshDeviceList, modelLoadErrorMessage]
  )

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraState('idle')
  }, [])

  const paint = useCallback((overlay: CameraOverlay | null) => {
    overlayRef.current = overlay
  }, [])

  useEffect(() => {
    paintRafRef.current = requestAnimationFrame(paintLoop)
    return () => {
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    videoRef,
    canvasRef,
    cameraState,
    errorMsg,
    devices,
    activeDeviceId,
    trackMuted,
    noFrames,
    blackFrames,
    start,
    stop,
    paint,
  }
}

export type CameraStream = ReturnType<typeof useCameraStream>
