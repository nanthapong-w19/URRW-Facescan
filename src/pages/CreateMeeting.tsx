import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, Users, CalendarPlus } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import { createMeeting } from '@/lib/store'
import { MEETING_ROOMS } from '@/lib/constants'

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
  const [meetingTime, setMeetingTime] = useState('')
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
      const meeting = await createMeeting({
        title: title.trim(),
        description: description.trim(),
        meetingTime: meetingTime ? new Date(meetingTime).toISOString() : null,
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="meeting-time">วันและเวลา</Label>
              <Input id="meeting-time" type="datetime-local" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
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
