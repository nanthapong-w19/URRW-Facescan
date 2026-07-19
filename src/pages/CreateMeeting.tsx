import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Search, Users, Loader2, CalendarPlus } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import { createMeeting } from '@/lib/store'

export default function CreateMeeting() {
  const { members } = useAppData()
  const { admin } = useAdminAuth()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [meetingTime, setMeetingTime] = useState('')
  const [location, setLocation] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)

  // Anyone in the roster can be invited — not just role === 'user' — since
  // an admin may reasonably want to invite another admin too.
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
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
          สร้างการประชุมใหม่
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">กรอกรายละเอียดและเลือกผู้เข้าร่วมจากรายชื่อสมาชิก</p>
      </div>

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
              <Input id="meeting-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="เช่น ห้องประชุมใหญ่" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="meeting-description">รายละเอียด</Label>
            <Textarea id="meeting-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="วาระการประชุม หรือรายละเอียดเพิ่มเติม" rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" /> เลือกผู้เข้าร่วม
            </CardTitle>
            <CardDescription>เลือกแล้ว {selectedIds.size} คน จากทั้งหมด {members.length} คน</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อ รหัสพนักงาน หรือกลุ่มสาระฯ" className="pl-8" />
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
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id={`member-${m.id}`}
                    checked={selectedIds.has(m.id)}
                    onCheckedChange={() => toggleMember(m.id)}
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.employeeId} · {m.department}
                      {m.position ? ` · ${m.position}` : ''}
                    </p>
                  </div>
                </div>
                {m.role === 'admin' && (
                  <Badge variant="secondary" className="font-normal">
                    admin
                  </Badge>
                )}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={submitting}>
          ยกเลิก
        </Button>
        <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
          สร้างการประชุม
        </Button>
      </div>
    </div>
  )
}
