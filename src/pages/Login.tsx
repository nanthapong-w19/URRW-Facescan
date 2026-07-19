import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScanFace, Loader2, AlertTriangle, ShieldCheck, KeyRound, Camera } from 'lucide-react'
import { useAppData } from '@/hooks/useAppData'
import { useAdminAuth } from '@/lib/adminAuth'
import { loadFaceModels, detectFaceWithDescriptor, descriptorDistance, MATCH_THRESHOLD } from '@/lib/faceEngine'
import { describeGetUserMediaError } from '@/lib/cameraHelpers'
import type { Member } from '@/lib/types'
import { cn } from '@/lib/utils'

type CameraState = 'idle' | 'loading' | 'ready' | 'error'

const SCAN_INTERVAL_MS = 500

// Face-login page, gated to members with role === 'admin' who have already
// registered a face on the Members page. On a match, records an "admin
// session" (see lib/adminAuth.tsx) that unlocks the meeting-creation
// pages. Includes a manual employee-ID fallback for when the camera isn't
// usable, mirroring the same pattern as the manual check-in flow on
// /scan — with an added role check so a non-admin employee ID can't get in.
export default function Login() {
  const { members } = useAppData()
  const { loginAsAdmin } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/meetings'

  const adminMembers = useMemo(
    () => members.filter((m) => m.role === 'admin' && m.faceStatus === 'registered'),
    [members]
  )
  const adminCount = useMemo(() => members.filter((m) => m.role === 'admin').length, [members])

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const paintRafRef = useRef<number | null>(null)
  const matchedRef = useRef(false)

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [matchedName, setMatchedName] = useState<string | null>(null)
  const [manualId, setManualId] = useState('')
  const [manualError, setManualError] = useState('')

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
      setErrorMsg(
        'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ กรุณาใช้ "เข้าสู่ระบบด้วยรหัสพนักงาน" ด้านล่างแทน หรือลองใหม่อีกครั้ง'
      )
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
  }, [])

  function completeLogin(member: Member) {
    if (matchedRef.current) return
    matchedRef.current = true
    stopCamera()
    setMatchedName(member.name)
    loginAsAdmin(member)
    toast.success(`เข้าสู่ระบบสำเร็จ: ${member.name}`)
    window.setTimeout(() => navigate(redirectTo, { replace: true }), 900)
  }

  useEffect(() => {
    startCamera()
    paintRafRef.current = requestAnimationFrame(paintLoop)
    return () => {
      if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current)
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (cameraState !== 'ready') return
    timerRef.current = window.setInterval(async () => {
      if (matchedRef.current) return
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      let result
      try {
        result = await detectFaceWithDescriptor(video)
      } catch {
        return
      }
      if (!result) return

      let best: { member: Member; distance: number } | null = null
      for (const m of adminMembers) {
        if (!m.faceDescriptor) continue
        const distance = descriptorDistance(result.descriptor, m.faceDescriptor)
        if (!best || distance < best.distance) best = { member: m, distance }
      }
      if (best && best.distance < MATCH_THRESHOLD) {
        completeLogin(best.member)
      }
    }, SCAN_INTERVAL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, adminMembers])

  function handleManualLogin() {
    setManualError('')
    const id = manualId.trim()
    if (!id) {
      setManualError('กรุณากรอกรหัสพนักงาน')
      return
    }
    const member = members.find((m) => m.employeeId.toLowerCase() === id.toLowerCase())
    if (!member) {
      setManualError('ไม่พบรหัสพนักงานนี้ในระบบ')
      return
    }
    if (member.role !== 'admin') {
      setManualError('รหัสพนักงานนี้ไม่มีสิทธิ์ผู้ดูแลระบบ (admin)')
      return
    }
    completeLogin(member)
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          เข้าสู่ระบบผู้ดูแล
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">สแกนใบหน้าเพื่อเข้าสู่ระบบและจัดการการประชุม</p>
      </div>

      <Card className="border-border/70 shadow-soft">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <ScanFace className="h-4 w-4 text-primary" /> สแกนใบหน้าผู้ดูแลระบบ
          </CardTitle>
          <CardDescription>
            รองรับผู้ดูแลระบบที่ลงทะเบียนใบหน้าแล้ว {adminMembers.length} / {adminCount} คน
          </CardDescription>
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
                <Button size="sm" variant="secondary" onClick={() => startCamera()} className="mt-1 gap-1.5">
                  <Camera className="h-3.5 w-3.5" /> ลองอีกครั้ง
                </Button>
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
              className={cn('h-full w-full object-cover', (cameraState === 'loading' || cameraState === 'error') && 'hidden')}
            />
            {matchedName && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-600/90 text-white backdrop-blur-sm animate-in fade-in zoom-in-95">
                <ShieldCheck className="h-14 w-14" />
                <p className="font-display text-xl font-bold">ยินดีต้อนรับ</p>
                <p className="text-lg">{matchedName}</p>
              </div>
            )}
          </div>
          {adminMembers.length === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ยังไม่มีผู้ดูแลระบบที่ลงทะเบียนใบหน้าไว้ กรุณาไปที่หน้า &quot;สมาชิก&quot; ตั้งค่า role เป็น admin
              และลงทะเบียนใบหน้าก่อน หรือใช้การเข้าสู่ระบบด้วยรหัสพนักงานด้านล่าง
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" /> เข้าสู่ระบบด้วยรหัสพนักงาน (สำรอง)
          </CardTitle>
          <CardDescription>สำหรับกรณีกล้องใช้งานไม่ได้ — ใช้ได้เฉพาะรหัสที่มีสิทธิ์ admin เท่านั้น</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="manual-id">รหัสพนักงาน</Label>
            <Input
              id="manual-id"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualLogin()}
              placeholder="เช่น T-0012"
            />
          </div>
          {manualError && <p className="text-xs text-destructive">{manualError}</p>}
          <Button onClick={handleManualLogin} className="w-full gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> เข้าสู่ระบบ
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
