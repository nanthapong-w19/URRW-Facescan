import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserPlus, ScanFace, Pencil, Trash2, Search, CheckCircle2, CircleDashed } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { addMember, updateMember, deleteMember, registerFace } from '@/lib/store'
import type { Member, MemberRole } from '@/lib/types'
import FaceCaptureDialog from '@/components/FaceCaptureDialog'
import { cn } from '@/lib/utils'

// 8 กลุ่มสาระการเรียนรู้ ตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน
const DEPARTMENTS = [
  'ภาษาไทย',
  'คณิตศาสตร์',
  'วิทยาศาสตร์และเทคโนโลยี',
  'สังคมศึกษา ศาสนา และวัฒนธรรม',
  'สุขศึกษาและพลศึกษา',
  'ศิลปะ',
  'การงานอาชีพ',
  'ภาษาต่างประเทศ',
]

// Fixed two-value set (unlike ตำแหน่ง/position, which is free text) — a
// dropdown makes sense here since there are exactly these two roles.
const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'ผู้ดูแลระบบ',
  user: 'ผู้ใช้งานทั่วไป',
}
const ROLES: MemberRole[] = ['user', 'admin']

interface MemberFormState {
  employeeId: string
  name: string
  department: string
  position: string
  role: MemberRole
}

const emptyForm: MemberFormState = {
  employeeId: '',
  name: '',
  department: DEPARTMENTS[0],
  position: '',
  role: 'user',
}

export default function MemberList() {
  const { members } = useAppData()
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState<string>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<MemberFormState>(emptyForm)

  const [faceDialogMember, setFaceDialogMember] = useState<Member | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null)

  const filtered = useMemo(() => {
    return members.filter((m) => {
      const matchesQuery =
        !query ||
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.employeeId.toLowerCase().includes(query.toLowerCase())
      const matchesDept = deptFilter === 'all' || m.department === deptFilter
      return matchesQuery && matchesDept
    })
  }, [members, query, deptFilter])

  function openAddForm() {
    setEditingId(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  function openEditForm(m: Member) {
    setEditingId(m.id)
    setForm({
      employeeId: m.employeeId,
      name: m.name,
      department: m.department,
      position: m.position,
      role: m.role,
    })
    setFormOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employeeId.trim() || !form.name.trim()) {
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน')
      return
    }
    try {
      if (editingId) {
        await updateMember(editingId, { ...form })
        toast.success('แก้ไขข้อมูลสมาชิกเรียบร้อย')
      } else {
        await addMember({ ...form })
        toast.success('เพิ่มสมาชิกใหม่เรียบร้อย')
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกข้อมูลไม่สำเร็จ')
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    try {
      await deleteMember(deleteTarget.id)
      toast.success(`ลบข้อมูลของ ${deleteTarget.name} แล้ว`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบข้อมูลไม่สำเร็จ')
    } finally {
      setDeleteTarget(null)
    }
  }

  async function handleFaceCaptured(descriptor: number[], photo: string) {
    if (!faceDialogMember) return
    try {
      await registerFace(faceDialogMember.id, descriptor, photo)
      toast.success(`ลงทะเบียนใบหน้าของ ${faceDialogMember.name} สำเร็จ`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลงทะเบียนใบหน้าไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
            จัดการสมาชิก
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">เพิ่ม แก้ไข และลงทะเบียนใบหน้าให้สมาชิกในระบบ</p>
        </div>
        <Button onClick={openAddForm} className="gap-1.5 shadow-soft">
          <UserPlus className="h-4 w-4" /> เพิ่มสมาชิกใหม่
        </Button>
      </div>

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display text-base">รายชื่อสมาชิก</CardTitle>
              <CardDescription>ทั้งหมด {filtered.length} คน</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ค้นหาชื่อ, รหัสพนักงาน"
                  className="w-full pl-8 sm:w-64"
                />
              </div>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue placeholder="กลุ่มสาระการเรียนรู้" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกกลุ่มสาระการเรียนรู้</SelectItem>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สมาชิก</TableHead>
                <TableHead>กลุ่มสาระการเรียนรู้</TableHead>
                <TableHead>ตำแหน่ง</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>สถานะใบหน้า</TableHead>
                <TableHead className="text-right">การจัดการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    ไม่พบสมาชิกที่ตรงกับเงื่อนไข
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((m) => (
                <TableRow key={m.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {m.photo ? (
                        <img src={m.photo} alt={m.name} className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-accent/25 font-display text-sm font-semibold text-primary">
                          {m.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.employeeId}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {m.department}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.position || '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        'gap-1 border-none font-normal',
                        m.role === 'admin'
                          ? 'bg-accent/20 text-amber-800 dark:text-accent'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {ROLE_LABELS[m.role]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        'gap-1 border-none font-normal',
                        m.faceStatus === 'registered'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {m.faceStatus === 'registered' ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <CircleDashed className="h-3 w-3" />
                      )}
                      {m.faceStatus === 'registered' ? 'ลงทะเบียนแล้ว' : 'ยังไม่ลงทะเบียน'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5 opacity-80 transition-opacity group-hover:opacity-100">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setFaceDialogMember(m)}
                      >
                        <ScanFace className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">ลงทะเบียนใบหน้า</span>
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => openEditForm(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleteTarget(m)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add / edit member form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editingId ? 'แก้ไขข้อมูลสมาชิก' : 'เพิ่มสมาชิกใหม่'}</DialogTitle>
            <DialogDescription>กรอกข้อมูลสมาชิกให้ครบถ้วนก่อนบันทึก</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="employeeId">รหัสพนักงาน</Label>
              <Input
                id="employeeId"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                placeholder="EMP-007"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">ชื่อ-นามสกุล</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="สมชาย ใจดี"
              />
            </div>
            <div className="space-y-1.5">
              <Label>กลุ่มสาระการเรียนรู้</Label>
              <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="position">ตำแหน่ง</Label>
              <Input
                id="position"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
                placeholder="เช่น ครู, ครูอัตราจ้าง, ผู้อำนวยการ"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as MemberRole })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]} ({r})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit">{editingId ? 'บันทึกการแก้ไข' : 'เพิ่มสมาชิก'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">ยืนยันการลบสมาชิก</DialogTitle>
            <DialogDescription>
              คุณต้องการลบ <strong>{deleteTarget?.name}</strong> ออกจากระบบใช่หรือไม่? การลบข้อมูลนี้ไม่สามารถย้อนกลับได้
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} className="gap-1.5">
              <Trash2 className="h-4 w-4" /> ลบสมาชิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Face registration */}
      {faceDialogMember && (
        <FaceCaptureDialog
          open={!!faceDialogMember}
          memberName={faceDialogMember.name}
          onOpenChange={(o) => !o && setFaceDialogMember(null)}
          onCaptured={handleFaceCaptured}
        />
      )}
    </div>
  )
}
