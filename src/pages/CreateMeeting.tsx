import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { th } from 'date-fns/locale'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/ui/page-header'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Users, CalendarPlus, CalendarDays, Clock } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import { createMeeting } from '@/lib/store'
import { MEETING_ROOMS } from '@/lib/constants'

// 24-hour "HH:mm" — the everyday Thai convention (no am/pm split).
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

// Typed date field uses the everyday Thai written format: "dd/MM/yyyy" with
// a Buddhist-era year (yyyy = Gregorian + 543). Accepts 1-2 digit day/month
// so "3/7/2569" works while typing, not just the zero-padded form.
function parseThaiDateInput(text: string): Date | undefined {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return undefined
  const day = Number(m[1])
  const month = Number(m[2])
  const yearAD = Number(m[3]) - 543
  const date = new Date(yearAD, month - 1, day)
  // Rejects overflow like 31/02 silently rolling into March.
  if (date.getFullYear() !== yearAD || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  return date
}

function formatThaiDateInput(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear() + 543}`
}

// Typed time field: plain 24-hour "H:mm" or "HH:mm".
function parseTimeInput(text: string): string | undefined {
  const m = text.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return undefined
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

// Auto-inserts the group separator as digits are typed, e.g. "2307" ->
// "23/07" -> keep typing -> "23/07/2569". `groupLengths` is each segment's
// digit count (date: [2,2,4], time: [2,2]); a separator is appended right
// after a non-last segment fills up, so typing never requires the user to
// type "/" or ":" themselves.
// Deleting the separator itself (backspace landing on it, character count
// dropping but digit count unchanged) is treated as "delete the last digit
// too" — otherwise backspace would appear to do nothing right after a "/".
function autoFormatSegmented(raw: string, prevFormatted: string, groupLengths: number[], separator: string): string {
  let digits = raw.replace(/\D/g, '')
  if (raw.length < prevFormatted.length) {
    const prevDigits = prevFormatted.replace(/\D/g, '')
    if (digits.length === prevDigits.length && digits.length > 0) {
      digits = digits.slice(0, -1)
    }
  }
  const maxDigits = groupLengths.reduce((a, b) => a + b, 0)
  digits = digits.slice(0, maxDigits)

  let out = ''
  let idx = 0
  groupLengths.forEach((len, i) => {
    if (digits.length <= idx) return
    const isLast = i === groupLengths.length - 1
    const chunk = digits.slice(idx, idx + len)
    out += chunk
    idx += len
    if (!isLast && chunk.length === len) out += separator
  })
  return out
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
  const [dateInputText, setDateInputText] = useState('')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [meetingTimeOfDay, setMeetingTimeOfDay] = useState('')
  const [timeInputText, setTimeInputText] = useState('')
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [location, setLocation] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  // ผู้ดูแล (admin) and ผู้แสดงผล (viewer) are system/staff accounts, not
  // real meeting invitees — hidden from the roster entirely so they can't
  // be searched, selected, or swept in by "เลือกทั้งหมด".
  const members = useMemo(
    () =>
      allMembers.filter(
        (m) => !HIDDEN_EMPLOYEE_IDS.includes(m.employeeId.toLowerCase()) && m.role !== 'admin' && m.role !== 'viewer'
      ),
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
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="สร้างการประชุมใหม่"
        description="กรอกรายละเอียดและเลือกผู้เข้าร่วมจากรายชื่อสมาชิก"
      />

      <Card className="border-border/70 shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">รายละเอียดการประชุม</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title">ชื่อการประชุม *</Label>
            <Input id="meeting-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ประชุมกลุ่มสาระฯ ประจำเดือน" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-date">วันที่ประชุม</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverAnchor asChild>
                  <div className="relative">
                    <Input
                      id="meeting-date"
                      value={dateInputText}
                      onChange={(e) => {
                        const formatted = autoFormatSegmented(e.target.value, dateInputText, [2, 2, 4], '/')
                        setDateInputText(formatted)
                        if (!formatted.trim()) {
                          setMeetingDate(undefined)
                          return
                        }
                        const parsed = parseThaiDateInput(formatted)
                        if (parsed) setMeetingDate(parsed)
                      }}
                      onBlur={() => {
                        if (!dateInputText.trim()) {
                          setMeetingDate(undefined)
                          return
                        }
                        const parsed = parseThaiDateInput(dateInputText)
                        if (parsed) {
                          setMeetingDate(parsed)
                          setDateInputText(formatThaiDateInput(parsed))
                        } else {
                          setDateInputText(meetingDate ? formatThaiDateInput(meetingDate) : '')
                        }
                      }}
                      placeholder="วว/ดด/ปปปป (พ.ศ.)"
                      inputMode="numeric"
                      maxLength={10}
                      className="pe-9"
                    />
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute end-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                      >
                        <CalendarDays className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                  </div>
                </PopoverAnchor>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={th}
                    selected={meetingDate}
                    onSelect={(date) => {
                      setMeetingDate(date)
                      setDateInputText(date ? formatThaiDateInput(date) : '')
                      setDatePickerOpen(false)
                    }}
                    formatters={{
                      formatCaption: (date) =>
                        new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric' }).format(
                          date
                        ),
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-time-of-day">เวลาที่เริ่มประชุม</Label>
              <Popover open={timePickerOpen} onOpenChange={setTimePickerOpen}>
                <PopoverAnchor asChild>
                  <div className="relative">
                    <Input
                      id="meeting-time-of-day"
                      value={timeInputText}
                      onChange={(e) => {
                        const formatted = autoFormatSegmented(e.target.value, timeInputText, [2, 2], ':')
                        setTimeInputText(formatted)
                        if (!formatted.trim()) {
                          setMeetingTimeOfDay('')
                          return
                        }
                        const parsed = parseTimeInput(formatted)
                        if (parsed) setMeetingTimeOfDay(parsed)
                      }}
                      onBlur={() => {
                        if (!timeInputText.trim()) {
                          setMeetingTimeOfDay('')
                          return
                        }
                        const parsed = parseTimeInput(timeInputText)
                        if (parsed) {
                          setMeetingTimeOfDay(parsed)
                          setTimeInputText(parsed)
                        } else {
                          setTimeInputText(meetingTimeOfDay)
                        }
                      }}
                      placeholder="ชม:นาที เช่น 09:30"
                      inputMode="numeric"
                      maxLength={5}
                      className="pe-9"
                    />
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute end-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                      >
                        <Clock className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                  </div>
                </PopoverAnchor>
                <PopoverContent className="w-auto p-3" align="start">
                  <div className="flex items-center gap-2">
                    <Select
                      value={meetingTimeOfDay ? meetingTimeOfDay.split(':')[0] : undefined}
                      onValueChange={(hour) => {
                        const minute = meetingTimeOfDay ? meetingTimeOfDay.split(':')[1] : '00'
                        const next = `${hour}:${minute}`
                        setMeetingTimeOfDay(next)
                        setTimeInputText(next)
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder="ชม." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {HOURS.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground">:</span>
                    <Select
                      value={meetingTimeOfDay ? meetingTimeOfDay.split(':')[1] : undefined}
                      onValueChange={(minute) => {
                        const hour = meetingTimeOfDay ? meetingTimeOfDay.split(':')[0] : '00'
                        const next = `${hour}:${minute}`
                        setMeetingTimeOfDay(next)
                        setTimeInputText(next)
                      }}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue placeholder="นาที" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {MINUTES.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">น.</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={!meetingTimeOfDay}
                    onClick={() => setTimePickerOpen(false)}
                  >
                    ตกลง
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-location">สถานที่</Label>
              <Select value={location || undefined} onValueChange={setLocation}>
                <SelectTrigger id="meeting-location">
                  <SelectValue placeholder="เลือกห้องประชุม" />
                </SelectTrigger>
                <SelectContent>
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
              <Users className="h-4 w-4 text-primary" /> เลือกผู้เข้าร่วม
            </CardTitle>
            <CardDescription>เลือกแล้ว {selectedIds.size} คน จากทั้งหมด {members.length} คน</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleSelectAll}
            disabled={members.length === 0}
          >
            {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อ รหัสพนักงาน หรือกลุ่มสาระฯ" className="ps-8" />
          </div>
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
  )
}
