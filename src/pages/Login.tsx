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
type OverlayBox = { box: { x: number; y: number; width: number; height: number }; color: string; label: string } | null

const SCAN_INTERVAL_MS = 500

// Face-scan is now purely a live recognition display, NOT a login
// mechanism — it draws a box around whatever face is in frame and labels
// it with the matched member's name (any registered member, not just
// admins), or "ไม่รู้จัก" if nothing matches. It never signs anyone in and
// never navigates away on its own. The only way to actually log in is the
// manual employee-ID form below, which still records an "admin session"
// (see lib/adminAuth.tsx) and still requires role === 'admin'.
export default function Login() {
  const { members } = useAppData()
  const { loginAsAdmin } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/meetings'

  const registeredMembers = useMemo(() => members.filter((m) => m.faceStatus === 'registered'), [members])

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const overlayRef = useRef<OverlayBox>(null)

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
        const overlay = overlayRef.current
        if (overlay) {
          ctx.strokeStyle = overlay.color
          ctx.lineWidth = 4
          ctx.strokeRect(overlay.box.x, overlay.box.y, overlay.box.width, overlay.box.height)
        }
        ctx.restore()

        if (overlay) {
          const { box, color, label } = overlay
          const mirroredX = canvas.width - box.x - box.width
          ctx.font = '600 20px "Plus Jakarta Sans", sans-serif'
          const textWidth = ctx.measureText(label).width
          ctx.fillStyle = color
          ctx.fillRect(mirroredX - 2, box.y - 34, textWidth + 16, 30)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(label, mirroredX + 6, box.y - 11)
        }
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

  // The only entry point left that actually logs anyone in — called from
  // handleManualLogin below. Face-scan matches never reach this function
  // anymore; they only ever update the on-screen overlay.
  function completeLogin(member: Member) {
    stopCamera()
    setMatchedName(member.name)
    loginAsAdmin(member)
    toast.success(`เข้าสู่ระบบสำเร็จ: ${member.name}`)
    // Round 45: the full-page success transition rendered from `matchedName`
    // (further down in the JSX). The delay gives that transition's circular
    // reveal + icon pop + text fade-in enough time to fully play before the
    // route actually changes.
    window.setTimeout(() => navigate(redirectTo, { replace: true }), 1300)
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

  // Live recognition only — matches against every registered member (not
  // just admins, since this no longer gates login) and just updates the
  // overlay the paint loop draws. Never calls completeLogin.
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
        return
      }

      let best: { member: Member; distance: number } | null = null
      for (const m of registeredMembers) {
        if (!m.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, m.faceDescriptor)
        if (!best || distance < best.distance) best = { member: m, distance }
      }

      const isMatch = best && best.distance < MATCH_THRESHOLD
      overlayRef.current = {
        box: result.box,
        color: isMatch ? '#10b981' : '#f59e0b',
        label: isMatch ? best!.member.name : 'ไม่รู้จัก',
      }
    }, SCAN_INTERVAL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, registeredMembers])

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
        <h1 className="sr-only">เข้าสู่ระบบผู้ดูแลระบบ</h1>

        <Card className="w-full border-accent/25 bg-card/[0.97] shadow-2xl backdrop-blur-sm">
          <CardHeader className="items-center text-center">
            {/* Round 46: reverted round 45's inline logo+wordmark lockup
                back to a large, stacked logo sitting on its own line
                directly above "FaceIn" — sized back up to closely match the
                reference image the user attached this round (a big centered
                crest, with "FaceIn" beneath it as its own line), per
                explicit request. Same size/glow treatment round 35 last
                used before round 45 shrunk it. */}
            <div className="relative">
              <div className="absolute inset-0 -z-10 scale-[1.6] rounded-full bg-accent/25 blur-xl" aria-hidden />
              <img
                src="/logo.png"
                alt="ตราสัญลักษณ์ศูนย์ทัศนราชกัญญาราชวิทยาลัย นครราชสีมา"
                className="h-20 w-20 object-contain drop-shadow-[0_9px_22px_rgba(0,0,0,0.35)] sm:h-24 sm:w-24"
              />
            </div>
            {/* "FaceIn" wordmark given more visual weight/dimension: larger
                size, the same maroon-to-gold gradient fill (bg-clip-text)
                as before but now animated — bg-size 200% + an animated
                background-position sweeps the gradient back and forth —
                and a soft drop-shadow so it reads with some depth rather
                than looking pasted flat onto the card. Pure Latin text, so
                tracking-tight is appropriate here (unlike the Thai headings
                elsewhere — see round 31's notes on why Thai text had it
                removed). */}
            <CardTitle className="font-display animate-gradient-move bg-gradient-to-r from-primary via-[hsl(350_58%_38%)] to-accent bg-[length:200%_auto] bg-clip-text text-3xl font-bold tracking-tight text-transparent drop-shadow-[0_2px_3px_rgba(0,0,0,0.18)] sm:text-4xl">
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
                <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center sm:p-6">
                  <AlertTriangle className="h-8 w-8 shrink-0 text-amber-400" />
                  <p className="max-w-sm text-sm leading-relaxed text-white/80">{errorMsg}</p>
                  <Button size="lg" variant="secondary" onClick={() => startCamera()} className="mt-1 shrink-0 gap-1.5">
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
            </div>
            {registeredMembers.length === 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                ยังไม่มีบุคลากรที่ลงทะเบียนใบหน้าไว้ กล้องจะขึ้น &quot;ไม่รู้จัก&quot; สำหรับทุกคนจนกว่าจะลงทะเบียนใบหน้าไว้ที่หน้า
                &quot;บุคลากร&quot;
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="w-full border-border/70 bg-card/[0.97] shadow-lift backdrop-blur-sm">
          {/* No more separate CardHeader — "เข้าสู่ระบบด้วยรหัสผู้ดูแล" now
              sits directly as the input's own label instead of a title
              block above it, so the card opens straight into the field
              with a tight label-to-input gap rather than a full header's
              worth of spacing. */}
          <CardContent className="space-y-3 pt-4 sm:pt-5">
            <div className="space-y-1">
              <Label htmlFor="manual-id" className="font-display text-sm font-medium text-foreground">
                เข้าสู่ระบบด้วยรหัสผู้ดูแล
              </Label>
              <Input
                id="manual-id"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualLogin()}
                placeholder="กรอกรหัสบุคลากร"
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

      {/* Round 45: full-page success transition, shown for BOTH the
          face-scan match and the manual employee-ID login — completeLogin
          above is the single entry point for both flows, so this replaces
          the old success overlay that used to live only inside the camera
          preview box (invisible/irrelevant when the admin logged in via the
          manual code card instead). A circular "iris" wipe reveals a
          maroon-to-gold panel matching this page's own ambient backdrop
          palette, the check badge pops in with a soft glow pulse, and the
          welcome text fades in a beat later — then completeLogin's
          setTimeout hands off to the meetings route once that's had time to
          read. `fixed inset-0` means placement in the tree doesn't matter
          for coverage; kept as the last element so it paints above
          everything else on the page. Respects prefers-reduced-motion (see
          index.css) by simply appearing instantly with no wipe/pop/fade. */}
      {matchedName && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 overflow-hidden bg-[radial-gradient(circle_at_50%_45%,hsl(38_68%_45%)_0%,hsl(355_55%_30%)_45%,hsl(350_62%_12%)_100%)] animate-login-success-reveal"
          role="status"
          aria-live="polite"
        >
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm animate-login-success-pop">
            <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-400/30 blur-xl animate-login-success-glow" />
            <ShieldCheck className="relative h-14 w-14 text-emerald-300 drop-shadow-[0_4px_10px_rgba(0,0,0,0.4)]" />
          </div>
          <div className="flex flex-col items-center gap-1 text-center animate-login-success-text">
            <p className="font-display text-2xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
              ยินดีต้อนรับ
            </p>
            <p className="text-lg text-white/90">{matchedName}</p>
            <p className="mt-2 text-xs text-white/60">กำลังพาไปหน้าการประชุม...</p>
          </div>
        </div>
      )}
    </div>
  )
}
