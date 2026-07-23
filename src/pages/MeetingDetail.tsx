import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { LoadingState } from '@/components/ui/loading-state'
import { InitialsAvatar } from '@/components/ui/initials-avatar'
import MeetingScanner from '@/components/MeetingScanner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Users,
  Trash2,
  FileText,
  CheckCircle2,
  Check,
  X,
  ClipboardList,
} from 'lucide-react'
import { getMeeting, deleteMeeting, getMeetingCheckins, recordMeetingCheckin, updateMeeting } from '@/lib/store'
import { useAdminAuth } from '@/lib/adminAuth'
import { MATCH_THRESHOLD } from '@/lib/faceEngine'
import { applyMeetingCheckinEvent } from '@/lib/realtimeSync'
import type { RealtimeChange } from '@/lib/realtimeSync'
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel'
import { MEETING_ROOMS } from '@/lib/constants'
import { MeetingRoomBadge } from '@/components/MeetingRoomBadge'
import type { Meeting, MeetingCheckin, MeetingCheckinRow, MeetingParticipant } from '@/lib/types'
import { cn, formatCheckinTime } from '@/lib/utils'

// `<input type="datetime-local">` wants local wall-clock time
// (YYYY-MM-DDTHH:mm), not the UTC-based ISO string Meeting.meetingTime
// stores — shift by the timezone offset before slicing, so editing a
// meeting shows the same local time formatMeetingTime displays.
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

// Split so the "วันและเวลา" tile can put the date and time on separate
// lines — `time` is null when there's nothing to show on a second line
// (no meetingTime set at all).
function formatMeetingDateParts(iso: string | null): { date: string; time: string | null } {
  if (!iso) return { date: 'ยังไม่กำหนดเวลา', time: null }
  try {
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString('th-TH', { dateStyle: 'full' }),
      time: d.toLocaleTimeString('th-TH', { timeStyle: 'short' }),
    }
  } catch {
    return { date: iso, time: null }
  }
}

// Short two-tone chime — same approach as FaceScanner.tsx, duplicated here
// (rather than shared) since it's ~15 lines and this page is otherwise
// independent of the daily check-in scanner.
function playSuccessChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    const now = ctx.currentTime
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.12)
      gain.gain.linearRampToValueAtTime(0.2, now + i * 0.12 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.12)
      osc.stop(now + i * 0.12 + 0.32)
    })
  } catch {
    // audio isn't critical to the flow; ignore failures silently
  }
}

// This page doubles as the meeting's public check-in kiosk — anyone with
// the link can open it and scan in, no admin login required (see App.tsx:
// unlike /meetings and /meetings/new, this route is NOT wrapped in
// RequireAdmin). Only the delete button below is conditionally shown to
// whoever happens to be logged in as admin on this browser.
export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { admin } = useAdminAuth()
  const isAdmin = admin?.role === 'admin'

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [checkins, setCheckins] = useState<MeetingCheckin[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const checkedInIds = useMemo(() => new Set(checkins.map((c) => c.memberId)), [checkins])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    Promise.all([getMeeting(id), getMeetingCheckins(id)])
      .then(([meetingData, checkinData]) => {
        if (cancelled) return
        setMeeting(meetingData)
        setCheckins(checkinData)
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'โหลดข้อมูลการประชุมไม่สำเร็จ'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // Live updates so a kiosk screen showing this page reflects check-ins
  // that happen from a *different* device scanning the same meeting. Each
  // event patches the one row it describes (via realtimeSync.ts) instead
  // of refetching this meeting's whole check-in list on every event; a
  // reconnect after a dropped websocket still gets a full refetch as a
  // safety net (see useRealtimeChannel's onReconnect), so an event missed
  // while disconnected can't leave this screen silently stale.
  useRealtimeChannel({
    table: 'facein_meeting_checkins',
    filter: `meeting_id=eq.${id}`,
    enabled: Boolean(id),
    onEvent: (payload) => {
      setCheckins((prev) => applyMeetingCheckinEvent(prev, payload as unknown as RealtimeChange<MeetingCheckinRow>))
    },
    onReconnect: () => {
      if (!id) return
      getMeetingCheckins(id)
        .then(setCheckins)
        .catch(() => {
          // non-critical: the next successful reconnect will catch up
        })
    },
  })

  async function handleDelete() {
    if (!id) return
    setDeleting(true)
    try {
      await deleteMeeting(id)
      toast.success('ลบการประชุมแล้ว')
      navigate('/meetings', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ลบการประชุมไม่สำเร็จ')
      setDeleting(false)
      setDeleteConfirmOpen(false)
    }
  }

  // Click-to-edit for the compact date/time · location · description strip
  // below. Admin-only (same gate as the delete button above) — this page is
  // deliberately NOT behind RequireAdmin (see the comment on the component),
  // so a visitor scanning in from a shared link must never be able to edit
  // the meeting, only whoever is logged in as admin on that browser.
  type EditableField = 'time' | 'location' | 'description'
  const [editingField, setEditingField] = useState<EditableField | null>(null)
  const [timeDraft, setTimeDraft] = useState('')
  const [locationDraft, setLocationDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [savingField, setSavingField] = useState(false)

  function startEditing(field: EditableField) {
    if (!isAdmin || !meeting) return
    if (field === 'time') setTimeDraft(toDatetimeLocalValue(meeting.meetingTime))
    if (field === 'location') setLocationDraft(meeting.location)
    if (field === 'description') setDescriptionDraft(meeting.description)
    setEditingField(field)
  }

  function cancelEditing() {
    setEditingField(null)
  }

  async function saveField(field: EditableField) {
    if (!id) return
    setSavingField(true)
    try {
      const patch =
        field === 'time'
          ? { meetingTime: timeDraft ? new Date(timeDraft).toISOString() : null }
          : field === 'location'
            ? { location: locationDraft }
            : { description: descriptionDraft }
      const updated = await updateMeeting(id, patch)
      setMeeting(updated)
      setEditingField(null)
      toast.success('บันทึกการแก้ไขแล้ว')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSavingField(false)
    }
  }

  async function handleCheckin(
    participant: MeetingParticipant,
    method: 'face' | 'manual',
    confidence?: number,
    photoUrl?: string
  ) {
    if (!id || checkedInIds.has(participant.memberId)) return
    try {
      const record = await recordMeetingCheckin(id, participant.memberId, method, confidence, photoUrl)
      setCheckins((prev) => [...prev, record])
      // No toast.success here — MeetingScanner shows its own in-tree
      // CheckinSuccessToast popup for both face and manual check-ins, which
      // (unlike a toast) stays visible while the scanner is in fullscreen.
      playSuccessChime()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ')
    }
  }

  if (loading) {
    return <LoadingState label="กำลังโหลดข้อมูลการประชุม..." />
  }

  if (!meeting) {
    return (
      <EmptyState title="ไม่พบการประชุมนี้ อาจถูกลบไปแล้ว">
        <Button asChild size="sm" variant="outline">
          <Link to="/meetings">
            <ArrowLeft className="me-1.5 h-3.5 w-3.5" /> กลับไปหน้ารายการประชุม
          </Link>
        </Button>
      </EmptyState>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-1.5 -ms-2">
        <Link to="/meetings">
          <ArrowLeft className="h-3.5 w-3.5" /> รายการประชุม
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">{meeting.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">สร้างโดย {meeting.createdByName || 'ไม่ทราบ'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to={`/meetings/${id}/summary`}>
              <ClipboardList className="h-3.5 w-3.5" /> สรุปข้อมูลการประชุม
            </Link>
          </Button>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
              isLoading={deleting}
              icon={<Trash2 className="h-3.5 w-3.5" />}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              ลบการประชุม
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="ยืนยันการลบการประชุม"
        description={
          <>
            คุณต้องการลบ <strong>{meeting.title}</strong> ใช่หรือไม่? การลบข้อมูลนี้ไม่สามารถย้อนกลับได้
          </>
        }
        confirmLabel="ลบการประชุม"
        confirmIcon={<Trash2 className="h-3.5 w-3.5" />}
        loading={deleting}
        onConfirm={handleDelete}
      />

      <MeetingScanner
        participants={meeting.participants}
        checkedInIds={checkedInIds}
        checkins={checkins}
        onMatch={(p, distance, photoUrl) => handleCheckin(p, 'face', 1 - distance / MATCH_THRESHOLD, photoUrl)}
        onManualCheckin={(p, photoUrl) => handleCheckin(p, 'manual', undefined, photoUrl)}
      />

      {/* Original tile layout, restored by request (the compact-strip and
          centered-pill redesigns that came after didn't stick) — still
          positioned below the scanner, and each field is still admin-only
          click-to-edit, same as before. */}
      <Card className="border-border/70 shadow-soft">
        <CardHeader>
          <CardTitle className="font-display text-base">รายละเอียดการประชุม</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {editingField === 'time' ? (
              <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2.5">
                <Input
                  type="datetime-local"
                  value={timeDraft}
                  onChange={(e) => setTimeDraft(e.target.value)}
                  className="h-8 text-xs"
                  autoFocus
                />
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => saveField('time')} disabled={savingField}>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={cancelEditing} disabled={savingField}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startEditing('time')}
                disabled={!isAdmin}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-left',
                  isAdmin && 'hover:border-primary/40 hover:bg-secondary'
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">วันและเวลา</p>
                  {(() => {
                    const { date, time } = formatMeetingDateParts(meeting.meetingTime)
                    return (
                      <>
                        <p className="truncate text-sm font-semibold text-foreground">{date}</p>
                        {time && <p className="truncate text-sm font-semibold text-foreground">{time}</p>}
                      </>
                    )
                  })()}
                </div>
              </button>
            )}

            {editingField === 'location' ? (
              <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2.5">
                <Select value={locationDraft || undefined} onValueChange={setLocationDraft}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="เลือกห้องประชุม" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEETING_ROOMS.map((room) => (
                      <SelectItem key={room} value={room} className="text-xs">
                        {room}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => saveField('location')} disabled={savingField}>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={cancelEditing} disabled={savingField}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startEditing('location')}
                disabled={!isAdmin}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-left',
                  isAdmin && 'hover:border-primary/40 hover:bg-secondary'
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-foreground">
                  <MapPin className="h-5 w-5 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">สถานที่</p>
                  {meeting.location ? (
                    <MeetingRoomBadge room={meeting.location} className="mt-0.5" />
                  ) : (
                    <p className="truncate text-sm font-semibold text-foreground">ไม่ระบุ</p>
                  )}
                </div>
              </button>
            )}
          </div>

          {editingField === 'description' ? (
            <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-border/70 bg-muted/40 p-4">
              <Textarea
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                rows={3}
                placeholder="วาระการประชุม หรือรายละเอียดเพิ่มเติม"
                className="text-sm"
                autoFocus
              />
              <div className="flex items-center justify-end gap-1.5">
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={cancelEditing} disabled={savingField}>
                  ยกเลิก
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1 px-2.5 text-xs"
                  onClick={() => saveField('description')}
                  isLoading={savingField}
                  icon={<Check className="h-3.5 w-3.5" />}
                >
                  บันทึก
                </Button>
              </div>
            </div>
          ) : meeting.description ? (
            <button
              type="button"
              onClick={() => startEditing('description')}
              disabled={!isAdmin}
              className={cn(
                'w-full rounded-xl border border-dashed border-border/70 bg-muted/40 p-4 text-left',
                isAdmin && 'hover:border-primary/40 hover:bg-muted/60'
              )}
            >
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> รายละเอียด
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{meeting.description}</p>
            </button>
          ) : (
            isAdmin && (
              <button
                type="button"
                onClick={() => startEditing('description')}
                className="w-full rounded-xl border border-dashed border-border/70 bg-muted/40 p-4 text-left text-muted-foreground/60 italic hover:border-primary/40 hover:bg-muted/60"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  <FileText className="h-3.5 w-3.5 shrink-0" /> เพิ่มรายละเอียด...
                </span>
              </button>
            )
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" /> ผู้เข้าร่วมประชุม
          </CardTitle>
          <CardDescription>
            เช็คอินแล้ว {checkedInIds.size} / {meeting.participants.length} คน
          </CardDescription>
        </CardHeader>
        <CardContent>
          {meeting.participants.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ยังไม่มีผู้เข้าร่วมในการประชุมนี้</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {meeting.participants.map((p) => {
                const checkin = checkins.find((c) => c.memberId === p.memberId)
                return (
                  <div key={p.memberId} className="flex items-center justify-between gap-2.5 rounded-xl border border-border/70 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <InitialsAvatar name={p.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.department}
                          {p.position ? ` · ${p.position}` : ''}
                        </p>
                      </div>
                    </div>
                    {checkin ? (
                      <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                        <CheckCircle2 className="h-3 w-3" /> {formatCheckinTime(checkin.checkedInAt)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">
                        ยังไม่เช็คอิน
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
