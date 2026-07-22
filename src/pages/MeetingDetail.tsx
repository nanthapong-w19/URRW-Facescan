import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
  Loader2,
  Trash2,
  FileText,
  ScanFace,
  Camera,
  CameraOff,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Search,
  Maximize2,
  Minimize2,
  Check,
  X,
} from 'lucide-react'
import { getMeeting, deleteMeeting, getMeetingCheckins, recordMeetingCheckin, updateMeeting } from '@/lib/store'
import { supabase } from '@/lib/supabaseClient'
import { useAdminAuth } from '@/lib/adminAuth'
import { loadFaceModels, detectFaceWithDescriptor, descriptorDistance, MATCH_THRESHOLD } from '@/lib/faceEngine'
import { describeGetUserMediaError } from '@/lib/cameraHelpers'
import { applyMeetingCheckinEvent } from '@/lib/realtimeSync'
import type { RealtimeChange } from '@/lib/realtimeSync'
import { MEETING_ROOMS } from '@/lib/constants'
import type { Meeting, MeetingCheckin, MeetingCheckinRow, MeetingParticipant } from '@/lib/types'
import { cn } from '@/lib/utils'

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

function formatCheckinTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
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

type CameraState = 'idle' | 'loading' | 'ready' | 'error'
type ScanFeedback = { name: string; department: string } | null

const SCAN_INTERVAL_MS = 500
const REPEAT_COOLDOWN_MS = 15000
// The same person must match continuously for this long before a check-in
// is actually recorded — protects against a single fleeting frame (motion
// blur, someone briefly walking past, a photo held up for an instant)
// triggering a check-in immediately. ~1.5s of holding steady in front of
// the camera, same idea as a tap-and-hold button.
const CONFIRM_HOLD_MS = 1500

// This page doubles as the meeting's public check-in kiosk — anyone with
// the link can open it and scan in, no admin login required (see App.tsx:
// unlike /meetings and /meetings/new, this route is NOT wrapped in
// RequireAdmin). Only the delete button below is conditionally shown to
// whoever happens to be logged in as admin on this browser.
export default function MeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { admin } = useAdminAuth()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [checkins, setCheckins] = useState<MeetingCheckin[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  const checkedInIds = useMemo(() => new Set(checkins.map((c) => c.memberId)), [checkins])
  const registeredParticipants = useMemo(
    () => (meeting?.participants ?? []).filter((p) => p.faceDescriptor),
    [meeting]
  )
  // Lookup used by MeetingScanner's side "เช็คอินล่าสุด" panel so it can show
  // a name/department for every check-in row, including ones checked in
  // manually (no faceDescriptor, so they're outside registeredParticipants).
  const participantsById = useMemo(
    () => new Map((meeting?.participants ?? []).map((p) => [p.memberId, p])),
    [meeting]
  )

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
  // safety net (see the `hasConnectedBefore` gate below), so an event
  // missed while disconnected can't leave this screen silently stale.
  useEffect(() => {
    if (!id) return
    let hasConnectedBefore = false
    const channel = supabase
      .channel(`facein-meeting-checkins-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'facein_meeting_checkins', filter: `meeting_id=eq.${id}` },
        (payload) => {
          setCheckins((prev) =>
            applyMeetingCheckinEvent(prev, payload as unknown as RealtimeChange<MeetingCheckinRow>)
          )
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hasConnectedBefore) {
            getMeetingCheckins(id)
              .then(setCheckins)
              .catch(() => {
                // non-critical: the next successful reconnect will catch up
              })
          }
          hasConnectedBefore = true
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

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
    if (!admin || !meeting) return
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

  async function handleCheckin(participant: MeetingParticipant, method: 'face' | 'manual', confidence?: number) {
    if (!id || checkedInIds.has(participant.memberId)) return
    try {
      const record = await recordMeetingCheckin(id, participant.memberId, method, confidence)
      setCheckins((prev) => [...prev, record])
      toast.success(`เช็คอินสำเร็จ: ${participant.name}`, { duration: 3500 })
      playSuccessChime()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เช็คอินไม่สำเร็จ')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดข้อมูลการประชุม...
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">ไม่พบการประชุมนี้ อาจถูกลบไปแล้ว</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/meetings">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> กลับไปหน้ารายการประชุม
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="gap-1.5 -ml-2">
        <Link to="/meetings">
          <ArrowLeft className="h-3.5 w-3.5" /> รายการประชุม
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground sm:text-3xl">{meeting.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">สร้างโดย {meeting.createdByName || 'ไม่ทราบ'}</p>
        </div>
        {admin && (
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="gap-1.5 text-destructive hover:text-destructive">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} ลบการประชุม
          </Button>
        )}
      </div>

      {/* Round 42: the "เช็คอินแบบ Manual" card used to be its own full-width
          card here, below the scanner. It's now rendered smaller, inside
          MeetingScanner's side panel, directly above "เช็คอินล่าสุด" — see
          MeetingScanner's `participants`/`onManualCheckin` props below. */}
      <MeetingScanner
        meetingId={id!}
        registeredParticipants={registeredParticipants}
        checkedInIds={checkedInIds}
        checkins={checkins}
        participantsById={participantsById}
        participants={meeting.participants}
        onMatch={(p, distance) => handleCheckin(p, 'face', 1 - distance / MATCH_THRESHOLD)}
        onManualCheckin={(p) => handleCheckin(p, 'manual')}
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
                disabled={!admin}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-left',
                  admin && 'hover:border-primary/40 hover:bg-secondary'
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
                disabled={!admin}
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-left',
                  admin && 'hover:border-primary/40 hover:bg-secondary'
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-foreground">
                  <MapPin className="h-5 w-5 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">สถานที่</p>
                  <p className="truncate text-sm font-semibold text-foreground">{meeting.location || 'ไม่ระบุ'}</p>
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
                <Button size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={() => saveField('description')} disabled={savingField}>
                  {savingField ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} บันทึก
                </Button>
              </div>
            </div>
          ) : meeting.description ? (
            <button
              type="button"
              onClick={() => startEditing('description')}
              disabled={!admin}
              className={cn(
                'w-full rounded-xl border border-dashed border-border/70 bg-muted/40 p-4 text-left',
                admin && 'hover:border-primary/40 hover:bg-muted/60'
              )}
            >
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> รายละเอียด
              </p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{meeting.description}</p>
            </button>
          ) : (
            admin && (
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
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-semibold text-primary-foreground">
                        {p.name.charAt(0)}
                      </div>
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

// --- Face-scan check-in card ---------------------------------------------
// Scoped to only this meeting's invitees (registeredParticipants), unlike
// FaceScanner.tsx which matches against the whole roster.

// Cross-browser Fullscreen API helpers — desktop Safari (and iPadOS) still
// only expose the `webkit`-prefixed variants, so every call site here tries
// the standard API first and falls back to the prefixed one. iPhone Safari
// (and many in-app browsers, e.g. Line/Facebook's built-in webview) don't
// implement the Fullscreen API on arbitrary elements at all — there
// `requestFullscreenCompat` throws, which `toggleFullscreen` below catches
// and uses as the signal to fall back to a CSS-only "maximized view" instead
// of leaving the button broken on those devices (see `manualFullscreen`).
function getFullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as any).webkitFullscreenElement ?? null
}

async function requestFullscreenCompat(el: HTMLElement) {
  if (el.requestFullscreen) return el.requestFullscreen()
  if ((el as any).webkitRequestFullscreen) return (el as any).webkitRequestFullscreen()
  throw new Error('Fullscreen API is not supported on this device')
}

async function exitFullscreenCompat() {
  if (document.exitFullscreen) return document.exitFullscreen()
  if ((document as any).webkitExitFullscreen) return (document as any).webkitExitFullscreen()
}

// Auto-rotate to landscape when entering fullscreen, via the Screen
// Orientation Lock API. Support for this is much patchier than the
// Fullscreen API itself — desktop browsers reject it outright (there's no
// "rotation" to lock on a monitor), and iOS Safari never implements `.lock`
// at all (only `screen.orientation` itself exists there, no lock method) —
// so every call here is best-effort and fails silently rather than
// surfacing an error. Devices that DO support it (notably Chrome/Android)
// get the intended behavior; everywhere else the fullscreen toggle itself
// still works exactly as before, just without the auto-rotate.
async function lockLandscapeCompat() {
  try {
    const orientation = (screen as any).orientation
    if (orientation?.lock) {
      await orientation.lock('landscape')
    }
  } catch {
    // Most browsers only allow locking orientation while the document is
    // genuinely fullscreen (some reject it in the CSS-only manual-fullscreen
    // fallback), and plenty don't support it at all — none of that should
    // block or error out the fullscreen toggle itself.
  }
}

function unlockOrientationCompat() {
  try {
    ;(screen as any).orientation?.unlock?.()
  } catch {
    // ignore — nothing to clean up if it was never locked/supported
  }
}

function MeetingScanner({
  registeredParticipants,
  checkedInIds,
  checkins,
  participantsById,
  participants,
  onMatch,
  onManualCheckin,
}: {
  meetingId: string
  registeredParticipants: MeetingParticipant[]
  checkedInIds: Set<string>
  checkins: MeetingCheckin[]
  participantsById: Map<string, MeetingParticipant>
  participants: MeetingParticipant[]
  onMatch: (participant: MeetingParticipant, distance: number) => void
  onManualCheckin: (participant: MeetingParticipant) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const lastMatchRef = useRef<Record<string, number>>({})
  const overlayRef = useRef<{ box: { x: number; y: number; width: number; height: number }; color: string; label: string } | null>(null)
  const matchStreakRef = useRef<{ memberId: string | null; since: number }>({ memberId: null, since: 0 })

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [feedback, setFeedback] = useState<ScanFeedback>(null)
  const [confirmProgress, setConfirmProgress] = useState(0)
  // Two independent flags feed the single `isFullscreen` flag the rest of
  // this component renders against: `nativeFullscreen` mirrors the browser's
  // real Fullscreen API state, while `manualFullscreen` is a CSS-only
  // fallback (just the same "fixed inset-0" kiosk layout, without hiding the
  // browser chrome) for devices/browsers with no Fullscreen API support at
  // all — most notably iPhone Safari and in-app browsers. This is what makes
  // the "ขยายเต็มจอ" button work everywhere instead of erroring out on those.
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [manualFullscreen, setManualFullscreen] = useState(false)
  const isFullscreen = nativeFullscreen || manualFullscreen

  // Side "เช็คอินล่าสุด" panel — driven straight off the meeting's live
  // checkins (already kept fresh via MeetingDetail's realtime subscription),
  // not local scan state, so it shows who checked in regardless of *which*
  // device/kiosk did the scanning, newest first.
  const recentScans = useMemo(() => {
    return [...checkins]
      .sort((a, b) => new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime())
      .slice(0, 12)
      .map((c) => {
        const p = participantsById.get(c.memberId)
        return {
          id: c.id,
          name: p?.name ?? 'ไม่ทราบชื่อผู้เข้าร่วม',
          department: p?.department ?? '',
          time: formatCheckinTime(c.checkedInAt),
        }
      })
  }, [checkins, participantsById])

  useEffect(() => {
    function onFullscreenChange() {
      setNativeFullscreen(getFullscreenElement() === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener)
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    // Turning off — exit real fullscreen if it's engaged, release any
    // orientation lock we may have taken, and always clear the manual CSS
    // fallback too (only one of the two is ever true, but clearing both
    // keeps this in sync regardless of how we got here).
    if (nativeFullscreen || manualFullscreen) {
      if (getFullscreenElement()) {
        try {
          await exitFullscreenCompat()
        } catch {
          // ignore — the manualFullscreen(false) below still turns off the
          // kiosk layout even if the native exit call itself failed
        }
      }
      unlockOrientationCompat()
      setManualFullscreen(false)
      return
    }
    // Turning on — prefer the real Fullscreen API (it also hides the browser
    // chrome), but if it's missing or rejected on this device/browser (e.g.
    // iPhone Safari, in-app browsers), fall back to the CSS-only maximized
    // view instead of leaving the button broken. Either way, also try to
    // lock the screen to landscape — this only actually takes effect on
    // devices/browsers that support the Screen Orientation Lock API (mainly
    // Chrome/Android), and is a silent no-op everywhere else.
    if (containerRef.current) {
      try {
        await requestFullscreenCompat(containerRef.current)
        await lockLandscapeCompat()
      } catch {
        setManualFullscreen(true)
        await lockLandscapeCompat()
      }
    }
  }, [nativeFullscreen, manualFullscreen])

  const paintLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const overlay = overlayRef.current
        if (overlay) {
          ctx.strokeStyle = overlay.color
          ctx.lineWidth = 4
          ctx.strokeRect(overlay.box.x, overlay.box.y, overlay.box.width, overlay.box.height)
        }
        ctx.restore()

        // Name label above the box — box coordinates come from the
        // un-mirrored detector, so the label's x has to be mirrored
        // separately to line up with the mirrored box drawn above.
        if (overlay) {
          const { box, color, label } = overlay
          const mirroredX = canvas.width - box.x - box.width
          ctx.font = '600 20px "Plus Jakarta Sans", sans-serif'
          const textWidth = ctx.measureText(label).width
          ctx.fillStyle = color
          ctx.fillRect(mirroredX - 2, box.y - 34, textWidth + 16, 30)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(label, mirroredX + 6, box.y - 11)
        }
      }
    }
    paintRafRef.current = requestAnimationFrame(paintLoop)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraState('loading')
    setErrorMsg('')
    try {
      await loadFaceModels()
    } catch {
      setErrorMsg('ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ กรุณาใช้ "เช็คอินแบบ Manual" ในแผงด้านข้างแทน หรือลองใหม่อีกครั้ง')
      setCameraState('error')
      return
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraState('ready')
    } catch (err) {
      setErrorMsg(describeGetUserMediaError(err))
      setCameraState('error')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraState('idle')
  }, [])

  useEffect(() => {
    startCamera()
    paintRafRef.current = requestAnimationFrame(paintLoop)
    return () => {
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current)
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (cameraState !== 'ready') return
    timerRef.current = window.setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      let result
      try {
        result = await detectFaceWithDescriptor(video)
      } catch {
        return
      }
      if (!result) {
        overlayRef.current = null
        matchStreakRef.current = { memberId: null, since: 0 }
        setConfirmProgress(0)
        return
      }

      let best: { participant: MeetingParticipant; distance: number } | null = null
      for (const p of registeredParticipants) {
        if (!p.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, p.faceDescriptor)
        if (!best || distance < best.distance) best = { participant: p, distance }
      }

      const isMatch = best && best.distance < MATCH_THRESHOLD

      // Track how long the SAME participant has matched continuously.
      // Switching to no-match, a different person, or losing the face
      // entirely resets the streak — only sustained agreement counts.
      const streak = matchStreakRef.current
      if (isMatch) {
        const memberId = best!.participant.memberId
        if (streak.memberId !== memberId) {
          matchStreakRef.current = { memberId, since: Date.now() }
        }
      } else {
        matchStreakRef.current = { memberId: null, since: 0 }
      }
      const heldMs = matchStreakRef.current.memberId ? Date.now() - matchStreakRef.current.since : 0
      const isConfirmed = Boolean(isMatch) && heldMs >= CONFIRM_HOLD_MS
      setConfirmProgress(isMatch ? Math.min(1, heldMs / CONFIRM_HOLD_MS) : 0)

      overlayRef.current = {
        box: result.box,
        color: isMatch ? (isConfirmed ? '#10b981' : '#3b82f6') : '#f59e0b',
        label: isMatch
          ? isConfirmed
            ? best!.participant.name
            : `${best!.participant.name} · กำลังยืนยัน`
          : 'ไม่ใช่ผู้เข้าร่วมประชุม',
      }

      if (isConfirmed) {
        const { participant, distance } = best!
        const lastTime = lastMatchRef.current[participant.memberId] ?? 0
        if (Date.now() - lastTime > REPEAT_COOLDOWN_MS && !checkedInIds.has(participant.memberId)) {
          lastMatchRef.current[participant.memberId] = Date.now()
          onMatch(participant, distance)
          setFeedback({ name: participant.name, department: participant.department })
          matchStreakRef.current = { memberId: null, since: 0 }
          setConfirmProgress(0)
          window.setTimeout(() => setFeedback(null), 3200)
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, SCAN_INTERVAL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, registeredParticipants, checkedInIds])

  return (
    // containerRef is the element that actually goes fullscreen (via the
    // Fullscreen API) when the button below is pressed. It wraps the header
    // too — not just the video box — so the "ย่อออกจากเต็มจอ" control and
    // the เปิด/ปิดกล้อง button stay reachable while fullscreened, on every
    // device (the `isFullscreen &&` classes are a CSS belt-and-braces fallback
    // for the rare case a browser's native fullscreen sizing doesn't kick in).
    <div ref={containerRef} className={cn(isFullscreen && 'fixed inset-0 z-50 overflow-y-auto bg-background p-3 sm:p-4')}>
      <Card className={cn('border-border/70 shadow-soft', isFullscreen && 'flex h-full flex-col border-none shadow-none')}>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <ScanFace className="h-4 w-4 text-primary" /> สแกนใบหน้าเพื่อเช็คอินเข้าร่วมประชุม
            </CardTitle>
            <CardDescription>รองรับผู้เข้าร่วมที่ลงทะเบียนใบหน้าแล้ว {registeredParticipants.length} คน</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cameraState === 'ready' ? (
              <Button size="sm" variant="outline" onClick={stopCamera} className="gap-1.5">
                <CameraOff className="h-3.5 w-3.5" /> ปิดกล้อง
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => startCamera()} className="gap-1.5">
                <Camera className="h-3.5 w-3.5" /> เปิดกล้อง
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={toggleFullscreen} className="gap-1.5">
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreen ? 'ย่อออกจากเต็มจอ' : 'ขยายเต็มจอ'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={cn(isFullscreen && 'flex flex-1 flex-col')}>
          <div className={cn('flex flex-col gap-3', isFullscreen ? 'flex-1 md:flex-row' : 'md:flex-row')}>
            <div
              className={cn(
                'relative overflow-hidden rounded-2xl bg-slate-900',
                isFullscreen ? 'min-h-[45vh] flex-1' : 'mx-auto aspect-video w-full max-w-xl md:mx-0 md:flex-1'
              )}
            >
              {cameraState === 'loading' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                  <Loader2 className="h-7 w-7 animate-spin" />
                  <p className="text-sm">กำลังเตรียมกล้องและโมเดลตรวจจับใบหน้า...</p>
                </div>
              )}
              {cameraState === 'error' && (
                <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center sm:p-6">
                  <AlertTriangle className="h-8 w-8 shrink-0 text-amber-400" />
                  <p className="max-w-sm text-sm leading-relaxed text-white/80">{errorMsg}</p>
                  <Button size="sm" variant="secondary" onClick={() => startCamera()} className="mt-1 shrink-0 gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> ลองอีกครั้ง
                  </Button>
                </div>
              )}
              {cameraState === 'idle' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/60">
                  <CameraOff className="h-7 w-7" />
                  <p className="text-sm">กล้องปิดอยู่</p>
                </div>
              )}
              <video
                ref={videoRef}
                muted
                playsInline
                webkit-playsinline="true"
                className="absolute -left-full -top-full h-px w-px opacity-0"
              />
              <canvas
                ref={canvasRef}
                className={cn('h-full w-full object-cover', cameraState !== 'ready' && 'hidden')}
              />
              {confirmProgress > 0 && confirmProgress < 1 && !feedback && (
                <div className="absolute inset-x-0 bottom-0 bg-blue-600/90 px-4 py-2 text-center text-sm font-medium text-white backdrop-blur-sm">
                  <p className="mb-1.5">ตรวจพบใบหน้าตรงกัน กรุณาอยู่นิ่งๆ เพื่อยืนยัน...</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/30">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-150"
                      style={{ width: `${confirmProgress * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {feedback && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
                  <CheckCircle2 className="h-14 w-14" />
                  <p className="font-display text-xl font-bold">เช็คอินสำเร็จ</p>
                  <p className="text-lg">{feedback.name}</p>
                  <p className="text-sm text-white/80">{feedback.department}</p>
                </div>
              )}
            </div>

            {/* Side panel showing who has scanned/checked in — always visible
                next to the camera (stacked below it on narrow screens), and
                especially useful in fullscreen kiosk mode where there's no
                page below to scroll to for this information. */}
            <div
              className={cn(
                'flex shrink-0 flex-col gap-3 rounded-2xl border p-3',
                isFullscreen ? 'w-full border-white/10 bg-slate-900 text-white md:w-72' : 'w-full border-border/70 bg-card md:w-64'
              )}
            >
              {/* Round 42: "เช็คอินแบบ Manual" moved here (from its own
                  full-width card lower on the page) and shrunk down to a
                  compact widget, sitting directly above "เช็คอินล่าสุด" so
                  both live in the same side panel next to the camera. */}
              <ManualMeetingCheckin
                participants={participants}
                checkedInIds={checkedInIds}
                onCheckin={onManualCheckin}
                isFullscreen={isFullscreen}
              />

              <div
                className={cn(
                  'flex flex-col gap-2 border-t pt-2.5',
                  isFullscreen ? 'border-white/10' : 'border-border/60'
                )}
              >
                <p className={cn('flex items-center gap-1.5 text-xs font-semibold', isFullscreen ? 'text-white/80' : 'text-muted-foreground')}>
                  <Users className="h-3.5 w-3.5" /> เช็คอินล่าสุด
                </p>
                <div className={cn('space-y-1.5 overflow-y-auto', isFullscreen ? 'max-h-[45vh] flex-1' : 'max-h-56')}>
                {recentScans.length === 0 ? (
                  <p className={cn('rounded-lg px-2.5 py-2 text-xs', isFullscreen ? 'bg-white/5 text-white/50' : 'bg-muted text-muted-foreground')}>
                    ยังไม่มีผู้เช็คอิน
                  </p>
                ) : (
                  recentScans.map((r, i) => (
                    <div
                      key={r.id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                        isFullscreen ? 'border-white/10 bg-white/5' : 'border-border/50 bg-secondary/40',
                        i === 0 && 'border-emerald-500/60'
                      )}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className={cn('truncate text-xs', isFullscreen ? 'text-white/60' : 'text-muted-foreground')}>
                          {r.department ? `${r.department} · ` : ''}
                          {r.time}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                </div>
              </div>
            </div>
          </div>
          {registeredParticipants.length === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ยังไม่มีผู้เข้าร่วมที่ลงทะเบียนใบหน้าไว้ ใช้ &quot;เช็คอินแบบ Manual&quot; ในแผงด้านข้างแทนได้
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// --- Manual fallback widget ------------------------------------------------
// Searches only within this meeting's participant list, not the full
// member roster — matches the scoping of the face scanner above.
//
// Round 42: this used to be its own full-width `Card` rendered lower on the
// page. Per request it's now a smaller widget nested directly inside
// MeetingScanner's side panel (above "เช็คอินล่าสุด") — no outer Card/border
// of its own anymore, since it already sits inside that panel's border; an
// `isFullscreen` prop lets it flip to light-on-dark text/input styling so it
// still reads correctly against the side panel's dark theme in kiosk mode.

function ManualMeetingCheckin({
  participants,
  checkedInIds,
  onCheckin,
  isFullscreen,
}: {
  participants: MeetingParticipant[]
  checkedInIds: Set<string>
  onCheckin: (participant: MeetingParticipant) => void
  isFullscreen: boolean
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    return participants
      .filter((p) => p.name.toLowerCase().includes(q) || p.employeeId.toLowerCase().includes(q))
      .slice(0, 4)
  }, [participants, query])

  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn('flex items-center gap-1.5 text-xs font-semibold', isFullscreen ? 'text-white/80' : 'text-muted-foreground')}>
        <KeyRound className="h-3.5 w-3.5" /> เช็คอินแบบ Manual
      </p>
      <div className="relative">
        <Search
          className={cn(
            'pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2',
            isFullscreen ? 'text-white/40' : 'text-muted-foreground'
          )}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="พิมพ์รหัสหรือชื่อ"
          className={cn(
            // text-base (16px) below `sm` avoids iOS Safari's zoom-on-focus
            // (see Login.tsx's manual-id input for the same reasoning);
            // shrinks to the compact text-sm once there's room for it.
            'h-8 pl-7 text-base sm:text-sm',
            isFullscreen && 'border-white/20 bg-white/5 text-white placeholder:text-white/40'
          )}
        />
      </div>
      {query.trim() && (
        <div className="space-y-1">
          {matches.length === 0 ? (
            <p className={cn('rounded-lg px-2 py-1.5 text-xs', isFullscreen ? 'bg-white/5 text-white/50' : 'bg-muted text-muted-foreground')}>
              ไม่พบผู้เข้าร่วมที่ตรงกัน
            </p>
          ) : (
            matches.map((p) => {
              const checkedIn = checkedInIds.has(p.memberId)
              return (
                <button
                  key={p.memberId}
                  onClick={() => {
                    if (checkedIn) return
                    onCheckin(p)
                    setQuery('')
                  }}
                  disabled={checkedIn}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
                    isFullscreen ? 'border-white/10' : 'border-border/60',
                    checkedIn
                      ? 'cursor-not-allowed opacity-60'
                      : isFullscreen
                        ? 'hover:bg-white/10'
                        : 'hover:border-primary/50 hover:bg-secondary'
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  {checkedIn ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <span className={cn('shrink-0 text-[10px] font-medium', isFullscreen ? 'text-accent' : 'text-primary')}>เช็คอิน</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
