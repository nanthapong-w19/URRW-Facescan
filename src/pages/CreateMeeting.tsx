import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Users, CalendarPlus, CalendarDays, Clock, CheckCircle2, ChevronUp, ChevronDown } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import { createMeeting } from '@/lib/store'
import { MEETING_ROOMS } from '@/lib/constants'
import { formatThaiDateInput } from '@/lib/thaiCalendar'
import { cn } from '@/lib/utils'

// One column of the time panel — an hour or minute value with tap-to-spin
// chevrons either side, wrapping at `max` (23 for hours, 59 for minutes)
// instead of clamping, so holding the button cycles round the clock.
function TimeSpinner({ value, onChange, max }: { value: number; onChange: (next: number) => void; max: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-9 text-muted-foreground"
        onClick={() => onChange((value + 1) % (max + 1))}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-secondary/50 text-sm font-semibold tabular-nums text-foreground">
        {String(value).padStart(2, '0')}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-9 text-muted-foreground"
        onClick={() => onChange((value - 1 + (max + 1)) % (max + 1))}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  )
}

// Hidden system account — never shown, searchable, or selectable as a
// meeting participant (not a real invitee, so it shouldn't appear in the
// roster this page picks from, nor get swept in by "เลือกทั้งหมด").
const HIDDEN_EMPLOYEE_IDS = ['superurrwnm']

export default function CreateMeeting() {
  const { members: allMembers } = useAppData()
  const { admin } = useAdminAuth()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [meetingDate, setMeetingDate] = useState<Date | undefined>(undefined)
  const [meetingTimeOfDay, setMeetingTimeOfDay] = useState('')
  const [dateTimePickerOpen, setDateTimePickerOpen] = useState(false)
  const [location, setLocation] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  // ผู้ดูแล (admin) and ผู้แสดงผล (viewer) are system/staff accounts, not
  // real meeting invitees — hidden from the roster entirely so they can't
  // be searched, selected, or swept in by "เลือกทั้งหมด".
  const members = useMemo(
    () =>
      allMembers
        .filter(
          (m) => !HIDDEN_EMPLOYEE_IDS.includes(m.employeeId.toLowerCase()) && m.role !== 'admin' && m.role !== 'viewer'
        )
        .sort((a, b) => a.employeeId.localeCompare(b.employeeId, 'th')),
    [allMembers]
  )

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.employeeId.toLowerCase().includes(q) || m.department.toLowerCase().includes(q)
    )
  }, [members, query])

  function toggleMember(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Bulk-invite every regular user in the (visible) roster — admin/viewer
  // accounts are already excluded from `members` above, so this is all
  // ผู้ใช้งานทั่วไป, regardless of whether they have a registered face yet
  // (those without one can still be invited and check in manually).
  const allSelected = members.length > 0 && members.every((m) => selectedIds.has(m.id))

  // Toggle: press once to select everyone, press again (once they're all
  // already selected) to clear the selection entirely — a second press is
  // read as "start over," not "un-invite only the auto-selected ones."
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(members.map((m) => m.id)))
  }

  async function handleSubmit() {
    if (!admin) return
    if (!title.trim()) {
      toast.error('กรุณากรอกชื่อการประชุม')
      return
    }
    setSubmitting(true)
    try {
      const meetingDateStr = meetingDate ? format(meetingDate, 'yyyy-MM-dd') : ''
      const combinedMeetingTime = meetingDateStr ? `${meetingDateStr}T${meetingTimeOfDay || '00:00'}` : ''
      const meeting = await createMeeting({
        title: title.trim(),
        description: description.trim(),
        meetingTime: combinedMeetingTime ? new Date(combinedMeetingTime).toISOString() : null,
        location: location.trim(),
        createdByMemberId: admin.id,
        createdByName: admin.name,
        participantIds: Array.from(selectedIds),
      })
      toast.success('สร้างการประชุมสำเร็จ')
      navigate(`/meetings/${meeting.id}`, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'สร้างการประชุมไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      {/* Same animated เลือดหมู-แดง-ทอง backdrop as /#/meetings (and
          /#/members, /#/login) — `fixed` so it fills the viewport
          regardless of scroll. `z-0` here + `relative z-10` on the
          wrapper below (rather than `-z-10`) because AppShell's own
          wrapper div (`bg-background`, App.tsx) is a plain non-positioned
          block, which paints above negative-z-index descendants no
          matter how deep they're nested. */}
      <div
        className="pointer-events-none fixed inset-0 z-0 animate-login-gradient bg-[linear-gradient(135deg,hsl(350_62%_10%)_0%,hsl(350_62%_24%)_28%,hsl(355_55%_34%)_48%,hsl(38_68%_38%)_62%,hsl(350_60%_16%)_80%,hsl(350_62%_10%)_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed left-1/2 top-1/3 z-0 h-[560px] w-[560px] animate-login-sheen rounded-full bg-[radial-gradient(circle,hsl(45_65%_92%/0.55)_0%,transparent_70%)] blur-3xl"
        aria-hidden
      />
      <div className="animate-page-in relative z-10 mx-auto max-w-3xl space-y-6">
      <Card className="border-border/70 shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">กรอกรายละเอียดการประชุม</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title">ชื่อการประชุม *</Label>
            <Input id="meeting-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ประชุมกลุ่มสาระฯ ประจำเดือน" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="meeting-datetime">วันที่ & เวลาประชุม</Label>
              <Popover open={dateTimePickerOpen} onOpenChange={setDateTimePickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    id="meeting-datetime"
                    type="button"
                    className="flex h-10 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground">
                      <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                      {meetingDate ? (
                        formatThaiDateInput(meetingDate)
                      ) : (
                        <span className="text-muted-foreground">วว/ดด/ปปปป</span>
                      )}
                    </span>
                    <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-foreground">
                      <Clock className="h-4 w-4 shrink-0 text-primary" />
                      {meetingTimeOfDay ? `${meetingTimeOfDay} น.` : <span className="text-muted-foreground">--:--</span>}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start" side="bottom" avoidCollisions={false}>
                  <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">เลือกวันที่และเวลา</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setMeetingDate(new Date())}
                      >
                        วันนี้
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          const now = new Date()
                          setMeetingDate(now)
                          setMeetingTimeOfDay(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
                        }}
                      >
                        ตอนนี้
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row">
                    <Calendar
                      mode="single"
                      locale={th}
                      selected={meetingDate}
                      onSelect={(date) => setMeetingDate(date)}
                      className="p-2 [--cell-size:1.75rem]"
                      formatters={{
                        formatCaption: (date) =>
                          new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric' }).format(
                            date
                          ),
                      }}
                    />
                    <div className="flex flex-col items-center gap-2 border-t border-border/70 p-3 sm:border-l sm:border-t-0">
                      <span className="text-xs font-medium text-muted-foreground">เวลา</span>
                      <div className="flex items-center gap-1.5">
                        <TimeSpinner
                          max={23}
                          value={meetingTimeOfDay ? Number(meetingTimeOfDay.split(':')[0]) : 0}
                          onChange={(hour) => {
                            const minute = meetingTimeOfDay ? meetingTimeOfDay.split(':')[1] : '00'
                            setMeetingTimeOfDay(`${String(hour).padStart(2, '0')}:${minute}`)
                          }}
                        />
                        <span className="text-lg font-semibold text-muted-foreground">:</span>
                        <TimeSpinner
                          max={59}
                          value={meetingTimeOfDay ? Number(meetingTimeOfDay.split(':')[1]) : 0}
                          onChange={(minute) => {
                            const hour = meetingTimeOfDay ? meetingTimeOfDay.split(':')[0] : '00'
                            setMeetingTimeOfDay(`${hour}:${String(minute).padStart(2, '0')}`)
                          }}
                        />
                        <span className="text-sm text-muted-foreground">น.</span>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border/70 p-2">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      onClick={() => setDateTimePickerOpen(false)}
                    >
                      ตกลง
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-location">สถานที่</Label>
              <Select value={location || undefined} onValueChange={setLocation}>
                <SelectTrigger id="meeting-location">
                  <SelectValue placeholder="เลือกห้องประชุม" />
                </SelectTrigger>
                <SelectContent side="bottom" avoidCollisions={false}>
                  {MEETING_ROOMS.map((room) => (
                    <SelectItem key={room} value={room}>
                      {room}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-description">รายละเอียด</Label>
            <Textarea id="meeting-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="วาระการประชุม หรือรายละเอียดเพิ่มเติม" rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" /> เลือกบุคลากรที่เข้าร่วม
            </CardTitle>
            {/* The selected count is the one number this card exists to
                report — this list runs to 150+ rows (see PRODUCT.md), so an
                admin bulk-inviting a whole department needs to confirm
                "how many so far" without counting checkboxes. Coloring just
                that number (accent once non-zero, muted at zero) makes it
                the thing the eye lands on first in this line. */}
            <CardDescription>
              เลือกแล้ว{' '}
              <span className={cn('font-semibold', selectedIds.size > 0 ? 'text-accent' : 'text-muted-foreground')}>
                {selectedIds.size}
              </span>{' '}
              คน จากทั้งหมด {members.length} คน
            </CardDescription>
          </div>
          <Button
            type="button"
            variant={allSelected ? 'default' : 'outline'}
            size="sm"
            onClick={toggleSelectAll}
            disabled={members.length === 0}
            className="gap-1.5"
          >
            {allSelected && <CheckCircle2 className="h-3.5 w-3.5" />}
            {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อ รหัสพนักงาน หรือกลุ่มสาระฯ" />
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-border/70 p-2">
            {filteredMembers.length === 0 && (
              <p className="p-3 text-center text-sm text-muted-foreground">ไม่พบสมาชิกที่ตรงกัน</p>
            )}
            {filteredMembers.map((m) => (
              <label
                key={m.id}
                htmlFor={`member-${m.id}`}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-secondary"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Checkbox
                    id={`member-${m.id}`}
                    checked={selectedIds.has(m.id)}
                    onCheckedChange={() => toggleMember(m.id)}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.employeeId} · {m.department}
                      {m.position ? ` · ${m.position}` : ''}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
          ยกเลิก
        </Button>
        <Button onClick={handleSubmit} isLoading={submitting} icon={<CalendarPlus className="h-4 w-4" />} className="gap-1.5">
          สร้างการประชุม
        </Button>
      </div>
      </div>
    </div>
  )
}
