import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckinSuccessToast } from '@/components/CheckinSuccessToast'
import { PulseDot } from '@/components/PulseDot'
import { CheckinIdentity } from '@/components/CheckinIdentity'
import {
  ScanFace,
  Camera,
  CameraOff,
  AlertTriangle,
  Loader2,
  Maximize2,
  Minimize2,
  Users,
  KeyRound,
  Search,
  CheckCircle2,
} from 'lucide-react'
import { useFaceCamera } from '@/hooks/useFaceCamera'
import {
  getFullscreenElement,
  requestFullscreen,
  exitFullscreen,
  onFullscreenChange,
  lockLandscape,
  unlockOrientation,
} from '@/lib/fullscreen'
import type { MeetingParticipant, MeetingCheckin } from '@/lib/types'
import { cn, formatCheckinTime } from '@/lib/utils'

type ScanFeedback = { name: string; department: string; position: string; method: 'face' | 'manual' } | null

const REPEAT_COOLDOWN_MS = 15000
// The same person must match continuously for this long before a check-in
// is actually recorded — protects against a single fleeting frame (motion
// blur, someone briefly walking past, a photo held up for an instant)
// triggering a check-in immediately. ~1.5s of holding steady in front of
// the camera, same idea as a tap-and-hold button.
const CONFIRM_HOLD_MS = 1500

export interface MatchStreak {
  memberId: string | null
  since: number
}

// Tick policy (see CONTEXT.md "Tick policy"), split out as a pure function
// so it's testable without a DOM/video element: the SAME participant must
// match continuously for CONFIRM_HOLD_MS before a check-in is confirmed —
// switching to no-match, a different person, or losing the face entirely
// resets the streak, so only sustained agreement counts.
export function nextMatchStreak(streak: MatchStreak, matchedMemberId: string | null, now: number): MatchStreak {
  if (matchedMemberId === null) return { memberId: null, since: 0 }
  if (streak.memberId !== matchedMemberId) return { memberId: matchedMemberId, since: now }
  return streak
}

export function streakHeldMs(streak: MatchStreak, now: number): number {
  return streak.memberId ? now - streak.since : 0
}

// Crops a small face thumbnail out of the canvas the moment a check-in is
// confirmed, so "เช็คอินล่าสุด" can show what was actually scanned instead of
// just a name. `box` is in the *unmirrored* video coordinates the detector
// returns, but the canvas itself is painted mirrored (see useCameraStream's
// paint loop), so the crop's x has to be mirrored the same way the
// on-canvas name label already is. Returns null if the box ends up outside
// the canvas bounds (shouldn't normally happen, but a stale box from a
// just-lost face could briefly disagree with the canvas's current size).
function captureFaceSnapshot(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number }
): string | null {
  const padX = box.width * 0.35
  const padY = box.height * 0.35
  const mirroredX = canvas.width - box.x - box.width
  const sx = Math.max(0, mirroredX - padX)
  const sy = Math.max(0, box.y - padY)
  const sw = Math.min(canvas.width - sx, box.width + padX * 2)
  const sh = Math.min(canvas.height - sy, box.height + padY * 2)
  if (sw <= 0 || sh <= 0) return null

  const size = 220
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const ctx = out.getContext('2d')
  if (!ctx) return null
  // Cover-fit the crop into a fixed square thumbnail (source aspect ratio
  // isn't exactly square once padding is added, so scale to fill and center).
  const scale = Math.max(size / sw, size / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(canvas, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh)
  return out.toDataURL('image/jpeg', 0.82)
}

// Manual (employee-code) check-in has no detected face box to anchor a crop
// on — the camera may even be off, since manual is the fallback for when
// scanning doesn't work. When it IS on, this grabs a plain center-square
// crop of whatever's live in frame at the moment the check-in button is
// pressed (good enough: whoever is typing their code is standing in front
// of the camera), instead of running a second face-detection pass just for
// a photo.
function captureCenterSquareSnapshot(canvas: HTMLCanvasElement): string | null {
  const side = Math.min(canvas.width, canvas.height)
  if (side <= 0) return null
  const sx = (canvas.width - side) / 2
  const sy = (canvas.height - side) / 2

  const size = 220
  const out = document.createElement('canvas')
  out.width = size
  out.height = size
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(canvas, sx, sy, side, side, 0, 0, size, size)
  return out.toDataURL('image/jpeg', 0.82)
}

// Face-scan check-in kiosk widget, scoped to only this meeting's invitees
// (registeredParticipants, derived below), unlike FaceScanner.tsx which
// matches against the whole roster. onMatch/onManualCheckin call back up
// to MeetingDetail, which does the actual recordMeetingCheckin Supabase
// call and local state patching — this component only decides *when* a
// check-in should happen and what to show while it does.
export default function MeetingScanner({
  participants,
  checkedInIds,
  checkins,
  onMatch,
  onManualCheckin,
}: {
  participants: MeetingParticipant[]
  checkedInIds: Set<string>
  checkins: MeetingCheckin[]
  onMatch: (participant: MeetingParticipant, distance: number, photoUrl?: string) => void
  onManualCheckin: (participant: MeetingParticipant, photoUrl?: string) => void
}) {
  const registeredParticipants = useMemo(() => participants.filter((p) => p.faceDescriptor), [participants])
  // Lookup for the side "เช็คอินล่าสุด" panel so it can show a name/department
  // for every check-in row, including ones checked in manually (no
  // faceDescriptor, so they're outside registeredParticipants).
  const participantsById = useMemo(() => new Map(participants.map((p) => [p.memberId, p])), [participants])

  const containerRef = useRef<HTMLDivElement>(null)
  const lastMatchRef = useRef<Record<string, number>>({})
  const matchStreakRef = useRef<MatchStreak>({ memberId: null, since: 0 })

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

  // Tick policy (see CONTEXT.md "Tick policy"): the SAME participant must
  // match continuously for CONFIRM_HOLD_MS before a check-in is recorded —
  // protects against a single fleeting frame (motion blur, someone briefly
  // walking past, a photo held up for an instant) triggering a check-in
  // immediately. Switching to no-match, a different person, or losing the
  // face entirely resets the streak; only sustained agreement counts.
  const camera = useFaceCamera({
    candidates: registeredParticipants,
    onTick: (result) => {
      if (!result) {
        matchStreakRef.current = { memberId: null, since: 0 }
        setConfirmProgress(0)
        return null
      }
      const { face, bestMatch, isMatch } = result

      const now = Date.now()
      matchStreakRef.current = nextMatchStreak(matchStreakRef.current, isMatch ? bestMatch!.candidate.memberId : null, now)
      const heldMs = streakHeldMs(matchStreakRef.current, now)
      const isConfirmed = isMatch && heldMs >= CONFIRM_HOLD_MS
      setConfirmProgress(isMatch ? Math.min(1, heldMs / CONFIRM_HOLD_MS) : 0)

      if (isConfirmed) {
        const { candidate: participant, distance } = bestMatch!
        const lastTime = lastMatchRef.current[participant.memberId] ?? 0
        if (Date.now() - lastTime > REPEAT_COOLDOWN_MS && !checkedInIds.has(participant.memberId)) {
          lastMatchRef.current[participant.memberId] = Date.now()
          const snapshot = camera.canvasRef.current ? captureFaceSnapshot(camera.canvasRef.current, face.box) : null
          onMatch(participant, distance, snapshot ?? undefined)
          setFeedback({ name: participant.name, department: participant.department, position: participant.position, method: 'face' })
          matchStreakRef.current = { memberId: null, since: 0 }
          setConfirmProgress(0)
          window.setTimeout(() => setFeedback(null), 3200)
        }
      }

      return {
        box: face.box,
        color: isMatch ? (isConfirmed ? '#10b981' : '#3b82f6') : '#f59e0b',
        label: isMatch
          ? isConfirmed
            ? bestMatch!.candidate.name
            : `${bestMatch!.candidate.name} · กำลังยืนยัน`
          : 'ไม่ใช่ผู้เข้าร่วมประชุม',
      }
    },
  })

  useEffect(() => {
    camera.start()
    return () => camera.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Side "เช็คอินล่าสุด" panel — driven straight off the meeting's live
  // checkins (kept fresh via MeetingDetail's realtime subscription), not
  // local scan state, so it shows who checked in regardless of *which*
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
          position: p?.position ?? '',
          time: formatCheckinTime(c.checkedInAt),
          photoUrl: c.photoUrl,
        }
      })
  }, [checkins, participantsById])

  useEffect(() => {
    return onFullscreenChange(() => {
      setNativeFullscreen(getFullscreenElement() === containerRef.current)
    })
  }, [])

  const toggleFullscreen = useCallback(async () => {
    // Turning off — exit real fullscreen if it's engaged, release any
    // orientation lock we may have taken, and always clear the manual CSS
    // fallback too (only one of the two is ever true, but clearing both
    // keeps this in sync regardless of how we got here).
    if (nativeFullscreen || manualFullscreen) {
      if (getFullscreenElement()) {
        try {
          await exitFullscreen()
        } catch {
          // ignore — the manualFullscreen(false) below still turns off the
          // kiosk layout even if the native exit call itself failed
        }
      }
      unlockOrientation()
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
        await requestFullscreen(containerRef.current)
        await lockLandscape()
      } catch {
        setManualFullscreen(true)
        await lockLandscape()
      }
    }
  }, [nativeFullscreen, manualFullscreen])

  return (
    // containerRef is the element that actually goes fullscreen (via the
    // Fullscreen API) when the button below is pressed. It wraps the header
    // too — not just the video box — so the "ย่อออกจากเต็มจอ" control and
    // the เปิด/ปิดกล้อง button stay reachable while fullscreened, on every
    // device (the `isFullscreen &&` classes are a CSS belt-and-braces fallback
    // for the rare case a browser's native fullscreen sizing doesn't kick in).
    <div ref={containerRef} className={cn(isFullscreen && 'fixed inset-0 z-50 overflow-y-auto bg-background p-3 sm:p-4')}>
      <Card className={cn('border-border/70 shadow-soft', isFullscreen && 'flex h-full min-h-0 flex-col border-none shadow-none')}>
        <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <ScanFace className="h-4 w-4 text-primary" /> สแกนใบหน้าเพื่อเช็คอินเข้าร่วมประชุม
            </CardTitle>
            <CardDescription>รองรับผู้เข้าร่วมที่ลงทะเบียนใบหน้าแล้ว {registeredParticipants.length} คน</CardDescription>
          </div>
          {/* flex-nowrap: these two buttons must always wrap together as one
              group (below the title, on narrow screens) rather than being
              free to separate from each other — otherwise one can end up on
              a different line than the other, effectively going missing
              from view depending on scroll position. */}
          <div className="flex flex-nowrap items-center gap-2 shrink-0">
            {camera.cameraState === 'ready' ? (
              <Button size="sm" variant="outline" onClick={camera.stop} className="shrink-0 gap-1.5">
                <CameraOff className="h-3.5 w-3.5" /> ปิดกล้อง
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => camera.start()} className="shrink-0 gap-1.5">
                <Camera className="h-3.5 w-3.5" /> เปิดกล้อง
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={toggleFullscreen} className="shrink-0 gap-1.5">
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreen ? 'ย่อออกจากเต็มจอ' : 'โหมดเต็มจอ'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={cn(isFullscreen && 'flex min-h-0 flex-1 flex-col')}>
          <div className={cn('flex flex-col gap-3', isFullscreen ? 'min-h-0 flex-1 md:flex-row' : 'md:flex-row')}>
            <div
              className={cn(
                'relative overflow-hidden rounded-2xl bg-slate-900',
                isFullscreen ? 'min-h-[45vh] flex-1' : 'mx-auto aspect-video w-full max-w-xl md:mx-0 md:flex-1'
              )}
            >
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
              {camera.cameraState === 'idle' && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/60">
                  <CameraOff className="h-7 w-7" />
                  <p className="text-sm">กล้องปิดอยู่</p>
                </div>
              )}
              <video
                ref={camera.videoRef}
                muted
                playsInline
                webkit-playsinline="true"
                className="absolute -left-full -top-full h-px w-px opacity-0"
              />
              <canvas
                ref={camera.canvasRef}
                className={cn('h-full w-full object-cover', camera.cameraState !== 'ready' && 'hidden')}
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
                // Plain overlay (not a sonner toast) deliberately — this box IS
                // `containerRef`'s subtree, i.e. the element that actually goes
                // fullscreen, whereas <Toaster/> is mounted at the app root and
                // becomes invisible once the native Fullscreen API is active on
                // a *different* element. A toast.custom() here would silently
                // never be seen on a fullscreen kiosk display.
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in">
                  <CheckinSuccessToast
                    name={feedback.name}
                    department={feedback.department}
                    position={feedback.position}
                    method={feedback.method}
                    durationMs={3200}
                  />
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
                isFullscreen
                  ? 'w-full min-h-0 border-slate-200 bg-white text-slate-900 md:h-full md:w-72'
                  : 'w-full self-start border-border/70 bg-card md:w-64'
              )}
            >
              <ManualMeetingCheckin
                participants={participants}
                checkedInIds={checkedInIds}
                onCheckin={(participant, photoUrl) => {
                  // Optimistic, same as the face-match path above — shows
                  // immediately rather than waiting on the parent's async
                  // recordMeetingCheckin, and (crucially) renders inside this
                  // component's own containerRef subtree so it's actually
                  // visible in fullscreen kiosk mode, unlike a toast would be.
                  setFeedback({
                    name: participant.name,
                    department: participant.department,
                    position: participant.position,
                    method: 'manual',
                  })
                  window.setTimeout(() => setFeedback(null), 3200)
                  onManualCheckin(participant, photoUrl)
                }}
                isFullscreen={isFullscreen}
                capturePhoto={() =>
                  camera.cameraState === 'ready' && camera.canvasRef.current
                    ? captureCenterSquareSnapshot(camera.canvasRef.current)
                    : null
                }
              />

              <div
                className={cn(
                  'flex flex-col gap-2 border-t pt-2.5',
                  isFullscreen ? 'min-h-0 flex-1 border-slate-200' : 'border-border/60'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={cn('flex items-center gap-1.5 text-xs font-semibold', isFullscreen ? 'text-slate-500' : 'text-muted-foreground')}>
                    <Users className="h-3.5 w-3.5" /> เช็คอินล่าสุด
                  </p>
                  {isFullscreen && (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                      <PulseDot />
                      LIVE
                    </span>
                  )}
                </div>
                <div className={cn('space-y-1.5 overflow-y-auto', isFullscreen ? 'min-h-0 flex-1' : 'max-h-56')}>
                {recentScans.length === 0 ? (
                  <p className={cn('rounded-lg px-2.5 py-2 text-xs', isFullscreen ? 'bg-slate-50 text-slate-400' : 'bg-muted text-muted-foreground')}>
                    ยังไม่มีผู้เช็คอิน
                  </p>
                ) : (
                  recentScans.map((r, i) => (
                    <div
                      key={r.id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
                        isFullscreen ? 'border-slate-200 bg-slate-50' : 'border-border/50 bg-secondary/40',
                        i === 0 && 'border-emerald-500/60'
                      )}
                    >
                      <CheckinIdentity
                        name={r.name}
                        position={r.position}
                        department={r.department}
                        photo={r.photoUrl}
                        checkOverlay
                        theme={isFullscreen ? 'fullscreen' : 'default'}
                        subtitleSuffix={r.time}
                      />
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
// member roster — matches the scoping of the face scanner above. No outer
// Card/border of its own — it sits inside MeetingScanner's side panel,
// which already has one; an `isFullscreen` prop lets it flip to
// light-on-dark text/input styling so it still reads correctly against the
// side panel's dark theme in kiosk mode.
function ManualMeetingCheckin({
  participants,
  checkedInIds,
  onCheckin,
  isFullscreen,
  capturePhoto,
}: {
  participants: MeetingParticipant[]
  checkedInIds: Set<string>
  onCheckin: (participant: MeetingParticipant, photoUrl?: string) => void
  isFullscreen: boolean
  // Grabs a snapshot off the live camera feed at the moment of check-in, or
  // null if the camera isn't currently on — manual check-in is also the
  // fallback for when the camera doesn't work at all, so this must degrade
  // gracefully rather than require a frame that may not exist.
  capturePhoto: () => string | null
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
    <div className="flex shrink-0 flex-col gap-1.5">
      <p className={cn('flex items-center gap-1.5 text-xs font-semibold', isFullscreen ? 'text-slate-500' : 'text-muted-foreground')}>
        <KeyRound className="h-3.5 w-3.5" /> เช็คอินด้วยรหัส
      </p>
      <div className="relative">
        <Search
          className={cn(
            'pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2',
            isFullscreen ? 'text-slate-400' : 'text-muted-foreground'
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
            'h-8 ps-7 text-base sm:text-sm',
            isFullscreen && 'border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400'
          )}
        />
      </div>
      {query.trim() && (
        <div className="space-y-1">
          {matches.length === 0 ? (
            <p className={cn('rounded-lg px-2 py-1.5 text-xs', isFullscreen ? 'bg-slate-50 text-slate-400' : 'bg-muted text-muted-foreground')}>
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
                    onCheckin(p, capturePhoto() ?? undefined)
                    setQuery('')
                  }}
                  disabled={checkedIn}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
                    isFullscreen ? 'border-slate-200' : 'border-border/60',
                    checkedIn
                      ? 'cursor-not-allowed opacity-60'
                      : isFullscreen
                        ? 'hover:bg-slate-100'
                        : 'hover:border-primary/50 hover:bg-secondary'
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  {checkedIn ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium text-primary">เช็คอิน</span>
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
