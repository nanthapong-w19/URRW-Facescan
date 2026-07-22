import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Users,
  UserCheck,
  UserX,
  Loader2,
  CircleCheck,
  ChevronDown,
} from 'lucide-react'
import { getMeeting, getMeetingCheckins } from '@/lib/store'
import { supabase } from '@/lib/supabaseClient'
import { applyMeetingCheckinEvent } from '@/lib/realtimeSync'
import type { RealtimeChange } from '@/lib/realtimeSync'
import type { Meeting, MeetingCheckin, MeetingCheckinRow } from '@/lib/types'
import { cn } from '@/lib/utils'

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

type Panel = 'present' | 'absent' | null

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
  const presentParticipants = useMemo(
    () => participants.filter((p) => checkinByMember.has(p.memberId)),
    [participants, checkinByMember]
  )
  const absentParticipants = useMemo(
    () => participants.filter((p) => !checkinByMember.has(p.memberId)),
    [participants, checkinByMember]
  )

  function togglePanel(panel: Panel) {
    setOpenPanel((prev) => (prev === panel ? null : panel))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูลสรุป...
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">ไม่พบการประชุมนี้ อาจถูกลบไปแล้ว</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/meetings">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> กลับไปหน้ารายการประชุม
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link to={`/meetings/${id}`}>
          <ArrowLeft className="h-3.5 w-3.5" /> กลับไปหน้าการประชุม
        </Link>
      </Button>

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="บุคลากรทั้งหมด"
          count={participants.length}
          icon={<Users className="h-5 w-5" />}
          tone="primary"
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
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full">
                            {checkin.photoUrl ? (
                              <img src={checkin.photoUrl} alt={p.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-foreground">
                                {p.name.charAt(0)}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {p.department}
                              {p.position ? ` · ${p.position}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge
                            variant="outline"
                            className={cn(
                              'gap-1 border-none text-xs font-normal',
                              checkin.method === 'face' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            )}
                          >
                            <CircleCheck className="h-3 w-3" />
                            {checkin.method === 'face' ? 'สแกนใบหน้า' : 'เช็คอินด้วยรหัส'}
                          </Badge>
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
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                      {p.name.charAt(0)}
                    </div>
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
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-foreground">
                        {p.name.charAt(0)}
                      </div>
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
    </div>
  )
}
