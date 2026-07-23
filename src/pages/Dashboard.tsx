import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Users, UserCheck, TrendingUp, Clock, ScanFace, ArrowUpRight, CircleCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { PulseDot } from '@/components/PulseDot'
import { CheckinMethodBadge } from '@/components/CheckinMethodBadge'
import { CheckinIdentity } from '@/components/CheckinIdentity'
import { useAppData } from '@/hooks/useAppData'
import { todaysCheckins } from '@/lib/store'
import { cn } from '@/lib/utils'
import AttendanceDonut from '@/components/AttendanceDonut'

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'เมื่อสักครู่'
  if (mins < 60) return `${mins} นาทีที่แล้ว`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

export default function Dashboard() {
  const { members, checkins } = useAppData()

  const stats = useMemo(() => {
    const today = todaysCheckins(checkins)
    const uniqueToday = new Set(today.map((c) => c.memberId))
    const total = members.length
    const rate = total > 0 ? Math.round((uniqueToday.size / total) * 100) : 0
    return {
      total,
      checkedInToday: uniqueToday.size,
      rate,
      registered: members.filter((m) => m.faceStatus === 'registered').length,
    }
  }, [members, checkins])

  const recent = useMemo(() => checkins.slice(0, 8), [checkins])

  return (
    <div className="space-y-6">
      <PageHeader
        title="ภาพรวมระบบ"
        description="สรุปสถานะการเช็คอินและสมาชิกทั้งหมดแบบเรียลไทม์"
        action={
          <Button asChild className="gap-1.5 shadow-soft">
            <Link to="/scan">
              <ScanFace className="h-4 w-4" />
              ไปที่หน้าสแกนเช็คอิน
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/70 shadow-soft transition-transform hover:-translate-y-0.5">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">สมาชิกทั้งหมด</p>
              <p className="font-display mt-1 text-3xl font-bold text-foreground">{stats.total}</p>
              <p className="mt-1 text-xs text-muted-foreground">{stats.registered} คนลงทะเบียนใบหน้าแล้ว</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft transition-transform hover:-translate-y-0.5">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">เช็คอินวันนี้</p>
              <p className="font-display mt-1 text-3xl font-bold text-foreground">{stats.checkedInToday}</p>
              <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                <ArrowUpRight className="h-3.5 w-3.5" /> อัปเดตอัตโนมัติ
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <UserCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft transition-transform hover:-translate-y-0.5">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">อัตราการเข้าประชุม</p>
              <p className="font-display mt-1 text-3xl font-bold text-foreground">{stats.rate}%</p>
              <p className="mt-1 text-xs text-muted-foreground">จากสมาชิกทั้งหมด {stats.total} คน</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft transition-transform hover:-translate-y-0.5">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">รอเช็คอิน</p>
              <p className="font-display mt-1 text-3xl font-bold text-foreground">
                {Math.max(stats.total - stats.checkedInToday, 0)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">ยังไม่เช็คอินวันนี้</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border/70 shadow-soft lg:col-span-1">
          <CardHeader>
            <CardTitle className="font-display text-base">อัตราการเข้าประชุมวันนี้</CardTitle>
            <CardDescription>สัดส่วนผู้เช็คอินเทียบกับสมาชิกทั้งหมด</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 pb-8">
            <AttendanceDonut percent={stats.rate} label="อัตราเข้าประชุม" />
            <div className="flex w-full items-center justify-around border-t border-border/70 pt-4 text-center">
              <div>
                <p className="font-display text-lg font-bold text-primary">{stats.checkedInToday}</p>
                <p className="text-xs text-muted-foreground">เช็คอินแล้ว</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="font-display text-lg font-bold text-foreground">{stats.total}</p>
                <p className="text-xs text-muted-foreground">ทั้งหมด</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display text-base">ประวัติการเช็คอินล่าสุด</CardTitle>
              <CardDescription>อัปเดตแบบเรียลไทม์เมื่อมีการเช็คอินใหม่</CardDescription>
            </div>
            <Badge variant="secondary" className="gap-1 font-normal">
              <PulseDot />
              Live
            </Badge>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
                <ScanFace className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">ยังไม่มีการเช็คอินวันนี้</p>
                <Button asChild size="sm" variant="outline" className="mt-1">
                  <Link to="/scan">เริ่มสแกนเช็คอิน</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {recent.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-3 first:pt-0 last:pb-0 sm:gap-3">
                    <CheckinIdentity name={c.name} position={c.position} department={c.department} avatarVariant="soft" />
                    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                      <CheckinMethodBadge method={c.method} className="hidden sm:inline-flex" />
                      <CircleCheck
                        className={cn(
                          'h-4 w-4 shrink-0 sm:hidden',
                          c.method === 'face' ? 'text-primary' : 'text-muted-foreground'
                        )}
                      />
                      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground sm:w-20">{timeAgo(c.time)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
