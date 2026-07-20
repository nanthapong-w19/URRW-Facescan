import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, AlertTriangle, ShieldCheck, Camera } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import { loadFaceModels, detectFaceWithDescriptor, descriptorDistance, MATCH_THRESHOLD } from '@/lib/faceEngine'
import { describeGetUserMediaError } from '@/lib/cameraHelpers'
import type { Member } from '@/lib/types'
import { cn } from '@/lib/utils'

type CameraState = 'idle' | 'loading' | 'ready' | 'error'

const SCAN_INTERVAL_MS = 500

// Face-login page, gated to members with role === 'admin' who have already
// registered a face on the Members page. On a match, records an "admin
// session" (see lib/adminAuth.tsx) that unlocks the meeting-creation
// pages. Includes a manual employee-ID fallback for when the camera isn't
// usable, mirroring the same pattern as the manual check-in flow on
// /scan — with an added role check so a non-admin employee ID can't get in.
export default function Login() {
  const { members } = useAppData()
  const { loginAsAdmin } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/meetings'

  const adminMembers = useMemo(
    () => members.filter((m) => m.role === 'admin' && m.faceStatus === 'registered'),
    [members]
  )

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const matchedRef = useRef(false)

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [matchedName, setMatchedName] = useState<string | null>(null)
  const [manualId, setManualId] = useState('')
  const [manualError, setManualError] = useState('')

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
        ctx.restore()
      }
    }
    paintRafRef.current = requestAnimationFrame(paintLoop)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraState('loading')
    setErrorMsg('')
    try {
      await loadFaceModels()
    } catch {
      setErrorMsg(
        'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ กรุณาใช้ "เข้าสู่ระบบด้วยรหัสบุคลากร" ด้านล่างแทน หรือลองใหม่อีกครั้ง'
      )
      setCameraState('error')
      return
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraState('ready')
    } catch (err) {
      setErrorMsg(describeGetUserMediaError(err))
      setCameraState('error')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  function completeLogin(member: Member) {
    if (matchedRef.current) return
    matchedRef.current = true
    stopCamera()
    setMatchedName(member.name)
    loginAsAdmin(member)
    toast.success(`เข้าสู่ระบบสำเร็จ: ${member.name}`)
    window.setTimeout(() => navigate(redirectTo, { replace: true }), 900)
  }

  useEffect(() => {
    startCamera()
    paintRafRef.current = requestAnimationFrame(paintLoop)
    return () => {
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current)
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (cameraState !== 'ready') return
    timerRef.current = window.setInterval(async () => {
      if (matchedRef.current) return
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      let result
      try {
        result = await detectFaceWithDescriptor(video)
      } catch {
        return
      }
      if (!result) return

      let best: { member: Member; distance: number } | null = null
      for (const m of adminMembers) {
        if (!m.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, m.faceDescriptor)
        if (!best || distance < best.distance) best = { member: m, distance }
      }
      if (best && best.distance < MATCH_THRESHOLD) {
        completeLogin(best.member)
      }
    }, SCAN_INTERVAL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, adminMembers])

  function handleManualLogin() {
    setManualError('')
    const id = manualId.trim()
    if (!id) {
      setManualError('กรุณากรอกรหัสบุคลากร')
      return
    }
    const member = members.find((m) => m.employeeId.toLowerCase() === id.toLowerCase())
    if (!member) {
      setManualError('ไม่พบรหัสบุคลากรนี้ในระบบ')
      return
    }
    if (member.role !== 'admin') {
      setManualError('รหัสบุคลากรนี้ไม่มีสิทธิ์ผู้ดูแลระบบ (admin)')
      return
    }
    completeLogin(member)
  }

  return (
    // Breaks out of <main>'s max-w-7xl/px-*/py-8 box to a true edge-to-edge,
    // full-viewport-height hero — this is the site's home/kiosk screen now
    // (see round 23), so it gets its own distinct identity rather than
    // sitting inside the same boxed layout as the internal admin pages.
    // `min-h-[100dvh]` (dynamic viewport height) is layered after
    // `min-h-screen` so mobile browsers with a collapsing address bar don't
    // leave a sliver of the maroon backdrop cut off or over-scrolled —
    // browsers that don't understand `dvh` simply ignore that declaration
    // and keep the `100vh` fallback.
    <div className="relative -my-8 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] min-h-screen min-h-[100dvh] w-screen overflow-hidden bg-primary">
      {/* Ambient เลือดหมู-ขาว-ทอง backdrop (round 36: now animated; round 37:
          sunburst rays removed) — a slow-drifting diagonal gradient
          cycling between deep maroon and warm gold-bronze (an oversized
          bg-size + animated background-position, rather than a
          hard-edged scroll/repeat), a softly drifting cream/white
          "sheen" glow standing in for the white leg of the tricolor, and
          a soft glow behind the logo. */}
      <div
        className="pointer-events-none absolute inset-0 animate-login-gradient bg-[linear-gradient(135deg,hsl(350_62%_10%)_0%,hsl(350_62%_24%)_28%,hsl(355_55%_34%)_48%,hsl(38_68%_38%)_62%,hsl(350_60%_16%)_80%,hsl(350_62%_10%)_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[560px] w-[560px] animate-login-sheen rounded-full bg-[radial-gradient(circle,hsl(45_65%_92%/0.55)_0%,transparent_70%)] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-20 h-72 w-72 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/25 to-transparent" aria-hidden />

      <div
        className="relative mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-10 sm:gap-7 sm:px-6 sm:py-16"
        style={{
          paddingTop: 'max(2.5rem, env(safe-area-inset-top) + 1.5rem)',
          paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom) + 1.5rem)',
        }}
      >
        {/* A screen-reader-only heading is kept (not shown visually) so the
            page still has a real <h1> landmark for assistive tech — shadcn's
            CardTitle below renders a <div>, not a heading element, so
            without this the page would have no heading landmark at all. */}
        <h1 className="sr-only">เข้าสู่ระบบด้วยการสแกนใบหน้า</h1>

        <Card className="w-full border-accent/25 bg-card/[0.97] shadow-2xl backdrop-blur-sm">
          <CardHeader className="items-center text-center">
            {/* Logo sits directly above the "FaceIn" wordmark, as one tight
                lockup — sized up again (round 35) to give the crest even
                more presence, with the wrapper's bottom margin dropped so
                the logo sits closer to the wordmark below it (the small
                residual gap comes from CardHeader's own space-y-1.5, not
                an explicit margin here). */}
            <div className="relative">
              <div className="absolute inset-0 -z-10 scale-[1.6] rounded-full bg-accent/25 blur-xl" aria-hidden />
              <img
                src="/logo.png"
                alt="ตราสัญลักษณ์ศูนย์ทัศนราชกัญญาราชวิทยาลัย นครราชสีมา"
                className="h-20 w-20 object-contain drop-shadow-[0_9px_22px_rgba(0,0,0,0.35)] sm:h-24 sm:w-24"
              />
            </div>
            {/* "FaceIn" wordmark given more visual weight/dimension: larger
                size, a maroon-to-gold gradient fill (bg-clip-text) instead
                of flat foreground color, and a soft drop-shadow so the
                gradient reads with some depth rather than looking pasted
                flat onto the card. Pure Latin text, so tracking-tight is
                appropriate here (unlike the Thai headings elsewhere — see
                round 31's notes on why Thai text had it removed). */}
            <CardTitle className="font-display bg-gradient-to-r from-primary via-[hsl(350_58%_38%)] to-accent bg-clip-text text-3xl font-bold tracking-tight text-transparent drop-shadow-[0_2px_3px_rgba(0,0,0,0.18)] sm:text-4xl">
              FaceIn
            </CardTitle>
            <CardDescription className="text-center">ระบบเช็คอินราชกัญญาฯ ด้วยเทคโนโลยีจดจำใบหน้า</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl border border-accent/20 bg-slate-900">
              {cameraState === 'loading' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                  <Loader2 className="h-7 w-7 animate-spin" />
                  <p className="text-sm">กำลังเตรียมกล้องและโมเดลตรวจจับใบหน้า...</p>
                </div>
              )}
              {cameraState === 'error' && (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-400" />
                  <p className="max-w-sm text-sm leading-relaxed text-white/80">{errorMsg}</p>
                  <Button size="lg" variant="secondary" onClick={() => startCamera()} className="mt-1 gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> ลองอีกครั้ง
                  </Button>
                </div>
              )}
              <video
                ref={videoRef}
                muted
                playsInline
                webkit-playsinline="true"
                className="absolute -left-full -top-full h-px w-px opacity-0"
              />
              <canvas
                ref={canvasRef}
                className={cn('h-full w-full object-cover', (cameraState === 'loading' || cameraState === 'error') && 'hidden')}
              />
              {matchedName && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
                  <ShieldCheck className="h-14 w-14" />
                  <p className="font-display text-xl font-bold">ยินดีต้อนรับ</p>
                  <p className="text-lg">{matchedName}</p>
                </div>
              )}
            </div>
            {adminMembers.length === 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ยังไม่มีผู้ดูแลระบบที่ลงทะเบียนใบหน้าไว้ กรุณาไปที่หน้า &quot;สมาชิก&quot; ตั้งค่า role เป็น admin
                และลงทะเบียนใบหน้าก่อน หรือใช้การเข้าสู่ระบบด้วยรหัสบุคลากรด้านล่าง
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="w-full border-border/70 bg-card/[0.97] shadow-lift backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              {/* Round 40: this badge used to be a plain lucide KeyRound icon
                  inside a flat tinted circle. Replaced with a real image
                  (a person + padlock badge) per request, given some visual
                  "dimension" with a soft glow behind it (echoing the same
                  glow-behind-logo treatment used elsewhere on this page)
                  plus a drop-shadow on the image itself so it reads with
                  depth rather than sitting flush against the card. */}
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                <span aria-hidden className="absolute inset-0 scale-150 rounded-full bg-primary/25 blur-md" />
                <img
                  src="/295128.png"
                  alt=""
                  className="relative h-9 w-9 rounded-full object-cover drop-shadow-[0_3px_6px_rgba(0,0,0,0.35)]"
                />
              </span>
              เข้าสู่ระบบด้วยรหัสผู้ดูแล
            </CardTitle>
            <CardDescription>สำรองสำหรับกรณีกล้องใช้งานไม่ได้</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-id">รหัสบุคลากร</Label>
              <Input
                id="manual-id"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualLogin()}
                placeholder="เช่น T-0012"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                // 16px min font size — anything smaller makes iOS Safari
                // zoom the whole page in on focus, which is jarring on a
                // screen that's meant to work smoothly on any device.
                className="text-base"
              />
            </div>
            {manualError && <p className="text-xs text-destructive">{manualError}</p>}
            <Button size="lg" onClick={handleManualLogin} className="w-full">
              เข้าสู่ระบบ
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] leading-relaxed text-primary-foreground/50">
          ระบบสงวนสิทธิ์การเข้าใช้งานเฉพาะผู้ดูแลระบบที่ได้รับอนุญาตเท่านั้น
        </p>
      </div>
    </div>
  )
}
