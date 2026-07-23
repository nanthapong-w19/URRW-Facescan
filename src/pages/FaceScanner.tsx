import { useEffect, useRef, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { CheckinSuccessToast } from '@/components/CheckinSuccessToast'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import {
  ScanFace,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Camera,
  CameraOff,
  SwitchCamera,
  ShieldAlert,
  Eye,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppData } from '@/hooks/useAppData'
import { recordCheckin, hasCheckedInToday } from '@/lib/store'
import { distanceToConfidence, averageEyeAspectRatio, EAR_BLINK_THRESHOLD } from '@/lib/faceEngine'
import { useFaceCamera } from '@/hooks/useFaceCamera'
import type { Member } from '@/lib/types'
import { cn } from '@/lib/utils'

type ScanFeedback = { kind: 'success' | 'unknown'; name?: string; department?: string; position?: string } | null

// Plays a short, pleasant two-tone chime using the Web Audio API so no
// external audio asset needs to be bundled.
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

const REPEAT_COOLDOWN_MS = 15000
// How long a detected blink keeps the tracked face "live" for. Wide enough
// to bridge a couple of scan ticks around the blink itself, short enough
// that holding up a static photo can't coast on a single lucky detection.
const LIVENESS_VALID_MS = 4000

const MODEL_LOAD_ERROR_MESSAGE =
  'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ อาจเกิดจากข้อจำกัดเครือข่ายของหน้าตัวอย่างนี้ กรุณารันโปรเจกต์นี้ในเครื่องของคุณเพื่อใช้กล้องจริง หรือใช้ "เช็คอินแบบ Manual" ด้านล่างแทนได้ทันที'

export interface LivenessState {
  eyesClosed: boolean
  blinkAt: number | null
}

// Tick policy (see CONTEXT.md "Tick policy"), split out as a pure function
// so it's testable without a DOM/video element: tracks eye-aspect-ratio
// across ticks and requires one real blink (closed -> open transition)
// before a match counts as "live" — a static photo or frozen video frame
// held up to the camera can never produce that transition.
export function nextLivenessState(state: LivenessState, ear: number, now: number): LivenessState {
  if (ear < EAR_BLINK_THRESHOLD) return { ...state, eyesClosed: true }
  if (state.eyesClosed) return { eyesClosed: false, blinkAt: now }
  return state
}

export function isLive(blinkAt: number | null, now: number): boolean {
  return blinkAt !== null && now - blinkAt < LIVENESS_VALID_MS
}

export default function FaceScanner() {
  const { members, checkins } = useAppData()
  const registeredMembers = useMemo(() => members.filter((m) => m.faceStatus === 'registered'), [members])

  const lastCheckinRef = useRef<Record<string, number>>({})
  const livenessRef = useRef<{ eyesClosed: boolean; blinkAt: number | null }>({
    eyesClosed: false,
    blinkAt: null,
  })

  const [feedback, setFeedback] = useState<ScanFeedback>(null)
  const [manualQuery, setManualQuery] = useState('')
  const [waitingForBlink, setWaitingForBlink] = useState(false)

  // Tick policy (see CONTEXT.md "Tick policy"): a lightweight liveness
  // check — track eye-aspect-ratio across ticks and require one real blink
  // (closed -> open transition) before trusting a match enough to check
  // someone in. A static photo or frozen video frame held up to the camera
  // will never produce that transition.
  const camera = useFaceCamera({
    candidates: registeredMembers,
    modelLoadErrorMessage: MODEL_LOAD_ERROR_MESSAGE,
    onTick: (result) => {
      if (!result) {
        livenessRef.current = { eyesClosed: false, blinkAt: null }
        setWaitingForBlink(false)
        return null
      }
      const { face, bestMatch, isMatch } = result

      const now = Date.now()
      const ear = averageEyeAspectRatio(face.landmarks)
      livenessRef.current = nextLivenessState(livenessRef.current, ear, now)
      const live = isLive(livenessRef.current.blinkAt, now)

      setWaitingForBlink(isMatch && !live)

      if (isMatch && live) {
        const member = bestMatch!.candidate
        const lastTime = lastCheckinRef.current[member.id] ?? 0
        const alreadyToday = hasCheckedInToday(checkins, member.id)
        if (Date.now() - lastTime > REPEAT_COOLDOWN_MS && !alreadyToday) {
          lastCheckinRef.current[member.id] = Date.now()
          recordCheckin(member, 'face', distanceToConfidence(bestMatch!.distance))
            .then(() => {
              setFeedback({ kind: 'success', name: member.name, department: member.department, position: member.position })
              playSuccessChime()
              toast.custom(
                () => (
                  <CheckinSuccessToast
                    name={member.name}
                    department={member.department}
                    position={member.position}
                    method="face"
                    durationMs={3500}
                  />
                ),
                { duration: 3500 }
              )
              window.setTimeout(() => setFeedback(null), 3200)
            })
            .catch((err) => {
              // Allow retrying on the next tick instead of getting stuck
              // thinking this member already checked in.
              delete lastCheckinRef.current[member.id]
              toast.error(err instanceof Error ? err.message : 'บันทึกการเช็คอินไม่สำเร็จ')
            })
        }
      }

      const matchedName = bestMatch?.candidate.name
      return {
        box: face.box,
        color: isMatch ? (live ? '#10b981' : '#3b82f6') : '#f59e0b',
        label: isMatch ? (live ? matchedName! : `${matchedName} · กระพริบตา`) : 'ไม่พบในระบบ',
      }
    },
  })

  useEffect(() => {
    camera.start()
    return () => camera.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const manualMatches = useMemo(() => {
    if (!manualQuery.trim()) return []
    const q = manualQuery.trim().toLowerCase()
    return members
      .filter((m) => m.employeeId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 5)
  }, [members, manualQuery])

  async function handleManualCheckin(member: Member) {
    if (hasCheckedInToday(checkins, member.id)) {
      toast.info(`${member.name} เช็คอินไปแล้ววันนี้`)
      setManualQuery('')
      return
    }
    try {
      await recordCheckin(member, 'manual')
      toast.custom(
        () => (
          <CheckinSuccessToast
            name={member.name}
            department={member.department}
            position={member.position}
            method="manual"
            durationMs={3500}
          />
        ),
        { duration: 3500 }
      )
      playSuccessChime()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'บันทึกการเช็คอินไม่สำเร็จ')
    }
    setManualQuery('')
  }

  const showFrameWarning = camera.cameraState === 'ready' && (camera.trackMuted || camera.noFrames || camera.blackFrames)

  return (
    <div className="space-y-6">
      <PageHeader
        title="สแกนใบหน้าเพื่อเช็คอิน"
        description="จัดใบหน้าให้อยู่ตรงกลางกรอบกล้อง ระบบจะเช็คอินให้อัตโนมัติเมื่อพบข้อมูลตรงกัน"
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-5">
        <Card className="border-border/70 shadow-soft md:col-span-3">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="font-display text-base">กล้องสแกนใบหน้า</CardTitle>
              <CardDescription>
                สมาชิกที่ลงทะเบียนใบหน้าแล้ว {registeredMembers.length} / {members.length} คน
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {camera.cameraState === 'ready' && camera.devices.length > 1 && (
                <Select value={camera.activeDeviceId} onValueChange={(id) => camera.start(id)}>
                  <SelectTrigger className="h-8 w-[168px] text-xs">
                    <SwitchCamera className="me-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="เลือกกล้อง" />
                  </SelectTrigger>
                  <SelectContent>
                    {camera.devices.map((d, i) => (
                      <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
                        {d.label || `กล้อง ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {camera.cameraState === 'ready' ? (
                <Button size="sm" variant="outline" onClick={camera.stop} className="gap-1.5">
                  <CameraOff className="h-3.5 w-3.5" /> ปิดกล้อง
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => camera.start()} className="gap-1.5">
                  <Camera className="h-3.5 w-3.5" /> เปิดกล้อง
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl bg-slate-900">
              {camera.cameraState === 'loading' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
                  <Loader2 className="h-7 w-7 animate-spin" />
                  <p className="text-sm">กำลังเตรียมกล้องและโมเดลตรวจจับใบหน้า...</p>
                </div>
              )}
              {camera.cameraState === 'error' && (
                <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-4 text-center sm:p-6">
                  <AlertTriangle className="h-8 w-8 shrink-0 text-amber-400" />
                  <p className="max-w-sm text-sm leading-relaxed text-white/80">{camera.errorMsg}</p>
                  <Button size="sm" variant="secondary" onClick={() => camera.start()} className="mt-1 shrink-0 gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> ลองอีกครั้ง
                  </Button>
                </div>
              )}

              {/* The <video> element is never shown directly — it's only a
                  decode source for the paint loop above, which draws every
                  frame onto the visible canvas. Keeping it off-screen
                  (rather than display:none) keeps browsers from pausing
                  decode to save power. */}
              <video
                ref={camera.videoRef}
                muted
                playsInline
                webkit-playsinline="true"
                className="absolute -left-full -top-full h-px w-px opacity-0"
              />
              <canvas
                ref={camera.canvasRef}
                className={cn(
                  'h-full w-full object-cover',
                  (camera.cameraState === 'loading' || camera.cameraState === 'error') && 'hidden'
                )}
              />

              {showFrameWarning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-slate-900/95 p-4 text-center sm:p-6">
                  <ShieldAlert className="h-8 w-8 shrink-0 text-amber-400" />
                  {camera.blackFrames && !camera.noFrames && !camera.trackMuted ? (
                    <p className="max-w-sm text-sm leading-relaxed text-white/90">
                      กล้องเชื่อมต่อและส่งภาพมาจริง แต่เนื้อหาของภาพเป็นสีดำสนิท — ไม่ใช่ปัญหาจากตัวแอปนี้
                      แต่เป็นระบบปฏิบัติการหรือซอฟต์แวร์ความปลอดภัยของเครื่องนี้เองที่ปิดกั้นภาพจริงไว้เฉพาะตอนใช้งานผ่านเบราว์เซอร์
                      (พบได้ในบางเครื่องที่มีนโยบายองค์กรหรือแอนตี้ไวรัสควบคุมกล้องอย่างเข้มงวด) แนะนำให้ใช้
                      &quot;เช็คอินแบบ Manual&quot; ด้านขวาแทนสำหรับเครื่องนี้ไปก่อน
                    </p>
                  ) : (
                    <p className="max-w-sm text-sm leading-relaxed text-white/90">
                      เชื่อมต่อกล้องสำเร็จ แต่ไม่มีสัญญาณภาพส่งมาเลย — มักเกิดจากซอฟต์แวร์ป้องกันเว็บแคม (แอนตี้ไวรัส) บล็อกภาพไว้
                      ทั้งที่อนุญาต permission แล้ว หรือกล้องถูกปิดบัง/มีฝาปิดอยู่ ลองปิดการป้องกันเว็บแคมชั่วคราว หรือใช้
                      &quot;เช็คอินแบบ Manual&quot; ด้านขวาแทนได้เลย
                    </p>
                  )}
                </div>
              )}

              {waitingForBlink && !feedback && camera.cameraState === 'ready' && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-blue-600/90 px-4 py-2 text-center text-sm font-medium text-white backdrop-blur-sm">
                  <Eye className="h-4 w-4 shrink-0" /> กระพริบตาเพื่อยืนยันว่าเป็นคนจริง ก่อนเช็คอิน
                </div>
              )}

              {feedback?.kind === 'success' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
                  <CheckCircle2 className="h-14 w-14" />
                  <p className="font-display text-2xl font-bold">เช็คอินสำเร็จ</p>
                  <p className="text-lg">{feedback.name}</p>
                  <p className="text-sm text-white/80">
                    {[feedback.position, feedback.department].filter(Boolean).join(' · ')}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft md:col-span-2">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" /> เช็คอินแบบ Manual
            </CardTitle>
            <CardDescription>สำหรับกรณีที่ระบบสแกนใบหน้ามีปัญหา หรือกล้องใช้งานไม่ได้</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SearchInput
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="พิมพ์รหัสพนักงานหรือชื่อ"
            />

            <div className="min-h-[3rem] space-y-1.5">
              {manualQuery.trim() && manualMatches.length === 0 && (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ไม่พบสมาชิกที่ตรงกัน</p>
              )}
              {manualMatches.map((m) => {
                const checkedIn = hasCheckedInToday(checkins, m.id)
                return (
                  <button
                    key={m.id}
                    onClick={() => handleManualCheckin(m)}
                    disabled={checkedIn}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors',
                      checkedIn ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50 hover:bg-secondary'
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.employeeId} · {m.department}
                      </p>
                    </div>
                    {checkedIn ? (
                      <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
                        <CheckCircle2 className="h-3 w-3" /> เช็คอินแล้ว
                      </Badge>
                    ) : (
                      <Badge className="shrink-0 font-normal">เช็คอิน</Badge>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="rounded-xl border border-dashed border-border/70 bg-secondary/40 p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <ScanFace className="h-3.5 w-3.5" /> เคล็ดลับการสแกน
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                <li>ให้แสงส่องหน้าอย่างเพียงพอ หลีกเลี่ยงแสงย้อน</li>
                <li>มองตรงเข้ากล้องและอยู่ห่างประมาณ 40-60 ซม.</li>
                <li>เมื่อระบบพบใบหน้าที่ตรงกัน จะขอให้กระพริบตา 1 ครั้งเพื่อยืนยันว่าเป็นคนจริง (ป้องกันรูปถ่าย/วิดีโอปลอม)</li>
                <li>สมาชิกต้องลงทะเบียนใบหน้าในหน้า &quot;จัดการบุคลากร&quot; ก่อน</li>
                <li>
                  ถ้าภาพจากกล้องยังคงมืดสนิท ลองเลือกกล้องอื่นจากเมนู &quot;เลือกกล้อง&quot; ด้านบนวิดีโอ
                  หรือปิดโปรแกรมป้องกันเว็บแคมชั่วคราว
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
