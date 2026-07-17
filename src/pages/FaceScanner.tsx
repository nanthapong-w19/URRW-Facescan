import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  ScanFace,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Camera,
  CameraOff,
  Search,
} from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { recordCheckin, hasCheckedInToday } from '@/lib/store'
import {
  loadFaceModels,
  detectFaceWithDescriptor,
  descriptorDistance,
  distanceToConfidence,
  MATCH_THRESHOLD,
} from '@/lib/faceEngine'
import type { Member } from '@/lib/types'
import { cn } from '@/lib/utils'

type CameraState = 'idle' | 'loading' | 'ready' | 'error'
type ScanFeedback = { kind: 'success' | 'unknown'; name?: string; department?: string } | null

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

const SCAN_INTERVAL_MS = 500
const REPEAT_COOLDOWN_MS = 15000

export default function FaceScanner() {
  const { members } = useAppData()
  const registeredMembers = useMemo(() => members.filter((m) => m.faceStatus === 'registered'), [members])

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastCheckinRef = useRef<Record<string, number>>({})

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [feedback, setFeedback] = useState<ScanFeedback>(null)
  const [manualQuery, setManualQuery] = useState('')

  const startCamera = useCallback(async () => {
    setCameraState('loading')
    setErrorMsg('')
    try {
      await loadFaceModels()
    } catch {
      setErrorMsg(
        'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ อาจเกิดจากข้อจำกัดเครือข่ายของหน้าตัวอย่างนี้ กรุณารันโปรเจกต์นี้ในเครื่องของคุณเพื่อใช้กล้องจริง หรือใช้ "เช็คอินแบบ Manual" ด้านล่างแทนได้ทันที'
      )
      setCameraState('error')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraState('ready')
    } catch {
      setErrorMsg('ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการใช้งานกล้อง หรือใช้ "เช็คอินแบบ Manual" แทน')
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
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const drawOverlay = useCallback(
    (box: { x: number; y: number; width: number; height: number } | null, matched: Member | null) => {
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!box) return

      const color = matched ? '#10b981' : '#f59e0b'
      ctx.strokeStyle = color
      ctx.lineWidth = 4
      ctx.strokeRect(box.x, box.y, box.width, box.height)

      const label = matched ? matched.name : 'ไม่พบในระบบ'
      ctx.font = '600 20px "Plus Jakarta Sans", sans-serif'
      const textWidth = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.fillRect(box.x - 2, box.y - 34, textWidth + 16, 30)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, box.x + 6, box.y - 11)
    },
    []
  )

  // Main detection loop
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
        drawOverlay(null, null)
        return
      }

      let best: { member: Member; distance: number } | null = null
      for (const m of registeredMembers) {
        if (!m.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, m.faceDescriptor)
        if (!best || distance < best.distance) best = { member: m, distance }
      }

      const isMatch = best && best.distance < MATCH_THRESHOLD
      drawOverlay(result.box, isMatch ? best!.member : null)

      if (isMatch) {
        const member = best!.member
        const lastTime = lastCheckinRef.current[member.id] ?? 0
        const alreadyToday = hasCheckedInToday(member.id)
        if (Date.now() - lastTime > REPEAT_COOLDOWN_MS && !alreadyToday) {
          lastCheckinRef.current[member.id] = Date.now()
          recordCheckin(member, 'face', distanceToConfidence(best!.distance))
          setFeedback({ kind: 'success', name: member.name, department: member.department })
          playSuccessChime()
          toast.success(`เช็คอินสำเร็จ: ${member.name}`, { duration: 3500 })
          window.setTimeout(() => setFeedback(null), 3200)
        }
      }
    }, SCAN_INTERVAL_MS)

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [cameraState, registeredMembers, drawOverlay])

  const manualMatches = useMemo(() => {
    if (!manualQuery.trim()) return []
    const q = manualQuery.trim().toLowerCase()
    return members
      .filter((m) => m.employeeId.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .slice(0, 5)
  }, [members, manualQuery])

  function handleManualCheckin(member: Member) {
    if (hasCheckedInToday(member.id)) {
      toast.info(`${member.name} เช็คอินไปแล้ววันนี้`)
      setManualQuery('')
      return
    }
    recordCheckin(member, 'manual')
    toast.success(`เช็คอินสำเร็จ (Manual): ${member.name}`)
    playSuccessChime()
    setManualQuery('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          สแกนใบหน้าเพื่อเช็คอิน
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          จัดใบหน้าให้อยู่ตรงกลางกรอบกล้อง ระบบจะเช็คอินให้อัตโนมัติเมื่อพบข้อมูลตรงกัน
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="border-border/70 shadow-soft lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display text-base">กล้องสแกนใบหน้า</CardTitle>
              <CardDescription>
                สมาชิกที่ลงทะเบียนใบหน้าแล้ว {registeredMembers.length} / {members.length} คน
              </CardDescription>
            </div>
            {cameraState === 'ready' ? (
              <Button size="sm" variant="outline" onClick={stopCamera} className="gap-1.5">
                <CameraOff className="h-3.5 w-3.5" /> ปิดกล้อง
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={startCamera} className="gap-1.5">
                <Camera className="h-3.5 w-3.5" /> เปิดกล้อง
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl bg-slate-900">
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
                  <Button size="sm" variant="secondary" onClick={startCamera} className="mt-1 gap-1.5">
                    <Camera className="h-3.5 w-3.5" /> ลองอีกครั้ง
                  </Button>
                </div>
              )}
              {(cameraState === 'ready' || cameraState === 'idle') && (
                <>
                  <video ref={videoRef} muted playsInline className="h-full w-full object-cover -scale-x-100" />
                  <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100" />
                </>
              )}

              {feedback?.kind === 'success' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
                  <CheckCircle2 className="h-14 w-14" />
                  <p className="font-display text-2xl font-bold">เช็คอินสำเร็จ</p>
                  <p className="text-lg">{feedback.name}</p>
                  <p className="text-sm text-white/80">{feedback.department}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" /> เช็คอินแบบ Manual
            </CardTitle>
            <CardDescription>สำหรับกรณีที่ระบบสแกนใบหน้ามีปัญหา หรือกล้องใช้งานไม่ได้</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="พิมพ์รหัสพนักงานหรือชื่อ"
                className="pl-8"
              />
            </div>

            <div className="min-h-[3rem] space-y-1.5">
              {manualQuery.trim() && manualMatches.length === 0 && (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">ไม่พบสมาชิกที่ตรงกัน</p>
              )}
              {manualMatches.map((m) => {
                const checkedIn = hasCheckedInToday(m.id)
                return (
                  <button
                    key={m.id}
                    onClick={() => handleManualCheckin(m)}
                    disabled={checkedIn}
                    className={cn(
                      'flex w-full items-center justify-between rounded-xl border border-border/70 px-3 py-2.5 text-left transition-colors',
                      checkedIn ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50 hover:bg-secondary'
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{m.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.employeeId} · {m.department}
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

            <div className="rounded-xl border border-dashed border-border/70 bg-secondary/40 p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <ScanFace className="h-3.5 w-3.5" /> เคล็ดลับการสแกน
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                <li>ให้แสงส่องหน้าอย่างเพียงพอ หลีกเลี่ยงแสงย้อน</li>
                <li>มองตรงเข้ากล้องและอยู่ห่างประมาณ 40-60 ซม.</li>
                <li>สมาชิกต้องลงทะเบียนใบหน้าในหน้า &quot;จัดการสมาชิก&quot; ก่อน</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
