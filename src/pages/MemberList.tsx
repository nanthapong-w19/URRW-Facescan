import { useEffect, useMemo, useState } from 'react'
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserPlus, ScanFace, Pencil, Trash2, Search, CheckCircle2, CircleDashed, Eye, EyeOff } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { addMember, updateMember, deleteMember, registerFace, getMemberPhotos } from '@/lib/store'
import type { Member, MemberRole } from '@/lib/types'
import FaceCaptureDialog from '@/components/FaceCaptureDialog'
import { cn } from '@/lib/utils'

// 8 กลุ่มสาระการเรียนรู้ ตามหลักสูตรแกนกลางการศึกษาขั้นพื้นฐาน + ฝ่ายบริหาร
// (ไม่ใช่กลุ่มสาระตามหลักสูตร แต่เพิ่มเข้ามาเพื่อรองรับบุคลากรฝ่ายบริหาร)
const DEPARTMENTS = [
  'ภาษาไทย',
  'คณิตศาสตร์',
  'วิทยาศาสตร์และเทคโนโลยี',
  'สังคมศึกษา ศาสนา และวัฒนธรรม',
  'สุขศึกษาและพลศึกษา',
  'ศิลปะ',
  'การงานอาชีพ',
  'ภาษาต่างประเทศ',
  'ฝ่ายบริหาร',
  'บุคลากรทางการศึกษา',
]

// Fixed value set (unlike ตำแหน่ง/position, which is free text) — a
// dropdown makes sense here since there are exactly these fixed roles.
const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'ผู้ดูแลระบบ',
  user: 'ผู้ใช้งานทั่วไป',
  viewer: 'ผู้แสดงผล',
}
const ROLES: MemberRole[] = ['user', 'admin', 'viewer']

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
  const [showAdminViewer, setShowAdminViewer] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<MemberFormState>(emptyForm)

  const [faceDialogMember, setFaceDialogMember] = useState<Member | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null)

  // Photos are deliberately NOT part of useAppData's shared roster (they're
  // 60-120KB each, versus ~1KB for a face descriptor — see MEMBER_COLUMNS
  // in store.ts) so this is the one page that actually shows them fetching
  // its own copy, once, rather than paying that cost on every page/event.
  const [photos, setPhotos] = useState<Record<string, string | null>>({})

  useEffect(() => {
    let cancelled = false
    getMemberPhotos()
      .then((map) => {
        if (!cancelled) setPhotos(map)
      })
      .catch(() => {
        // non-critical: rows just fall back to initials if this fails
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return members.filter((m) => {
      const matchesQuery =
        !query ||
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.employeeId.toLowerCase().includes(query.toLowerCase())
      const matchesDept = deptFilter === 'all' || m.department === deptFilter
      const matchesRole = showAdminViewer || (m.role !== 'admin' && m.role !== 'viewer')
      return matchesQuery && matchesDept && matchesRole
    })
  }, [members, query, deptFilter, showAdminViewer])

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
        toast.success('แก้ไขข้อมูลบุคลากรเรียบร้อย')
      } else {
        await addMember({ ...form })
        toast.success('เพิ่มบุคลากรใหม่เรียบร้อย')
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
      const updated = await registerFace(faceDialogMember.id, descriptor, photo)
      // registerFace's own query still returns the full row (photo
      // included) — patch it into the locally-fetched photos map directly
      // instead of waiting on a refetch, since photos aren't part of the
      // realtime-synced roster from useAppData.
      setPhotos((prev) => ({ ...prev, [faceDialogMember.id]: updated.photo }))
      toast.success(`ลงทะเบียนใบหน้าของ ${faceDialogMember.name} สำเร็จ`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลงทะเบียนใบหน้าไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการบุคลากร"
        description="เพิ่ม แก้ไข และลงทะเบียนใบหน้าให้บุคลากรในระบบ"
        action={
          <Button onClick={openAddForm} className="gap-1.5 shadow-soft">
            <UserPlus className="h-4 w-4" /> เพิ่มบุคลากรใหม่
          </Button>
        }
      />

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display text-base">รายชื่อบุคลากร</CardTitle>
              <CardDescription>ทั้งหมด {filtered.length} คน</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ค้นหาชื่อ, รหัสพนักงาน"
                  className="w-full ps-8 sm:w-64"
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
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={() => setShowAdminViewer((v) => !v)}
              >
                {showAdminViewer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showAdminViewer ? 'ซ่อนผู้ดูแลระบบ/ผู้แสดงผล' : 'แสดงผู้ดูแลระบบ/ผู้แสดงผล'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>บุคลากร</TableHead>
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
                    ไม่พบบุคลากรที่ตรงกับเงื่อนไข
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((m) => (
                <TableRow key={m.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {photos[m.id] ? (
                        <img src={photos[m.id]!} alt={m.name} className="h-9 w-9 rounded-full object-cover" />
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
                          : m.role === 'viewer'
                            ? 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
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
                    <div className="flex items-center justify-end gap-2 opacity-80 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
            <DialogTitle className="font-display">{editingId ? 'แก้ไขข้อมูลบุคลากร' : 'เพิ่มบุคลากรใหม่'}</DialogTitle>
            <DialogDescription>กรอกข้อมูลบุคลากรให้ครบถ้วนก่อนบันทึก</DialogDescription>
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
              <Button type="submit">{editingId ? 'บันทึกการแก้ไข' : 'เพิ่มบุคลากร'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="ยืนยันการลบบุคลากร"
        description={
          <>
            คุณต้องการลบ <strong>{deleteTarget?.name}</strong> ออกจากระบบใช่หรือไม่? การลบข้อมูลนี้ไม่สามารถย้อนกลับได้
          </>
        }
        confirmLabel="ลบบุคลากร"
        confirmIcon={<Trash2 className="h-4 w-4" />}
        onConfirm={handleConfirmDelete}
      />

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
