import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Heart, Copy, Download, RefreshCw, Trophy, Medal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { PageHeader } from '@/components/ui/page-header'
import { LoadingState } from '@/components/ui/loading-state'
import { EmptyState } from '@/components/ui/empty-state'
import { getTeacherVoteTally } from '@/lib/store'
import type { VoteTally } from '@/lib/types'
import { cn } from '@/lib/utils'

// Results are polled rather than realtime-subscribed: facein_teacher_votes
// isn't in the Supabase Realtime publication, and a few seconds' lag on a
// ranking is fine.
const REFRESH_MS = 10_000

// The public voting page's URL on whatever host this app is served from —
// the app uses HashRouter, so the route goes after `#`.
function voteUrl(): string {
  return `${window.location.origin}${window.location.pathname}#/vote`
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
  const url = voteUrl()

  useEffect(() => {
    QRCode.toDataURL(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
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

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('คัดลอกลิงก์แล้ว')
    } catch {
      toast.error('คัดลอกลิงก์ไม่สำเร็จ')
    }
  }

  const topVotes = tally[0]?.votes ?? 0

  return (
    <div className="animate-page-in space-y-6">
      <PageHeader
        title="โหวตครูในดวงใจ"
        description="ให้ผู้โหวตสแกน QR code เพื่อเปิดหน้าโหวต ผลด้านล่างอัปเดตอัตโนมัติทุก 10 วินาที"
        action={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> รีเฟรช
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card className="h-fit border-border/70 shadow-soft">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-lg">QR code สำหรับโหวต</CardTitle>
            <CardDescription>สแกนด้วยกล้องมือถือ</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="rounded-2xl bg-white p-3 shadow-soft">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR code ลิงก์หน้าโหวตครูในดวงใจ" className="h-64 w-64" />
              ) : (
                <div className="h-64 w-64 animate-pulse rounded-lg bg-muted" />
              )}
            </div>
            <p className="w-full break-all rounded-lg bg-muted px-3 py-2 text-center text-xs text-muted-foreground">{url}</p>
            <div className="flex w-full gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={copyLink}>
                <Copy className="h-3.5 w-3.5" /> คัดลอกลิงก์
              </Button>
              <Button asChild size="sm" className="flex-1 gap-1.5" disabled={!qrDataUrl}>
                <a href={qrDataUrl ?? undefined} download="vote-qr.png">
                  <Download className="h-3.5 w-3.5" /> ดาวน์โหลด
                </a>
              </Button>
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
    </div>
  )
}
