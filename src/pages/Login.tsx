import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ShieldCheck } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import type { Member } from '@/lib/types'

// Face-scan camera removed from this page per request — the manual
// employee-ID form below is now the only way to log in. It still records a
// session (see lib/adminAuth.tsx) and requires role === 'admin' or
// 'viewer' — plain 'user' members have no login access.
export default function Login() {
  const { members } = useAppData()
  const { loginAsAdmin } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/meetings'

  const [matchedName, setMatchedName] = useState<string | null>(null)
  const [manualId, setManualId] = useState('')
  const [manualError, setManualError] = useState('')

  function completeLogin(member: Member) {
    setMatchedName(member.name)
    loginAsAdmin(member)
    toast.success(`เข้าสู่ระบบสำเร็จ: ${member.name}`)
    // Round 45: the full-page success transition rendered from `matchedName`
    // (further down in the JSX). The delay gives that transition's circular
    // reveal + icon pop + text fade-in enough time to fully play before the
    // route actually changes.
    window.setTimeout(() => navigate(redirectTo, { replace: true }), 1300)
  }

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
    if (member.role !== 'admin' && member.role !== 'viewer') {
      setManualError('รหัสบุคลากรนี้ไม่มีสิทธิ์เข้าสู่ระบบ (admin หรือ ผู้แสดงผล)')
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
        // Hidden from assistive tech while the success overlay covers it —
        // the card is still visually underneath (z-50 overlay just paints
        // over it) and its input/button stay in the tab order otherwise.
        aria-hidden={matchedName ? true : undefined}
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
            <CardTitle className="font-brand animate-gradient-move bg-gradient-to-r from-primary via-[hsl(350_58%_38%)] to-accent bg-[length:200%_auto] bg-clip-text text-4xl font-extrabold tracking-tight text-transparent drop-shadow-[0_2px_3px_rgba(0,0,0,0.18)] sm:text-5xl">
              FaceIn
            </CardTitle>
            <CardDescription className="text-center">ระบบเช็คอินราชกัญญาฯ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Input
                id="manual-id"
                aria-label="เข้าสู่ระบบด้วยรหัสผู้ดูแล"
                aria-invalid={manualError ? true : undefined}
                aria-describedby={manualError ? 'manual-id-error' : undefined}
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualLogin()}
                placeholder="กรอกรหัสบุคลากร"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                disabled={!!matchedName}
                // 16px min font size — anything smaller makes iOS Safari
                // zoom the whole page in on focus, which is jarring on a
                // screen that's meant to work smoothly on any device.
                className="text-center text-base"
              />
            </div>
            {manualError && (
              <p id="manual-id-error" role="alert" className="text-xs text-destructive">
                {manualError}
              </p>
            )}
            <Button
              size="lg"
              onClick={handleManualLogin}
              disabled={!!matchedName}
              // เลือดหมู-ทอง hover sweep, applied directly here since this
              // page is deliberately excluded from the shared .themed-pages
              // hover treatment in index.css (Login uses its own bespoke
              // maroon/gold styling for its Card/Button elements).
              className="w-full bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(350_55%_22%)_55%,hsl(var(--accent))_140%)] bg-[length:180%_180%] bg-[position:0%_0%] transition-[background-position] duration-500 hover:bg-[position:100%_100%]"
            >
              เข้าสู่ระบบ
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] leading-relaxed text-primary-foreground/50">
          ระบบใช้รหัสบุคลากรเดียวกับ bookmark เข้าใช้งาน
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
