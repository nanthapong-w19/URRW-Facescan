import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Heart, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { castTeacherVote, getVoteCandidates } from '@/lib/store'
import type { VoteCandidate } from '@/lib/types'
import { cn } from '@/lib/utils'

// Public page the QR code on /#/vote/results points to — no login, opened
// on the voter's own phone. One vote per device: a random device id kept in
// localStorage, enforced again by a unique constraint on
// facein_teacher_votes.voter_device (see supabase/migrations). Not real
// identity — clearing site data gives a fresh id — same "convenience gate"
// trade-off as lib/adminAuth.tsx.
const DEVICE_KEY = 'facein_vote_device'
const VOTED_KEY = 'facein_vote_cast'

// Search results are capped so typing one letter doesn't render the whole
// ~150-person roster on a phone.
const MAX_RESULTS = 30

function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    // Storage blocked (private mode etc.) — still vote, just without the
    // per-device memory; the id lives only for this page load.
    return crypto.randomUUID()
  }
}

function readVotedName(): string | null {
  try {
    return window.localStorage.getItem(VOTED_KEY)
  } catch {
    return null
  }
}

function rememberVote(name: string) {
  try {
    window.localStorage.setItem(VOTED_KEY, name)
  } catch {
    // ignore — the DB unique constraint still blocks a second vote
  }
}

export default function TeacherVote() {
  const [candidates, setCandidates] = useState<VoteCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<VoteCandidate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [votedName, setVotedName] = useState<string | null>(() => readVotedName())

  useEffect(() => {
    let cancelled = false
    getVoteCandidates()
      .then((data) => {
        if (!cancelled) setCandidates(data)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'โหลดรายชื่อครูไม่สำเร็จ'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
  }, [candidates, query])

  async function handleVote() {
    if (!selected) return
    setSubmitting(true)
    try {
      await castTeacherVote(selected.id, getDeviceId())
      rememberVote(selected.name)
      setVotedName(selected.name)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'โหวตไม่สำเร็จ'
      // The device already voted from another tab/before storage was
      // cleared — show the "already voted" screen rather than a dead end.
      if (message === 'อุปกรณ์นี้โหวตไปแล้ว') {
        setVotedName('')
      } else {
        toast.error(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Same full-bleed maroon/gold backdrop as /#/login — this is also a
    // standalone screen with no navbar (see App.tsx hideNavbar).
    <div className="relative -my-8 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] min-h-screen min-h-[100dvh] w-screen overflow-hidden bg-primary">
      <div
        className="pointer-events-none absolute inset-0 animate-login-gradient bg-[linear-gradient(135deg,hsl(350_62%_10%)_0%,hsl(350_62%_24%)_28%,hsl(355_55%_34%)_48%,hsl(38_68%_38%)_62%,hsl(350_60%_16%)_80%,hsl(350_62%_10%)_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[560px] w-[560px] animate-login-sheen rounded-full bg-[radial-gradient(circle,hsl(45_65%_92%/0.55)_0%,transparent_70%)] blur-3xl"
        aria-hidden
      />

      <div
        className="relative mx-auto flex min-h-screen min-h-[100dvh] w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-10"
        style={{
          paddingTop: 'max(2.5rem, env(safe-area-inset-top) + 1.5rem)',
          paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom) + 1.5rem)',
        }}
      >
        <h1 className="sr-only">โหวตครูในดวงใจ</h1>

        <Card className="animate-login-card-in w-full border-accent/25 bg-card/[0.97] shadow-2xl backdrop-blur-sm">
          <CardHeader className="items-center text-center">
            <img src="/logo.png" alt="ตราสัญลักษณ์โรงเรียน" className="h-16 w-16 object-contain" />
            <CardTitle className="font-display flex items-center gap-2 text-2xl font-bold text-primary">
              <Heart className="h-6 w-6 fill-primary text-primary" /> โหวตครูในดวงใจ
            </CardTitle>
            {votedName === null && <CardDescription>พิมพ์ชื่อครู เลือก แล้วกดโหวต (โหวตได้ 1 ครั้ง)</CardDescription>}
          </CardHeader>

          <CardContent className="space-y-4">
            {votedName !== null ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center" role="status" aria-live="polite">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 animate-login-success-pop">
                  <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                </div>
                <p className="font-display text-xl font-bold text-foreground">โหวตสำเร็จแล้ว</p>
                {votedName ? (
                  <p className="text-sm text-muted-foreground">
                    คุณโหวตให้ <span className="font-medium text-foreground">{votedName}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">อุปกรณ์นี้ได้โหวตไปแล้ว</p>
                )}
                <p className="text-xs text-muted-foreground">ขอบคุณที่ร่วมโหวต</p>
              </div>
            ) : (
              <>
                <SearchInput
                  aria-label="ค้นหาชื่อครู"
                  placeholder={loading ? 'กำลังโหลดรายชื่อ...' : 'พิมพ์ชื่อครู'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={loading || submitting}
                  autoComplete="off"
                  // 16px — keeps iOS Safari from zooming on focus.
                  className="h-12 rounded-xl text-base"
                />

                {query.trim() && (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto" aria-label="ผลการค้นหา">
                    {results.length === 0 ? (
                      <li className="py-6 text-center text-sm text-muted-foreground">ไม่พบชื่อครูที่ค้นหา</li>
                    ) : (
                      results.map((c) => {
                        const isSelected = selected?.id === c.id
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => setSelected(c)}
                              aria-pressed={isSelected}
                              className={cn(
                                'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors',
                                isSelected
                                  ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                                  : 'border-border/70 hover:border-primary/40 hover:bg-secondary'
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {[c.position, c.department].filter(Boolean).join(' · ')}
                                </span>
                              </span>
                              {isSelected && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                )}

                {selected && (
                  <p className="rounded-xl bg-secondary px-3 py-2 text-center text-sm">
                    เลือก: <span className="font-semibold text-foreground">{selected.name}</span>
                  </p>
                )}

                <Button size="lg" className="w-full gap-2" onClick={handleVote} disabled={!selected || submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                  โหวต
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
