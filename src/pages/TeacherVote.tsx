import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Heart, CheckCircle2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { InitialsAvatar } from '@/components/ui/initials-avatar'
import { castTeacherVote, getMemberPhotosByIds, getVoteCandidates, hasDeviceVoted } from '@/lib/store'
import type { VoteCandidate } from '@/lib/types'

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

function forgetVote() {
  try {
    window.localStorage.removeItem(VOTED_KEY)
  } catch {
    // ignore
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
  // Photo of the currently selected teacher, fetched on selection rather
  // than with the candidate list — photos are ~60-120KB each (see
  // MEMBER_COLUMNS in store.ts), far too heavy to load for the whole roster
  // on a phone. `undefined` = still loading, `null` = no photo registered.
  const [selectedPhoto, setSelectedPhoto] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setSelectedPhoto(undefined)
    getMemberPhotosByIds([selected.id])
      .then((photos) => {
        if (!cancelled) setSelectedPhoto(photos[selected.id] ?? null)
      })
      .catch(() => {
        if (!cancelled) setSelectedPhoto(null)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  // An admin's "ล้างคะแนนโหวต" deletes this device's vote row — if it's
  // gone, drop the local flag so the device can vote in the new round.
  useEffect(() => {
    if (votedName === null) return
    let cancelled = false
    hasDeviceVoted(getDeviceId())
      .then((voted) => {
        if (!cancelled && !voted) {
          forgetVote()
          setVotedName(null)
        }
      })
      .catch(() => {
        // keep showing "already voted"; the unique constraint still guards
      })
    return () => {
      cancelled = true
    }
    // Only on mount — re-running after a fresh vote would race the insert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function selectCandidate(c: VoteCandidate) {
    setSelected(c)
    setQuery('')
  }

  return (
    // Same full-bleed maroon/gold backdrop as /#/login — this is also a
    // standalone screen with no navbar (see App.tsx hideNavbar). Locked to
    // exactly one screen height (100dvh, so it tracks the mobile address bar
    // and on-screen keyboard): voters on a phone should never have to scroll
    // the page — only the search-result list scrolls, inside the card.
    <div className="relative -my-8 ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] h-screen h-[100dvh] w-screen overflow-hidden bg-primary">
      <div
        className="pointer-events-none absolute inset-0 animate-login-gradient bg-[linear-gradient(135deg,hsl(350_62%_10%)_0%,hsl(350_62%_24%)_28%,hsl(355_55%_34%)_48%,hsl(38_68%_38%)_62%,hsl(350_60%_16%)_80%,hsl(350_62%_10%)_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[560px] w-[560px] animate-login-sheen rounded-full bg-[radial-gradient(circle,hsl(45_65%_92%/0.55)_0%,transparent_70%)] blur-3xl"
        aria-hidden
      />

      <div
        className="relative mx-auto flex h-full w-full max-w-md flex-col justify-center px-3 sm:px-4"
        style={{
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <h1 className="sr-only">โหวต ครูดีศรี อ.ร.ว.นม. รางวัลครูผู้เป็นที่รักของเพื่อนร่วมงาน (Popular Teacher Award)</h1>

        <Card className="animate-login-card-in flex max-h-full min-h-0 w-full flex-col border-accent/25 bg-card/[0.97] shadow-2xl backdrop-blur-sm">
          <CardHeader className="shrink-0 items-center space-y-1 p-4 pb-2 text-center">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="ตราสัญลักษณ์โรงเรียน" className="h-10 w-10 object-contain" />
              <CardTitle className="font-display flex items-center gap-1.5 text-xl font-bold text-primary">
                <Heart className="h-5 w-5 fill-primary text-primary" /> โหวต ครูดีศรี อ.ร.ว.นม.
              </CardTitle>
            </div>
            <div className="flex flex-col items-center leading-tight" aria-hidden>
              <p className="font-display text-sm font-semibold text-foreground">รางวัลครูผู้เป็นที่รักของเพื่อนร่วมงาน</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Popular Teacher Award</p>
            </div>
            {votedName === null && (
              <CardDescription className="text-xs">พิมพ์ชื่อครู เลือก แล้วกดโหวต (โหวตได้ 1 ครั้ง)</CardDescription>
            )}
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-2">
            {votedName !== null ? (
              <div className="flex flex-col items-center gap-2 py-3 text-center" role="status" aria-live="polite">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 animate-login-success-pop">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
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
            ) : selected ? (
              // Once a teacher is picked the search UI steps aside, so the
              // photo, name and vote button all fit on one phone screen.
              <>
                <div className="flex min-h-0 flex-col items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-center">
                  {selectedPhoto === undefined ? (
                    <div
                      className="h-[min(7rem,22dvh)] w-[min(7rem,22dvh)] shrink-0 animate-pulse rounded-full bg-muted"
                      aria-label="กำลังโหลดรูป"
                    />
                  ) : (
                    <InitialsAvatar
                      name={selected.name}
                      photo={selectedPhoto}
                      className="h-[min(7rem,22dvh)] w-[min(7rem,22dvh)] ring-4 ring-primary/30 [&>div]:text-4xl"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">ครูที่คุณเลือก</p>
                    <p className="font-display text-lg font-bold leading-snug text-foreground">{selected.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[selected.position, selected.department].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="lg" className="flex-1" onClick={() => setSelected(null)} disabled={submitting}>
                    เปลี่ยน
                  </Button>
                  <Button size="lg" className="flex-[2] gap-2" onClick={handleVote} disabled={submitting}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                    โหวต
                  </Button>
                </div>
              </>
            ) : (
              <>
                <SearchInput
                  aria-label="ค้นหาชื่อครู"
                  placeholder={loading ? 'กำลังโหลดรายชื่อ...' : 'พิมพ์ชื่อครู'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={loading}
                  autoComplete="off"
                  containerClassName="shrink-0"
                  // 16px — keeps iOS Safari from zooming on focus.
                  className="h-11 rounded-xl text-base"
                />

                {query.trim() && (
                  // min-h-0 + overflow lets this list shrink to whatever
                  // height is left (e.g. with the keyboard open) and scroll
                  // inside the card instead of pushing the page taller.
                  <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain" aria-label="ผลการค้นหา">
                    {results.length === 0 ? (
                      <li className="py-4 text-center text-sm text-muted-foreground">ไม่พบชื่อครูที่ค้นหา</li>
                    ) : (
                      results.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => selectCandidate(c)}
                            className="flex w-full items-center rounded-xl border border-border/70 px-3 py-2 text-start transition-colors hover:border-primary/40 hover:bg-secondary"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {[c.position, c.department].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}

                <Button size="lg" className="w-full shrink-0 gap-2" disabled>
                  <Heart className="h-4 w-4" /> โหวต
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
