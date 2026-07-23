import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { SearchInput } from '@/components/ui/search-input'
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
import { InitialsAvatar } from '@/components/ui/initials-avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { UserPlus, ScanFace, Pencil, Trash2, CheckCircle2, CircleDashed, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
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
  'กิจกรรมแนะแนว',
  'ฝ่ายบริหาร',
  'บุคลากรทางการศึกษา',
]

const POSITIONS = [
  'ผู้อำนวยการ',
  'รองผู้อำนวยการ',
  'ผู้ช่วยผู้อำนวยการ',
  'ครู',
  'ครูอัตราจ้าง',
  'ครูผู้ช่วย',
  'พนักงานราชการ',
  'เจ้าหน้าที่สำนักงาน',
]

// Fixed value set — a dropdown makes sense here since there are exactly
// these fixed roles.
const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'ผู้ดูแลระบบ',
  user: 'ผู้ใช้งานทั่วไป',
  viewer: 'ผู้แสดงผล',
}
const ROLES: MemberRole[] = ['user', 'admin', 'viewer']

type SortKey = 'employeeId' | 'name' | 'department' | 'position' | 'role' | 'faceStatus'

function sortValue(m: Member, key: SortKey): string {
  switch (key) {
    case 'employeeId':
      return m.employeeId
    case 'name':
      return m.name
    case 'department':
      return m.department
    case 'position':
      return m.position || ''
    case 'role':
      return ROLE_LABELS[m.role]
    case 'faceStatus':
      return m.faceStatus === 'registered' ? 'ลงทะเบียนแล้ว' : 'ยังไม่ลงทะเบียน'
  }
}

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
  position: POSITIONS[0],
  role: 'user',
}

interface SortableTableHeadProps {
  sortKey: SortKey
  activeKey: SortKey | null
  dir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  children: ReactNode
}

function SortableTableHead({ sortKey: key, activeKey, dir, onSort, children }: SortableTableHeadProps) {
  const active = activeKey === key
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(key)}
        className="flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {active ? (
          dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}

export default function MemberList() {
  const { members } = useAppData()
  const [query, setQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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
    const result = members.filter((m) => {
      const matchesQuery =
        !query ||
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.employeeId.toLowerCase().includes(query.toLowerCase())
      const matchesDept = deptFilter === 'all' || m.department === deptFilter
      return matchesQuery && matchesDept
    })
    if (sortKey) {
      const dir = sortDir === 'asc' ? 1 : -1
      result.sort((a, b) => sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), 'th') * dir)
    }
    return result
  }, [members, query, deptFilter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

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

      <Card className="flex max-h-[70vh] flex-col border-border/70 shadow-soft">
        <CardHeader className="shrink-0 gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display text-base">รายชื่อบุคลากร</CardTitle>
              <CardDescription>ทั้งหมด {filtered.length} คน</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อ, รหัส"
                className="w-full sm:w-64"
              />
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
        <CardContent className="min-h-0 flex-1 overflow-auto">
          {/* min-w-max: without it, the table's own `w-full` just lets columns
              shrink to fit a narrow viewport and cell content (name, badges)
              wraps onto multiple lines — this parent's overflow-auto never
              actually engages horizontally. min-w-max forces the table to its
              natural content width instead, so it's this that scrolls
              horizontally on mobile while every cell stays on one line.
              Vertically, this same overflow-auto is what makes the row list
              scroll inside the fixed-height card instead of growing the
              whole page. */}
          <Table className="min-w-max">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <SortableTableHead sortKey="employeeId" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
                  รหัส
                </SortableTableHead>
                <SortableTableHead sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
                  บุคลากร
                </SortableTableHead>
                <SortableTableHead sortKey="department" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
                  กลุ่มสาระการเรียนรู้
                </SortableTableHead>
                <SortableTableHead sortKey="position" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
                  ตำแหน่ง
                </SortableTableHead>
                <SortableTableHead sortKey="role" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
                  บทบาท
                </SortableTableHead>
                <SortableTableHead sortKey="faceStatus" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>
                  สถานะใบหน้า
                </SortableTableHead>
                <TableHead className="text-left">เครื่องมือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    ไม่พบบุคลากรที่ตรงกับเงื่อนไข
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((m) => (
                <TableRow key={m.id} className="group">
                  <TableCell className="text-sm text-muted-foreground">{m.employeeId}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <InitialsAvatar name={m.name} photo={photos[m.id]} variant="soft" />
                      <p className="text-sm font-medium text-foreground">{m.name}</p>
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
                        <span className="hidden md:inline">ใบหน้า</span>
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
              <Label htmlFor="employeeId">รหัส</Label>
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
              <Label>ตำแหน่ง</Label>
              <Select value={form.position} onValueChange={(v) => setForm({ ...form, position: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
