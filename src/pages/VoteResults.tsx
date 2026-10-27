import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Heart, Copy, Download, RefreshCw, Trophy, Medal, Eye, EyeOff, Trash2, Maximize, Minimize } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { LoadingState } from '@/components/ui/loading-state'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getTeacherVoteTally, resetTeacherVotes } from '@/lib/store'
import { getFullscreenElement, requestFullscreen, exitFullscreen, onFullscreenChange } from '@/lib/fullscreen'
import type { VoteTally } from '@/lib/types'
import { cn } from '@/lib/utils'

// Results are polled rather than realtime-subscribed: facein_teacher_votes
// isn't in the Supabase Realtime publication, and a few seconds' lag on a
// ranking is fine.
const REFRESH_MS = 10_000

// Remembers "scores hidden" across reloads, so a screen showing only the QR
// code to a room doesn't reveal the ranking if someone refreshes it.
const HIDE_SCORES_KEY = 'facein_vote_hide_scores'

// The public voting page's URL on whatever host this app is served from —
// the app uses HashRouter, so the route goes after `#`.
function voteUrl(): string {
  return `${window.location.origin}${window.location.pathname}#/vote`
}

function readHideScores(): boolean {
  try {
    return window.localStorage.getItem(HIDE_SCORES_KEY) === '1'
  } catch {
    return false
  }
}

function writeHideScores(hidden: boolean) {
  try {
    window.localStorage.setItem(HIDE_SCORES_KEY, hidden ? '1' : '0')
  } catch {
    // ignore — the toggle still works for this page load
  }
}

const RANK_STYLES: Record<number, string> = {
  1: 'bg-accent/20 text-accent-foreground ring-1 ring-accent/50',
  2: 'bg-slate-300/40 text-foreground ring-1 ring-slate-400/50',
  3: 'bg-amber-700/15 text-foreground ring-1 ring-amber-700/40',
}

export default function VoteResults() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [tally, setTally] = useState<VoteTally[]>([])
  const [totalVotes, setTotalVotes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [hideScores, setHideScores] = useState(() => readHideScores())
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const url = voteUrl()

  // Tracks the real fullscreen state so Esc / the browser's own exit keeps
  // the button label in sync.
  useEffect(() => onFullscreenChange(() => setIsFullscreen(getFullscreenElement() === rootRef.current)), [])

  async function toggleFullscreen() {
    try {
      if (getFullscreenElement()) {
        await exitFullscreen()
      } else if (rootRef.current) {
        await requestFullscreen(rootRef.current)
      }
    } catch {
      // iPhone Safari and in-app webviews have no element fullscreen.
      toast.error('อุปกรณ์นี้ไม่รองรับโหมดเต็มจอ')
    }
  }

  useEffect(() => {
    QRCode.toDataURL(url, { width: 768, margin: 2, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => toast.error('สร้าง QR code ไม่สำเร็จ'))
  }, [url])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await getTeacherVoteTally()
      setTally(result.tally)
      setTotalVotes(result.totalVotes)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'โหลดผลโหวตไม่สำเร็จ')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // No polling while scores are hidden — nothing on screen would use it.
  useEffect(() => {
    if (hideScores) return
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh, hideScores])

  function toggleHideScores() {
    setHideScores((prev) => {
      writeHideScores(!prev)
      return !prev
    })
  }

  async function handleReset() {
    setResetting(true)
    try {
      await resetTeacherVotes()
      setTally([])
      setTotalVotes(0)
      setResetConfirmOpen(false)
      toast.success('ล้างคะแนนโหวตแล้ว')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ล้างคะแนนไม่สำเร็จ')
      refresh()
    } finally {
      setResetting(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('คัดลอกลิงก์แล้ว')
    } catch {
      toast.error('คัดลอกลิงก์ไม่สำเร็จ')
    }
  }

  const topVotes = tally[0]?.votes ?? 0

  const qrImage = qrDataUrl ? (
    <img
      src={qrDataUrl}
      alt="QR code ลิงก์หน้าโหวตครูในดวงใจ"
      className={hideScores ? 'h-[min(55vw,50dvh)] w-[min(55vw,50dvh)]' : 'h-52 w-52'}
    />
  ) : (
    <div className={cn('animate-pulse rounded-lg bg-muted', hideScores ? 'h-[min(55vw,50dvh)] w-[min(55vw,50dvh)]' : 'h-52 w-52')} />
  )

  return (
    // The ref'd root is what goes fullscreen (not the whole document), so the
    // navbar drops out and only this page shows — padding/scroll are added
    // back in that mode since <main>'s own padding is outside this element.
    <div ref={rootRef} className={cn('space-y-6', isFullscreen && 'overflow-y-auto p-6 sm:p-10')}>
      {/* Same animated เลือดหมู-ทอง backdrop as /#/login, done the
          /#/meetings way: `fixed` + z-0 here and `relative z-10` on the
          content wrapper (AppShell's bg-background div would otherwise paint
          over a negative z-index). */}
      <div
        className="pointer-events-none fixed inset-0 z-0 animate-login-gradient bg-[linear-gradient(135deg,hsl(350_62%_10%)_0%,hsl(350_62%_24%)_28%,hsl(355_55%_34%)_48%,hsl(38_68%_38%)_62%,hsl(350_60%_16%)_80%,hsl(350_62%_10%)_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed left-1/2 top-1/3 z-0 h-[560px] w-[560px] animate-login-sheen rounded-full bg-[radial-gradient(circle,hsl(45_65%_92%/0.55)_0%,transparent_70%)] blur-3xl"
        aria-hidden
      />

      <div className="animate-page-in relative z-10 space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)] sm:text-3xl">
            <Heart className="h-7 w-7 fill-accent text-accent" /> โหวตครูในดวงใจ
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
              {isFullscreen ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
            </Button>
            <Button variant="secondary" size="sm" className="gap-1.5" onClick={toggleHideScores}>
              {hideScores ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {hideScores ? 'แสดงคะแนน' : 'ซ่อนคะแนน'}
            </Button>
            {!hideScores && (
              <>
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={refresh} disabled={refreshing}>
                  <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> รีเฟรช
                </Button>
                {/* Not offered in fullscreen: the confirm dialog portals to
                    <body>, outside the fullscreen element, so it would open
                    invisibly behind it. */}
                {!isFullscreen && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setResetConfirmOpen(true)}
                    disabled={totalVotes === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> ล้างคะแนนโหวต
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {hideScores ? (
          <div className={cn('flex items-center justify-center', isFullscreen ? 'min-h-[calc(100dvh-10rem)]' : 'min-h-[calc(100dvh-14rem)]')}>
            <div className="rounded-3xl bg-white p-4 shadow-2xl sm:p-6">{qrImage}</div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
            <Card className="h-fit border-border/70 shadow-soft">
              <CardHeader className="text-center">
                <CardTitle className="font-display text-lg">QR code สำหรับโหวต</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <div className="rounded-2xl bg-white p-3 shadow-soft">{qrImage}</div>
                <p className="w-full break-all rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">{url}</p>
                <div className="flex w-full gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={copyLink}>
                    <Copy className="h-3.5 w-3.5" /> คัดลอกลิงก์
                  </Button>
                  {qrDataUrl && (
                    <Button asChild size="sm" className="flex-1 gap-1.5">
                      <a href={qrDataUrl} download="vote-qr.png">
                        <Download className="h-3.5 w-3.5" /> ดาวน์โหลด
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 shadow-soft">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="font-display flex items-center gap-2 text-lg">
                  <Trophy className="h-5 w-5 text-accent" /> อันดับคะแนน
                </CardTitle>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                  ทั้งหมด {totalVotes.toLocaleString('th-TH')} โหวต
                </span>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingState label="กำลังโหลดผลโหวต..." />
                ) : tally.length === 0 ? (
                  <EmptyState icon={<Heart className="h-8 w-8 text-muted-foreground" />} title="ยังไม่มีผู้โหวต" />
                ) : (
                  <ol className="space-y-2">
                    {tally.map((t) => {
                      const percent = totalVotes ? Math.round((t.votes / totalVotes) * 100) : 0
                      return (
                        <li
                          key={t.id}
                          className={cn(
                            'flex items-center gap-3 rounded-xl border border-border/60 p-3',
                            t.rank === 1 && 'border-accent/50 bg-accent/5'
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground',
                              RANK_STYLES[t.rank]
                            )}
                            aria-label={`อันดับ ${t.rank}`}
                          >
                            {t.rank <= 3 ? <Medal className="h-4 w-4" /> : t.rank}
                          </span>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate text-sm font-medium text-foreground">
                                {t.rank <= 3 && <span className="me-1.5 text-xs text-muted-foreground">#{t.rank}</span>}
                                {t.name}
                              </p>
                              <p className="shrink-0 font-display text-base font-bold tabular-nums text-foreground">
                                {t.votes.toLocaleString('th-TH')}
                                <span className="ms-1 text-xs font-normal text-muted-foreground">({percent}%)</span>
                              </p>
                            </div>
                            <Progress value={topVotes ? (t.votes / topVotes) * 100 : 0} className="h-1.5" />
                            <p className="truncate text-xs text-muted-foreground">
                              {[t.position, t.department].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="ยืนยันการล้างคะแนนโหวต"
        description={
          <>
            คะแนนโหวตทั้งหมด <strong>{totalVotes.toLocaleString('th-TH')} โหวต</strong> จะถูกลบ และไม่สามารถย้อนกลับได้
            ทุกอุปกรณ์จะโหวตใหม่ได้อีก 1 ครั้ง
          </>
        }
        confirmLabel="ล้างคะแนน"
        confirmIcon={<Trash2 className="h-3.5 w-3.5" />}
        loading={resetting}
        onConfirm={handleReset}
      />
    </div>
  )
}
