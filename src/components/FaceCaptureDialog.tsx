import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScanFace, Loader2, CheckCircle2, AlertTriangle, RotateCcw, SwitchCamera, ShieldAlert } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { loadFaceModels, detectFaceWithDescriptor } from '@/lib/faceEngine'
import { describeGetUserMediaError, sampleCanvasBrightness } from '@/lib/cameraHelpers'
import { cn } from '@/lib/utils'

interface FaceCaptureDialogProps {
  open: boolean
  memberName: string
  onOpenChange: (open: boolean) => void
  onCaptured: (descriptor: number[], photo: string) => void
}

type Stage = 'loading-models' | 'camera-error' | 'scanning' | 'captured'
type OverlayBox = { x: number; y: number; width: number; height: number } | null

export default function FaceCaptureDialog({ open, memberName, onOpenChange, onCaptured }: FaceCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectRafRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const overlayRef = useRef<OverlayBox>(null)
  const framesPaintedRef = useRef(0)
  const brightnessSamplesRef = useRef<number[]>([])

  const [stage, setStage] = useState<Stage>('loading-models')
  const [errorMsg, setErrorMsg] = useState('')
  const [captured, setCaptured] = useState<{ descriptor: number[]; photo: string } | null>(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined)
  const [trackMuted, setTrackMuted] = useState(false)
  const [noFrames, setNoFrames] = useState(false)
  const [blackFrames, setBlackFrames] = useState(false)

  const refreshDeviceList = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'videoinput'))
    } catch {
      // non-critical: the camera switcher just won't show if this fails
    }
  }, [])

  // Paints video frames onto a visible canvas every animation frame
  // instead of relying on the browser to render a CSS-transformed
  // <video> element directly — see FaceScanner.tsx for why.
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
        const box = overlayRef.current
        if (box) {
          ctx.strokeStyle = '#14b8a6'
          ctx.lineWidth = 3
          ctx.strokeRect(box.x, box.y, box.width, box.height)
        }
        ctx.restore()
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

  const startCamera = useCallback(
    async (deviceId?: string, isRetryWithoutConstraints = false) => {
      setStage('loading-models')
      setErrorMsg('')
      setTrackMuted(false)
      setNoFrames(false)
      setBlackFrames(false)
      framesPaintedRef.current = 0
      brightnessSamplesRef.current = []
      try {
        await loadFaceModels()
      } catch {
        setErrorMsg(
          'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ (อาจเกิดจากข้อจำกัดเครือข่ายในหน้าตัวอย่างนี้) กรุณารันโปรเจกต์นี้ภายนอกเพื่อใช้งานกล้องจริง หรือใช้การเช็คอินแบบ Manual แทน'
        )
        setStage('camera-error')
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
        setStage('scanning')
        refreshDeviceList()
        detectLoop()
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
        const name = err instanceof DOMException ? err.name : ''
        if (deviceId && !isRetryWithoutConstraints && (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError')) {
          startCamera(undefined, true)
          return
        }
        setErrorMsg(describeGetUserMediaError(err))
        setStage('camera-error')
      }
    },
    [refreshDeviceList]
  )

  useEffect(() => {
    if (!open) return
    setCaptured(null)
    setErrorMsg('')
    startCamera()
    paintRafRef.current = requestAnimationFrame(paintLoop)

    return () => {
      if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current)
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function detectLoop() {
    async function tick() {
      const video = videoRef.current
      if (!video || video.readyState < 2) {
        detectRafRef.current = requestAnimationFrame(tick)
        return
      }
      try {
        const result = await detectFaceWithDescriptor(video)
        setFaceDetected(!!result)
        overlayRef.current = result?.box ?? null
      } catch {
        // keep looping silently; transient detection errors are common
      }
      detectRafRef.current = requestAnimationFrame(tick)
    }
    detectRafRef.current = requestAnimationFrame(tick)
  }

  async function handleCapture() {
    const video = videoRef.current
    if (!video) return
    const result = await detectFaceWithDescriptor(video)
    if (!result) {
      setErrorMsg('ไม่พบใบหน้าในเฟรมนี้ กรุณาจัดใบหน้าให้อยู่ตรงกลางกล้องแล้วลองใหม่')
      return
    }
    // Mirror the still capture to match the selfie-view preview the user saw live.
    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = video.videoWidth
    snapCanvas.height = video.videoHeight
    const ctx = snapCanvas.getContext('2d')
    if (ctx) {
      ctx.translate(snapCanvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0)
    }
    const photo = snapCanvas.toDataURL('image/jpeg', 0.85)
    setCaptured({ descriptor: Array.from(result.descriptor), photo })
    setStage('captured')
    if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  function handleConfirm() {
    if (!captured) return
    onCaptured(captured.descriptor, captured.photo)
    onOpenChange(false)
  }

  function handleRetake() {
    setCaptured(null)
    startCamera(activeDeviceId)
  }

  const showFrameWarning = stage === 'scanning' && (trackMuted || noFrames || blackFrames)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-primary" />
            ลงทะเบียนใบหน้า
          </DialogTitle>
          <DialogDescription>สำหรับสมาชิก: {memberName}</DialogDescription>
        </DialogHeader>

        {stage === 'scanning' && devices.length > 1 && (
          <Select value={activeDeviceId} onValueChange={(id) => startCamera(id)}>
            <SelectTrigger className="h-8 text-xs">
              <SwitchCamera className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="เลือกกล้อง" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((d, i) => (
                <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
                  {d.label || `กล้อง ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
          {stage === 'loading-models' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">กำลังเตรียมกล้องและโมเดล...</p>
            </div>
          )}

          {stage === 'camera-error' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 overflow-y-auto p-4 text-center text-white/80">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {/* <video> is only a decode source for the paint loop; the visible
              surface is always the canvas below (except for the final
              still photo once captured). */}
          <video
            ref={videoRef}
            muted
            playsInline
            webkit-playsinline="true"
            className="absolute -left-full -top-full h-px w-px opacity-0"
          />

          {(stage === 'scanning' || stage === 'captured') && (
            <>
              <canvas
                ref={canvasRef}
                className={cn('h-full w-full object-cover', stage === 'captured' && captured && 'hidden')}
              />
              {captured && stage === 'captured' && (
                <img src={captured.photo} className="h-full w-full object-cover" alt="ใบหน้าที่บันทึก" />
              )}
              {stage === 'scanning' && !showFrameWarning && (
                <div
                  className={cn(
                    'absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium backdrop-blur',
                    faceDetected ? 'bg-emerald-500/90 text-white' : 'bg-black/50 text-white/80'
                  )}
                >
                  {faceDetected ? 'ตรวจพบใบหน้า พร้อมถ่ายภาพ' : 'กำลังค้นหาใบหน้า...'}
                </div>
              )}
              {stage === 'captured' && (
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-medium text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" /> บันทึกใบหน้าแล้ว
                </div>
              )}
            </>
          )}

          {showFrameWarning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-slate-900/95 p-4 text-center">
              <ShieldAlert className="h-6 w-6 shrink-0 text-amber-400" />
              {blackFrames && !noFrames && !trackMuted ? (
                <p className="text-xs leading-relaxed text-white/90">
                  กล้องเชื่อมต่อและส่งภาพมาจริง แต่เนื้อหาของภาพเป็นสีดำสนิท — ไม่ใช่ปัญหาจากตัวแอปนี้
                  แต่เป็นระบบปฏิบัติการหรือซอฟต์แวร์ความปลอดภัยของเครื่องนี้เองที่ปิดกั้นภาพจริงไว้
                  แนะนำให้ปิดหน้าต่างนี้แล้วใช้เช็คอินแบบ Manual แทนสำหรับเครื่องนี้ไปก่อน
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-white/90">
                  เชื่อมต่อกล้องสำเร็จแต่ไม่มีสัญญาณภาพส่งมา มักเกิดจากซอฟต์แวร์ป้องกันเว็บแคมบล็อกไว้
                  ลองปิดการป้องกันชั่วคราว หรือปิดหน้าต่างนี้แล้วใช้เช็คอินแบบ Manual แทน
                </p>
              )}
            </div>
          )}
        </div>

        {stage === 'scanning' && !showFrameWarning && (
          <p className="text-center text-xs text-muted-foreground">
            ถ้าภาพเป็นสีดำสนิท ลองเลือกกล้องอื่นจากเมนูด้านบน (บางเครื่องมีกล้อง IR สำหรับ Windows Hello ด้วย)
          </p>
        )}

        {errorMsg && stage === 'scanning' && (
          <p className="text-center text-xs text-destructive">{errorMsg}</p>
        )}

        <DialogFooter className="gap-2 sm:justify-center">
          {stage === 'scanning' && (
            <Button onClick={handleCapture} disabled={!faceDetected} className="gap-1.5">
              <ScanFace className="h-4 w-4" /> ถ่ายภาพและบันทึก
            </Button>
          )}
          {stage === 'captured' && (
            <>
              <Button variant="outline" onClick={handleRetake} className="gap-1.5">
                <RotateCcw className="h-4 w-4" /> ถ่ายใหม่
              </Button>
              <Button onClick={handleConfirm} className="gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> ยืนยันการลงทะเบียน
              </Button>
            </>
          )}
          {stage === 'camera-error' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              ปิดหน้าต่าง
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
