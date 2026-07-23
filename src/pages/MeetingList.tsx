import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { LoadingState } from '@/components/ui/loading-state'
import { CalendarDays, Users, Plus, MapPin, CalendarClock, CheckCircle2 } from 'lucide-react'
import { getMeetings } from '@/lib/store'
import { useAdminAuth } from '@/lib/adminAuth'
import type { Meeting } from '@/lib/types'

// checkedInCount/participants.length as a percentage, shown per meeting
// card. Guards the 0-participants case (would otherwise be 0/0 → NaN%).
function attendanceRate(meeting: Meeting): { percent: number; label: string } {
  const total = meeting.participants.length
  if (total === 0) return { percent: 0, label: 'ยังไม่มีผู้เข้าร่วม' }
  const percent = Math.round((meeting.checkedInCount / total) * 100)
  return { percent, label: `${meeting.checkedInCount}/${total} คน (${percent}%)` }
}

function formatMeetingTime(iso: string | null) {
  if (!iso) return 'ยังไม่กำหนดเวลา'
  try {
    return new Date(iso).toLocaleString('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

export default function MeetingList() {
  const { admin } = useAdminAuth()
  const isAdmin = admin?.role === 'admin'
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getMeetings()
      .then((data) => {
        if (!cancelled) setMeetings(data)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'โหลดรายการประชุมไม่สำเร็จ'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      {/* The "ออกจากระบบ" (logout) button that used to sit here was removed
          by request (round 38) — the navbar already has its own logout
          button whenever an admin session is active, so this page-level
          duplicate was redundant. This header now only shows the page
          title, who's logged in, and the "create meeting" action. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">การประชุม</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            เข้าสู่ระบบในฐานะ <span className="font-medium text-foreground">{admin?.name}</span>
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/meetings/new">
                <Plus className="h-3.5 w-3.5" /> สร้างการประชุมใหม่
              </Link>
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <LoadingState label="กำลังโหลดรายการประชุม..." />
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card p-10 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">ยังไม่มีการประชุมที่สร้างไว้</p>
          {isAdmin && (
            <Button asChild size="sm" className="mt-2 gap-1.5">
              <Link to="/meetings/new">
                <Plus className="h-3.5 w-3.5" /> สร้างการประชุมแรก
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((meeting) => {
            const attendance = attendanceRate(meeting)
            return (
              <Link key={meeting.id} to={isAdmin ? `/meetings/${meeting.id}` : `/meetings/${meeting.id}/summary`}>
                <Card className="h-full border-border/70 shadow-soft transition-shadow hover:shadow-lift">
                  <CardHeader className="space-y-2">
                    <CardTitle className="font-display line-clamp-2 text-base leading-snug">{meeting.title}</CardTitle>
                    <CardDescription className="flex items-center gap-1.5 text-xs">
                      <CalendarDays className="h-3.5 w-3.5" /> {formatMeetingTime(meeting.meetingTime)}
                    </CardDescription>
                    {meeting.location && (
                      <CardDescription className="flex items-center gap-1.5 text-xs">
                        <MapPin className="h-3.5 w-3.5" /> {meeting.location}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                        <Users className="h-3 w-3" /> {meeting.participants.length} คน
                      </Badge>
                      <span className="min-w-0 truncate text-right text-xs text-muted-foreground">โดย {meeting.createdByName || 'ไม่ทราบ'}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3" /> อัตราการเข้าประชุม
                        </span>
                        <span className="font-medium text-foreground">{attendance.label}</span>
                      </div>
                      <Progress value={attendance.percent} className="h-1.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
