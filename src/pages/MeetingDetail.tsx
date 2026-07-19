import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
} from 'lucide-react'
import { getMeeting, deleteMeeting, getMeetingCheckins, recordMeetingCheckin } from '@/lib/store'
import { supabase } from '@/lib/supabaseClient'
import { useAdminAuth } from '@/lib/adminAuth'
import { loadFaceModels, detectFaceWithDescriptor, descriptorDistance, MATCH_THRESHOLD } from '@/lib/faceEngine'
import { describeGetUserMediaError } from '@/lib/cameraHelpers'
import type { Meeting, MeetingCheckin, MeetingParticipant } from '@/lib/types'
import { cn } from '@/lib/utils'

function formatMeetingTime(iso: string | null) {
  if (!iso) return 'ยังไม่กำหนดเวลา'
  try {
    return new Date(iso).toLocaleString('th-TH', { dateStyle: 'full', timeStyle: 'short' })
  } catch {
    return iso
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
  // that happen from a *different* device scanning the same meeting.
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`facein-meeting-checkins-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'facein_meeting_checkins', filter: `meeting_id=eq.${id}` },
        () => {
          getMeetingCheckins(id)
            .then(setCheckins)
            .catch(() => {
              // non-critical: the next successful refresh will catch up
            })
        }
      )
      .subscribe()
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
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{meeting.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">สร้างโดย {meeting.createdByName || 'ไม่ทราบ'}</p>
        </div>
        {admin && (
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="gap-1.5 text-destructive hover:text-destructive">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} ลบการประชุม
          </Button>
        )}
      </div>

      <Card className="border-border/70 shadow-soft">
        <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">วันและเวลา</p>
              <p className="text-sm font-medium text-foreground">{formatMeetingTime(meeting.meetingTime)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">สถานที่</p>
              <p className="text-sm font-medium text-foreground">{meeting.location || 'ไม่ระบุ'}</p>
            </div>
          </div>
          {meeting.description && (
            <div className="flex items-start gap-2.5 sm:col-span-2">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">รายละเอียด</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">{meeting.description}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <MeetingScanner
        meetingId={id!}
        registeredParticipants={registeredParticipants}
        checkedInIds={checkedInIds}
        onMatch={(p, distance) => handleCheckin(p, 'face', 1 - distance / MATCH_THRESHOLD)}
      />

      <ManualMeetingCheckin
        participants={meeting.participants}
        checkedInIds={checkedInIds}
        onCheckin={(p) => handleCheckin(p, 'manual')}
      />

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

function MeetingScanner({
  registeredParticipants,
  checkedInIds,
  onMatch,
}: {
  meetingId: string
  registeredParticipants: MeetingParticipant[]
  checkedInIds: Set<string>
  onMatch: (participant: MeetingParticipant, distance: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const lastMatchRef = useRef<Record<string, number>>({})
  const overlayRef = useRef<{ box: { x: number; y: number; width: number; height: number }; color: string; label: string } | null>(null)

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [feedback, setFeedback] = useState<ScanFeedback>(null)

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
      setErrorMsg('ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ กรุณาใช้ "เช็คอินแบบ Manual" ด้านล่างแทน หรือลองใหม่อีกครั้ง')
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
        return
      }

      let best: { participant: MeetingParticipant; distance: number } | null = null
      for (const p of registeredParticipants) {
        if (!p.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, p.faceDescriptor)
        if (!best || distance < best.distance) best = { participant: p, distance }
      }

      const isMatch = best && best.distance < MATCH_THRESHOLD
      overlayRef.current = {
        box: result.box,
        color: isMatch ? '#10b981' : '#f59e0b',
        label: isMatch ? best!.participant.name : 'ไม่ใช่ผู้เข้าร่วมประชุมนี้',
      }

      if (isMatch) {
        const { participant, distance } = best!
        const lastTime = lastMatchRef.current[participant.memberId] ?? 0
        if (Date.now() - lastTime > REPEAT_COOLDOWN_MS && !checkedInIds.has(participant.memberId)) {
          lastMatchRef.current[participant.memberId] = Date.now()
          onMatch(participant, distance)
          setFeedback({ name: participant.name, department: participant.department })
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
    <Card className="border-border/70 shadow-soft">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <ScanFace className="h-4 w-4 text-primary" /> สแกนใบหน้าเพื่อเช็คอินเข้าร่วมประชุม
          </CardTitle>
          <CardDescription>รองรับผู้เข้าร่วมที่ลงทะเบียนใบหน้าแล้ว {registeredParticipants.length} คน</CardDescription>
        </div>
        {cameraState === 'ready' ? (
          <Button size="sm" variant="outline" onClick={stopCamera} className="gap-1.5">
            <CameraOff className="h-3.5 w-3.5" /> ปิดกล้อง
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => startCamera()} className="gap-1.5">
            <Camera className="h-3.5 w-3.5" /> เปิดกล้อง
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-2xl bg-slate-900">
          {cameraState === 'loading' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-sm">กำลังเตรียมกล้องและโมเดลตรวจจับใบหน้า...</p>
            </div>
          )}
          {cameraState === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
              <p className="max-w-sm text-sm leading-relaxed text-white/80">{errorMsg}</p>
              <Button size="sm" variant="secondary" onClick={() => startCamera()} className="mt-1 gap-1.5">
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
          {feedback && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
              <CheckCircle2 className="h-14 w-14" />
              <p className="font-display text-xl font-bold">เช็คอินสำเร็จ</p>
              <p className="text-lg">{feedback.name}</p>
              <p className="text-sm text-white/80">{feedback.department}</p>
            </div>
          )}
        </div>
        {registeredParticipants.length === 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            ยังไม่มีผู้เข้าร่วมที่ลงทะเบียนใบหน้าไว้ ใช้ &quot;เช็คอินแบบ Manual&quot; ด้านล่างแทนได้
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// --- Manual fallback card -------------------------------------------------
// Searches only within this meeting's participant list, not the full
// member roster — matches the scoping of the face scanner above.

function ManualMeetingCheckin({
  participants,
  checkedInIds,
  onCheckin,
}: {
  participants: MeetingParticipant[]
  checkedInIds: Set<string>
  onCheckin: (participant: MeetingParticipant) => void
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    return participants
      .filter((p) => p.name.toLowerCase().includes(q) || p.employeeId.toLowerCase().includes(q))
      .slice(0, 6)
  }, [participants, query])

  return (
    <Card className="border-border/70 shadow-soft">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-primary" /> เช็คอินแบบ Manual
        </CardTitle>
        <CardDescription>สำหรับกรณีที่ระบบสแกนใบหน้ามีปัญหา หรือกล้องใช้งานไม่ได้</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="พิมพ์รหัสพนักงานหรือชื่อผู้เข้าร่วม" className="pl-8" />
        </div>
        <div className="min-h-[2.5rem] space-y-1.5">
          {query.trim() && matches.length === 0 && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ไม่พบผู้เข้าร่วมที่ตรงกัน</p>
          )}
          {matches.map((p) => {
            const checkedIn = checkedInIds.has(p.memberId)
            return (
              <button
                key={p.memberId}
                onClick={() => {
                  onCheckin(p)
                  setQuery('')
                }}
                disabled={checkedIn}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors',
                  checkedIn ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50 hover:bg-secondary'
                )}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.employeeId} · {p.department}
                  </p>
                </div>
                {checkedIn ? (
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <CheckCircle2 className="h-3 w-3" /> เช็คอินแล้ว
                  </Badge>
                ) : (
                  <Badge className="font-normal">เช็คอิน</Badge>
                )}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
