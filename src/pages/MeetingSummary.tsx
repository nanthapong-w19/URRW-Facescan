import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { InitialsAvatar } from '@/components/ui/initials-avatar'
import { PulseDot } from '@/components/PulseDot'
import { CheckinMethodBadge } from '@/components/CheckinMethodBadge'
import { CheckinIdentity } from '@/components/CheckinIdentity'
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Users,
  UserCheck,
  UserX,
  CircleCheck,
  ChevronDown,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { getMeeting, getMeetingCheckins } from '@/lib/store'
import { supabase } from '@/lib/supabaseClient'
import { applyMeetingCheckinEvent } from '@/lib/realtimeSync'
import type { RealtimeChange } from '@/lib/realtimeSync'
import type { Meeting, MeetingCheckin, MeetingCheckinRow } from '@/lib/types'
import { cn } from '@/lib/utils'

// Safari/iOS and older Edge/Firefox expose the Fullscreen API under vendor
// prefixes (or, on iOS Safari, not at all for non-<video> elements) — reading
// the unprefixed property directly returns undefined there and crashes the
// click handler with "requestFullscreen is not a function".
const FULLSCREEN_CHANGE_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
] as const

function getFullscreenElement(): Element | null {
  const doc = document as any
  return (
    document.fullscreenElement
    || doc.webkitFullscreenElement
    || doc.mozFullScreenElement
    || doc.msFullscreenElement
    || null
  )
}
import AttendanceDonut from '@/components/AttendanceDonut'
import DepartmentAttendanceChart from '@/components/DepartmentAttendanceChart'

function formatMeetingDate(iso: string | null) {
  if (!iso) return 'ยังไม่กำหนดเวลา'
  try {
    const d = new Date(iso)
    return `${d.toLocaleDateString('th-TH', { dateStyle: 'full' })} · ${d.toLocaleTimeString('th-TH', { timeStyle: 'short' })}`
  } catch {
    return iso
  }
}

function formatCheckinTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

type Panel = 'all' | 'present' | 'absent' | null

// Clickable KPI tile: the whole card toggles its detail panel below it on
// click (rather than opening a modal) so both stats stay visible while
// their detail lists are open, and the arrow rotates as a lightweight
// affordance for "this expands".
function StatTile({
  label,
  count,
  icon,
  tone,
  active,
  onClick,
}: {
  label: string
  count: number
  icon: ReactNode
  tone: 'primary' | 'emerald' | 'amber'
  active?: boolean
  onClick?: () => void
}) {
  const toneClasses = {
    primary: 'bg-primary/10 text-primary',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border p-5 text-left transition-colors',
        active ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-card',
        onClick && 'hover:border-primary/40'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', toneClasses)}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-display text-2xl font-bold text-foreground">{count}</p>
        </div>
      </div>
      {onClick && (
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', active && 'rotate-180')} />
      )}
    </button>
  )
}

export default function MeetingSummary() {
  const { id } = useParams<{ id: string }>()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [checkins, setCheckins] = useState<MeetingCheckin[]>([])
  const [loading, setLoading] = useState(true)
  const [openPanel, setOpenPanel] = useState<Panel>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fullscreen just enlarges the page for projecting on a meeting-room
  // screen — panels still hide/show per click like the windowed view.
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(getFullscreenElement() === containerRef.current)
    }
    for (const evt of FULLSCREEN_CHANGE_EVENTS) {
      document.addEventListener(evt, handleFullscreenChange)
    }
    return () => {
      for (const evt of FULLSCREEN_CHANGE_EVENTS) {
        document.removeEventListener(evt, handleFullscreenChange)
      }
    }
  }, [])

  async function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    try {
      if (getFullscreenElement()) {
        const exit = document.exitFullscreen
          || (document as any).webkitExitFullscreen
          || (document as any).mozCancelFullScreen
          || (document as any).msExitFullscreen
        if (exit) {
          await exit.call(document)
        } else {
          setIsFullscreen(false)
        }
        return
      }

      if (isFullscreen) {
        // We're only in the CSS-only fallback (no native element is actually
        // fullscreen) — just toggle the local state back off.
        setIsFullscreen(false)
        return
      }

      const request = el.requestFullscreen
        || (el as any).webkitRequestFullscreen
        || (el as any).webkitEnterFullscreen // iOS Safari (video-only, but harmless fallback attempt)
        || (el as any).mozRequestFullScreen
        || (el as any).msRequestFullscreen
      if (request) {
        await request.call(el)
      } else {
        // Fullscreen API not supported at all on this device (e.g. iOS Safari
        // on a non-video element) — fall back to a CSS-only "fullscreen" look.
        setIsFullscreen(true)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ไม่สามารถเปิดโหมดเต็มจอได้')
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    Promise.all([getMeeting(id), getMeetingCheckins(id)])
      .then(([meetingData, checkinData]) => {
        if (cancelled) return
        setMeeting(meetingData)
        setCheckins(checkinData)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'โหลดข้อมูลการประชุมไม่สำเร็จ'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Same live-update approach as MeetingDetail.tsx — someone can have this
  // summary open while check-ins are still happening on the kiosk screen.
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`facein-meeting-summary-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'facein_meeting_checkins', filter: `meeting_id=eq.${id}` },
        (payload) => {
          setCheckins((prev) =>
            applyMeetingCheckinEvent(prev, payload as unknown as RealtimeChange<MeetingCheckinRow>)
          )
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

  const checkinByMember = useMemo(() => new Map(checkins.map((c) => [c.memberId, c])), [checkins])
  const participants = useMemo(() => meeting?.participants ?? [], [meeting])
  // Live feed for the "เช็คอินล่าสุด" card up top — driven straight off the
  // same realtime `checkins` state the rest of this page uses (see the
  // postgres_changes subscription above), newest first, capped to the 10
  // most recent so the card doesn't grow unbounded over a long meeting.
  // Older check-ins just drop off this card's view — `checkins` itself
  // (used for the present/absent stats below) still keeps every record.
  const recentCheckins = useMemo(() => {
    const participantsById = new Map(participants.map((p) => [p.memberId, p]))
    return [...checkins]
      .sort((a, b) => new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime())
      .slice(0, 10)
      .map((c) => {
        const p = participantsById.get(c.memberId)
        return {
          id: c.id,
          name: p?.name ?? 'ไม่ทราบชื่อผู้เข้าร่วม',
          department: p?.department ?? '',
          position: p?.position ?? '',
          method: c.method,
          time: formatCheckinTime(c.checkedInAt),
          photoUrl: c.photoUrl,
        }
      })
  }, [checkins, participants])
  const presentParticipants = useMemo(
    () => participants.filter((p) => checkinByMember.has(p.memberId)),
    [participants, checkinByMember]
  )
  const absentParticipants = useMemo(
    () => participants.filter((p) => !checkinByMember.has(p.memberId)),
    [participants, checkinByMember]
  )
  const attendanceRate =
    participants.length > 0 ? Math.round((presentParticipants.length / participants.length) * 100) : 0

  // Grouped by department so the summary shows *where* the gaps are, not
  // just the flat present/absent total the stat tiles above already cover.
  const departmentAttendance = useMemo(() => {
    const byDept = new Map<string, { present: number; total: number }>()
    for (const p of participants) {
      const entry = byDept.get(p.department) ?? { present: 0, total: 0 }
      entry.total += 1
      if (checkinByMember.has(p.memberId)) entry.present += 1
      byDept.set(p.department, entry)
    }
    return [...byDept.entries()]
      .map(([department, { present, total }]) => ({ department, present, absent: total - present, total }))
      .sort((a, b) => b.total - a.total)
  }, [participants, checkinByMember])

  function togglePanel(panel: Panel) {
    setOpenPanel((prev) => (prev === panel ? null : panel))
  }

  if (loading) {
    return <LoadingState label="กำลังโหลดข้อมูลสรุป..." />
  }

  if (!meeting) {
    return (
      <EmptyState title="ไม่พบการประชุมนี้ อาจถูกลบไปแล้ว">
        <Button asChild size="sm" variant="outline">
          <Link to="/meetings">
            <ArrowLeft className="me-1.5 h-3.5 w-3.5" /> กลับไปหน้ารายการประชุม
          </Link>
        </Button>
      </EmptyState>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'mx-auto space-y-6',
        isFullscreen ? 'h-full max-w-none overflow-y-auto bg-background p-6 sm:p-10' : 'max-w-3xl'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1.5">
          <Link to={`/meetings/${id}`}>
            <ArrowLeft className="h-3.5 w-3.5" /> กลับไปหน้าการประชุม
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={toggleFullscreen}>
          {isFullscreen ? (
            <>
              <Minimize2 className="h-3.5 w-3.5" /> ออกจากโหมดเต็มจอ
            </>
          ) : (
            <>
              <Maximize2 className="h-3.5 w-3.5" /> โหมดเต็มจอ
            </>
          )}
        </Button>
      </div>

      <div>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">สรุปข้อมูลการประชุม</h1>
        <p className="mt-1 text-sm text-muted-foreground">{meeting.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" /> {formatMeetingDate(meeting.meetingTime)}
          </span>
          {meeting.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {meeting.location}
            </span>
          )}
        </div>
      </div>

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <UserCheck className="h-4 w-4 text-primary" /> เช็คอินล่าสุด
            </CardTitle>
            <CardDescription>ผู้เช็คอินเข้าประชุมล่าสุด</CardDescription>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <PulseDot />
            LIVE
          </span>
        </CardHeader>
        <CardContent>
          {recentCheckins.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ยังไม่มีผู้เช็คอิน</p>
          ) : (
            // Fixed max-height + scroll — without this, the card kept
            // growing taller with every new check-in (up to the 10-item
            // cap) instead of staying a stable size on screen.
            <ul className={cn('divide-y divide-border/70 overflow-y-auto', isFullscreen ? 'max-h-[50vh]' : 'max-h-80')}>
              {recentCheckins.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <CheckinIdentity
                    name={c.name}
                    position={c.position}
                    department={c.department}
                    photo={c.photoUrl}
                    highlightRing={i === 0}
                  />
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <CheckinMethodBadge method={c.method} manualLabel="เช็คอินด้วยรหัส" />
                    <span className="text-xs text-muted-foreground">{c.time}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {participants.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="border-border/70 shadow-soft lg:col-span-1">
            <CardHeader>
              <CardTitle className="font-display text-base">อัตราเข้าประชุม</CardTitle>
              <CardDescription>สัดส่วนบุคลากรที่เข้าร่วมประชุม</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-8">
              <AttendanceDonut percent={attendanceRate} label="เข้าร่วมประชุม" />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-soft lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-base">แยกตามกลุ่มสาระการเรียนรู้</CardTitle>
              <CardDescription>เปรียบเทียบผู้เข้าร่วมและผู้ไม่เข้าร่วมของแต่ละกลุ่มสาระการเรียนรู้</CardDescription>
            </CardHeader>
            <CardContent>
              <DepartmentAttendanceChart data={departmentAttendance} />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="บุคลากรทั้งหมด"
          count={participants.length}
          icon={<Users className="h-5 w-5" />}
          tone="primary"
          active={openPanel === 'all'}
          onClick={() => togglePanel('all')}
        />
        <StatTile
          label="เข้าร่วมประชุม"
          count={presentParticipants.length}
          icon={<UserCheck className="h-5 w-5" />}
          tone="emerald"
          active={openPanel === 'present'}
          onClick={() => togglePanel('present')}
        />
        <StatTile
          label="ไม่เข้าร่วมประชุม"
          count={absentParticipants.length}
          icon={<UserX className="h-5 w-5" />}
          tone="amber"
          active={openPanel === 'absent'}
          onClick={() => togglePanel('absent')}
        />
      </div>

      {openPanel === 'present' && (
        <Card className="border-emerald-500/30 shadow-soft">
          <CardHeader>
            <CardTitle className="font-display text-base">รายละเอียดผู้เข้าร่วม ({presentParticipants.length} คน)</CardTitle>
            <CardDescription>เรียงตามเวลาเช็คอินล่าสุด</CardDescription>
          </CardHeader>
          <CardContent>
            {presentParticipants.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ยังไม่มีผู้เช็คอิน</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {[...presentParticipants]
                  .sort((a, b) => {
                    const ta = new Date(checkinByMember.get(a.memberId)!.checkedInAt).getTime()
                    const tb = new Date(checkinByMember.get(b.memberId)!.checkedInAt).getTime()
                    return tb - ta
                  })
                  .map((p) => {
                    const checkin = checkinByMember.get(p.memberId)!
                    return (
                      <li key={p.memberId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 items-center gap-3">
                          <InitialsAvatar name={p.name} photo={checkin.photoUrl} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {p.department}
                              {p.position ? ` · ${p.position}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <CheckinMethodBadge method={checkin.method} manualLabel="เช็คอินด้วยรหัส" />
                          <span className="text-xs text-muted-foreground">{formatCheckinTime(checkin.checkedInAt)}</span>
                        </div>
                      </li>
                    )
                  })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {openPanel === 'absent' && (
        <Card className="border-amber-500/30 shadow-soft">
          <CardHeader>
            <CardTitle className="font-display text-base">รายละเอียดผู้ไม่เข้าร่วม ({absentParticipants.length} คน)</CardTitle>
            <CardDescription>บุคลากรที่ได้รับเชิญแต่ยังไม่ได้เช็คอิน</CardDescription>
          </CardHeader>
          <CardContent>
            {absentParticipants.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">เข้าร่วมครบทุกคนแล้ว</p>
            ) : (
              <ul className="divide-y divide-border/70">
                {absentParticipants.map((p) => (
                  <li key={p.memberId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <InitialsAvatar name={p.name} variant="muted" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.employeeId} · {p.department}
                        {p.position ? ` · ${p.position}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {openPanel === 'all' && (
        <Card className="border-border/70 shadow-soft">
          <CardHeader>
            <CardTitle className="font-display text-base">บุคลากรทั้งหมดที่ได้รับเชิญ</CardTitle>
            <CardDescription>รายชื่อทั้งหมด {participants.length} คน พร้อมสถานะการเช็คอิน</CardDescription>
          </CardHeader>
          <CardContent>
            {participants.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ยังไม่มีผู้เข้าร่วมในการประชุมนี้</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {participants.map((p) => {
                  const checkin = checkinByMember.get(p.memberId)
                  return (
                    <div
                      key={p.memberId}
                      className="flex items-center justify-between gap-2.5 rounded-xl border border-border/70 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <InitialsAvatar name={p.name} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.department}
                            {p.position ? ` · ${p.position}` : ''}
                          </p>
                        </div>
                      </div>
                      {checkin ? (
                        <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                          <CircleCheck className="h-3 w-3" /> {formatCheckinTime(checkin.checkedInAt)}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                          ยังไม่เข้าร่วม
                        </Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
