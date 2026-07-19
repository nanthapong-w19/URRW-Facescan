import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { CalendarDays, Users, Plus, MapPin, Loader2, LogOut, CalendarClock, CheckCircle2 } from 'lucide-react'
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
  const { admin, logout } = useAdminAuth()
  const navigate = useNavigate()
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

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">การประชุม</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            เข้าสู่ระบบในฐานะ <span className="font-medium text-foreground">{admin?.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
            <LogOut className="h-3.5 w-3.5" /> ออกจากระบบ
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/meetings/new">
              <Plus className="h-3.5 w-3.5" /> สร้างการประชุมใหม่
            </Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card p-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดรายการประชุม...
        </div>
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 bg-card p-10 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">ยังไม่มีการประชุมที่สร้างไว้</p>
          <Button asChild size="sm" className="mt-2 gap-1.5">
            <Link to="/meetings/new">
              <Plus className="h-3.5 w-3.5" /> สร้างการประชุมแรก
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((meeting) => {
            const attendance = attendanceRate(meeting)
            return (
              <Link key={meeting.id} to={`/meetings/${meeting.id}`}>
                <Card className="h-full border-border/70 shadow-soft transition-shadow hover:shadow-lift">
                  <CardHeader className="space-y-2">
                    <CardTitle className="font-display text-base leading-snug">{meeting.title}</CardTitle>
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
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <Users className="h-3 w-3" /> {meeting.participants.length} คน
                      </Badge>
                      <span className="text-xs text-muted-foreground">โดย {meeting.createdByName || 'ไม่ทราบ'}</span>
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
