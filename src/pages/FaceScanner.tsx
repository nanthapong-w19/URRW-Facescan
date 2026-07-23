import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import {
  ScanFace,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Camera,
  CameraOff,
  Search,
  SwitchCamera,
  ShieldAlert,
  Eye,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppData } from '@/hooks/useAppData'
import { recordCheckin, hasCheckedInToday } from '@/lib/store'
import {
  loadFaceModels,
  detectFaceWithDescriptor,
  descriptorDistance,
  distanceToConfidence,
  MATCH_THRESHOLD,
  averageEyeAspectRatio,
  EAR_BLINK_THRESHOLD,
} from '@/lib/faceEngine'
import { describeGetUserMediaError, sampleCanvasBrightness } from '@/lib/cameraHelpers'
import type { Member } from '@/lib/types'
import { cn } from '@/lib/utils'

type CameraState = 'idle' | 'loading' | 'ready' | 'error'
type ScanFeedback = { kind: 'success' | 'unknown'; name?: string; department?: string } | null
type OverlayBox = { box: { x: number; y: number; width: number; height: number }; color: string; label: string } | null

// Plays a short, pleasant two-tone chime using the Web Audio API so no
// external audio asset needs to be bundled.
function playSuccessChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.12)
      gain.gain.linearRampToValueAtTime(0.2, now + i * 0.12 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.12)
      osc.stop(now + i * 0.12 + 0.32)
    })
  } catch {
    // audio isn't critical to the flow; ignore failures silently
  }
}

const SCAN_INTERVAL_MS = 500
const REPEAT_COOLDOWN_MS = 15000
// How long a detected blink keeps the tracked face "live" for. Wide enough
// to bridge a couple of scan ticks around the blink itself, short enough
// that holding up a static photo can't coast on a single lucky detection.
const LIVENESS_VALID_MS = 4000

export default function FaceScanner() {
  const { members, checkins } = useAppData()
  const registeredMembers = useMemo(() => members.filter((m) => m.faceStatus === 'registered'), [members])

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const lastCheckinRef = useRef<Record<string, number>>({})
  const overlayRef = useRef<OverlayBox>(null)
  const framesPaintedRef = useRef(0)
  const brightnessSamplesRef = useRef<number[]>([])
  const livenessRef = useRef<{ eyesClosed: boolean; blinkAt: number | null }>({
    eyesClosed: false,
    blinkAt: null,
  })

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [feedback, setFeedback] = useState<ScanFeedback>(null)
  const [manualQuery, setManualQuery] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined)
  const [trackMuted, setTrackMuted] = useState(false)
  const [noFrames, setNoFrames] = useState(false)
  const [blackFrames, setBlackFrames] = useState(false)
  const [waitingForBlink, setWaitingForBlink] = useState(false)

  // Refreshes the labeled device list — labels are only populated once
  // permission has been granted at least once, so this is called again
  // right after a successful getUserMedia.
  const refreshDeviceList = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'videoinput'))
    } catch {
      // non-critical: the camera switcher just won't show if this fails
    }
  }, [])

  // Continuously paints the current video frame onto a visible <canvas>
  // (mirrored) instead of relying on the browser to composite a raw
  // <video> element with a CSS transform. Some Chromium/GPU/driver
  // combinations on Windows fail to paint a transformed <video> element
  // at all (renders solid black) even though the underlying MediaStream
  // is perfectly valid — drawing frames through a 2D canvas sidesteps
  // that rendering path entirely and is far more consistent across
  // devices/browsers.
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
          const { box, color } = overlay
          ctx.strokeStyle = color
          ctx.lineWidth = 4
          ctx.strokeRect(box.x, box.y, box.width, box.height)
        }
        ctx.restore()

        if (overlay) {
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

  const startCamera = useCallback(
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
        setErrorMsg(
          'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ อาจเกิดจากข้อจำกัดเครือข่ายของหน้าตัวอย่างนี้ กรุณารันโปรเจกต์นี้ในเครื่องของคุณเพื่อใช้กล้องจริง หรือใช้ "เช็คอินแบบ Manual" ด้านล่างแทนได้ทันที'
        )
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
        // 1. The paint loop never received a single real frame at all
        //    (stream "open" but literally nothing decoded yet).
        // 2. Frames ARE being decoded and painted, but their content is
        //    consistently near-black — the camera/OS/security software is
        //    delivering genuine blackout frames. No web app code can fix
        //    that; it needs to be resolved on the OS/driver/antivirus side.
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
        // of just showing an error — this covers a lot of "works on some
        // devices, not others" cases without the user needing to do anything.
        const name = err instanceof DOMException ? err.name : ''
        if (deviceId && !isRetryWithoutConstraints && (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError')) {
          startCamera(undefined, true)
          return
        }
        setErrorMsg(describeGetUserMediaError(err))
        setCameraState('error')
      }
    },
    [refreshDeviceList]
  )

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraState('idle')
  }, [])

  useEffect(() => {
    startCamera()
    paintRafRef.current = requestAnimationFrame(paintLoop)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Main detection loop — throttled independently of the paint loop above.
  useEffect(() => {
    if (cameraState !== 'ready') return

    timerRef.current = window.setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      let result
      try {
        result = await detectFaceWithDescriptor(video)
      } catch {
        return
      }
      if (!result) {
        overlayRef.current = null
        livenessRef.current = { eyesClosed: false, blinkAt: null }
        setWaitingForBlink(false)
        return
      }

      let best: { member: Member; distance: number } | null = null
      for (const m of registeredMembers) {
        if (!m.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, m.faceDescriptor)
        if (!best || distance < best.distance) best = { member: m, distance }
      }

      // Lightweight liveness check: track eye-aspect-ratio across ticks and
      // require one real blink (closed -> open transition) before trusting
      // a match enough to check someone in. A static photo or frozen video
      // frame held up to the camera will never produce that transition.
      const liveness = livenessRef.current
      const ear = averageEyeAspectRatio(result.landmarks)
      if (ear < EAR_BLINK_THRESHOLD) {
        liveness.eyesClosed = true
      } else if (liveness.eyesClosed) {
        liveness.eyesClosed = false
        liveness.blinkAt = Date.now()
      }
      const isLive = liveness.blinkAt !== null && Date.now() - liveness.blinkAt < LIVENESS_VALID_MS

      const isMatch = best && best.distance < MATCH_THRESHOLD
      overlayRef.current = {
        box: result.box,
        color: isMatch ? (isLive ? '#10b981' : '#3b82f6') : '#f59e0b',
        label: isMatch ? (isLive ? best!.member.name : `${best!.member.name} · กระพริบตา`) : 'ไม่พบในระบบ',
      }
      setWaitingForBlink(Boolean(isMatch) && !isLive)

      if (isMatch && isLive) {
        const member = best!.member
        const lastTime = lastCheckinRef.current[member.id] ?? 0
        const alreadyToday = hasCheckedInToday(checkins, member.id)
        if (Date.now() - lastTime > REPEAT_COOLDOWN_MS && !alreadyToday) {
          lastCheckinRef.current[member.id] = Date.now()
          try {
            await recordCheckin(member, 'face', distanceToConfidence(best!.distance))
            setFeedback({ kind: 'success', name: member.name, department: member.department })
            playSuccessChime()
            toast.success(`เช็คอินสำเร็จ: ${member.name}`, { duration: 3500 })
            window.setTimeout(() => setFeedback(null), 3200)
          } catch (err) {
            // Allow retrying on the next tick instead of getting stuck
            // thinking this member already checked in.
            delete lastCheckinRef.current[member.id]
            toast.error(err instanceof Error ? err.message : 'บันทึกการเช็คอินไม่สำเร็จ')
          }
        }
      }
    }, SCAN_INTERVAL_MS)

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [cameraState, registeredMembers, checkins])

  const manualMatches = useMemo(() => {
    if (!manualQuery.trim()) return []
    const q = manualQuery.trim().toLowerCase()
    return members
      .filter((m) => m.employeeId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 5)
  }, [members, manualQuery])

  async function handleManualCheckin(member: Member) {
    if (hasCheckedInToday(checkins, member.id)) {
      toast.info(`${member.name} เช็คอินไปแล้ววันนี้`)
      setManualQuery('')
      return
    }
    try {
      await recordCheckin(member, 'manual')
      toast.success(`เช็คอินสำเร็จ (Manual): ${member.name}`)
      playSuccessChime()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกการเช็คอินไม่สำเร็จ')
    }
    setManualQuery('')
  }

  const showFrameWarning = cameraState === 'ready' && (trackMuted || noFrames || blackFrames)

  return (
    <div className="space-y-6">
      <PageHeader
        title="สแกนใบหน้าเพื่อเช็คอิน"
        description="จัดใบหน้าให้อยู่ตรงกลางกรอบกล้อง ระบบจะเช็คอินให้อัตโนมัติเมื่อพบข้อมูลตรงกัน"
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        <Card className="border-border/70 shadow-soft md:col-span-3">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="font-display text-base">กล้องสแกนใบหน้า</CardTitle>
              <CardDescription>
                สมาชิกที่ลงทะเบียนใบหน้าแล้ว {registeredMembers.length} / {members.length} คน
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {cameraState === 'ready' && devices.length > 1 && (
                <Select value={activeDeviceId} onValueChange={(id) => startCamera(id)}>
                  <SelectTrigger className="h-8 w-[168px] text-xs">
                    <SwitchCamera className="me-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
              {cameraState === 'ready' ? (
                <Button size="sm" variant="outline" onClick={stopCamera} className="gap-1.5">
                  <CameraOff className="h-3.5 w-3.5" /> ปิดกล้อง
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => startCamera()} className="gap-1.5">
                  <Camera className="h-3.5 w-3.5" /> เปิดกล้อง
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl bg-slate-900">
              {cameraState === 'loading' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                  <Loader2 className="h-7 w-7 animate-spin" />
                  <p className="text-sm">กำลังเตรียมกล้องและโมเดลตรวจจับใบหน้า...</p>
                </div>
              )}
              {cameraState === 'error' && (
                <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center sm:p-6">
                  <AlertTriangle className="h-8 w-8 shrink-0 text-amber-400" />
                  <p className="max-w-sm text-sm leading-relaxed text-white/80">{errorMsg}</p>
                  <Button size="sm" variant="secondary" onClick={() => startCamera()} className="mt-1 shrink-0 gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> ลองอีกครั้ง
                  </Button>
                </div>
              )}

              {/* The <video> element is never shown directly — it's only a
                  decode source for the paint loop above, which draws every
                  frame onto the visible canvas. Keeping it off-screen
                  (rather than display:none) keeps browsers from pausing
                  decode to save power. */}
              <video
                ref={videoRef}
                muted
                playsInline
                webkit-playsinline="true"
                className="absolute -left-full -top-full h-px w-px opacity-0"
              />
              <canvas
                ref={canvasRef}
                className={cn(
                  'h-full w-full object-cover',
                  (cameraState === 'loading' || cameraState === 'error') && 'hidden'
                )}
              />

              {showFrameWarning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-slate-900/95 p-4 text-center sm:p-6">
                  <ShieldAlert className="h-8 w-8 shrink-0 text-amber-400" />
                  {blackFrames && !noFrames && !trackMuted ? (
                    <p className="max-w-sm text-sm leading-relaxed text-white/90">
                      กล้องเชื่อมต่อและส่งภาพมาจริง แต่เนื้อหาของภาพเป็นสีดำสนิท — ไม่ใช่ปัญหาจากตัวแอปนี้
                      แต่เป็นระบบปฏิบัติการหรือซอฟต์แวร์ความปลอดภัยของเครื่องนี้เองที่ปิดกั้นภาพจริงไว้เฉพาะตอนใช้งานผ่านเบราว์เซอร์
                      (พบได้ในบางเครื่องที่มีนโยบายองค์กรหรือแอนตี้ไวรัสควบคุมกล้องอย่างเข้มงวด) แนะนำให้ใช้
                      &quot;เช็คอินแบบ Manual&quot; ด้านขวาแทนสำหรับเครื่องนี้ไปก่อน
                    </p>
                  ) : (
                    <p className="max-w-sm text-sm leading-relaxed text-white/90">
                      เชื่อมต่อกล้องสำเร็จ แต่ไม่มีสัญญาณภาพส่งมาเลย — มักเกิดจากซอฟต์แวร์ป้องกันเว็บแคม (แอนตี้ไวรัส) บล็อกภาพไว้
                      ทั้งที่อนุญาต permission แล้ว หรือกล้องถูกปิดบัง/มีฝาปิดอยู่ ลองปิดการป้องกันเว็บแคมชั่วคราว หรือใช้
                      &quot;เช็คอินแบบ Manual&quot; ด้านขวาแทนได้เลย
                    </p>
                  )}
                </div>
              )}

              {waitingForBlink && !feedback && cameraState === 'ready' && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-blue-600/90 px-4 py-2 text-center text-sm font-medium text-white backdrop-blur-sm">
                  <Eye className="h-4 w-4 shrink-0" /> กระพริบตาเพื่อยืนยันว่าเป็นคนจริง ก่อนเช็คอิน
                </div>
              )}

              {feedback?.kind === 'success' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
                  <CheckCircle2 className="h-14 w-14" />
                  <p className="font-display text-2xl font-bold">เช็คอินสำเร็จ</p>
                  <p className="text-lg">{feedback.name}</p>
                  <p className="text-sm text-white/80">{feedback.department}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft md:col-span-2">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" /> เช็คอินแบบ Manual
            </CardTitle>
            <CardDescription>สำหรับกรณีที่ระบบสแกนใบหน้ามีปัญหา หรือกล้องใช้งานไม่ได้</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="พิมพ์รหัสพนักงานหรือชื่อ"
                className="ps-8"
              />
            </div>

            <div className="min-h-[3rem] space-y-1.5">
              {manualQuery.trim() && manualMatches.length === 0 && (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ไม่พบสมาชิกที่ตรงกัน</p>
              )}
              {manualMatches.map((m) => {
                const checkedIn = hasCheckedInToday(checkins, m.id)
                return (
                  <button
                    key={m.id}
                    onClick={() => handleManualCheckin(m)}
                    disabled={checkedIn}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors',
                      checkedIn ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50 hover:bg-secondary'
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.employeeId} · {m.department}
                      </p>
                    </div>
                    {checkedIn ? (
                      <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                        <CheckCircle2 className="h-3 w-3" /> เช็คอินแล้ว
                      </Badge>
                    ) : (
                      <Badge className="shrink-0 font-normal">เช็คอิน</Badge>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="rounded-xl border border-dashed border-border/70 bg-secondary/40 p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <ScanFace className="h-3.5 w-3.5" /> เคล็ดลับการสแกน
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                <li>ให้แสงส่องหน้าอย่างเพียงพอ หลีกเลี่ยงแสงย้อน</li>
                <li>มองตรงเข้ากล้องและอยู่ห่างประมาณ 40-60 ซม.</li>
                <li>เมื่อระบบพบใบหน้าที่ตรงกัน จะขอให้กระพริบตา 1 ครั้งเพื่อยืนยันว่าเป็นคนจริง (ป้องกันรูปถ่าย/วิดีโอปลอม)</li>
                <li>สมาชิกต้องลงทะเบียนใบหน้าในหน้า &quot;จัดการบุคลากร&quot; ก่อน</li>
                <li>
                  ถ้าภาพจากกล้องยังคงมืดสนิท ลองเลือกกล้องอื่นจากเมนู &quot;เลือกกล้อง&quot; ด้านบนวิดีโอ
                  หรือปิดโปรแกรมป้องกันเว็บแคมชั่วคราว
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
