import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  ScanFace,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  SwitchCamera,
  ShieldAlert,
  ImagePlus,
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCameraStream } from '@/hooks/useCameraStream'
import {
  detectFaceWithDescriptor,
  detectFaceLandmarksOnly,
  captureCleanMirroredFrame,
  averageEyeAspectRatio,
  nextLivenessState,
  isLive,
  type LivenessState,
} from '@/lib/faceEngine'
import { cn } from '@/lib/utils'

interface FaceCaptureDialogProps {
  open: boolean
  memberName: string
  onOpenChange: (open: boolean) => void
  onCaptured: (descriptor: number[], photo: string) => void
}

const MODEL_LOAD_ERROR_MESSAGE =
  'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ (อาจเกิดจากข้อจำกัดเครือข่ายในหน้าตัวอย่างนี้) กรุณารันโปรเจกต์นี้ภายนอกเพื่อใช้งานกล้องจริง หรือใช้การเช็คอินแบบ Manual แทน'

// Crops the uploaded photo down to the detected face box (plus a margin so
// the crop doesn't hug the jawline/hairline too tightly), matching the
// tight framing of a live camera capture instead of storing the whole
// uploaded photo.
function cropFaceToDataUrl(
  img: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number }
): string {
  const paddingX = box.width * 0.4
  const paddingY = box.height * 0.4
  const cropX = Math.max(0, box.x - paddingX)
  const cropY = Math.max(0, box.y - paddingY)
  const cropWidth = Math.min(img.naturalWidth - cropX, box.width + paddingX * 2)
  const cropHeight = Math.min(img.naturalHeight - cropY, box.height + paddingY * 2)

  const canvas = document.createElement('canvas')
  canvas.width = cropWidth
  canvas.height = cropHeight
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(img, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
  }
  return canvas.toDataURL('image/jpeg', 0.85)
}

export default function FaceCaptureDialog({
  open,
  memberName,
  onOpenChange,
  onCaptured,
}: FaceCaptureDialogProps) {
  const camera = useCameraStream({ modelLoadErrorMessage: MODEL_LOAD_ERROR_MESSAGE })
  const detectRafRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [captureErrorMsg, setCaptureErrorMsg] = useState('')
  const [captured, setCaptured] = useState<{ descriptor: number[]; photo: string } | null>(null)
  const [faceDetected, setFaceDetected] = useState(false)
  // Liveness (blink) gate for the live-capture path only — the gallery
  // upload path is a still image and can never satisfy it. Optional: a
  // "skip" button lets the flow proceed without a blink if the camera/
  // lighting makes one hard to catch, rather than blocking registration.
  const livenessRef = useRef<LivenessState>({ eyesClosed: false, blinkAt: null })
  const [blinkOk, setBlinkOk] = useState(false)
  const [skipLiveness, setSkipLiveness] = useState(false)
  // Guards the auto-capture-on-blink trigger below so it only fires once per
  // scan session — without it, every tick after the blink stays "live" for
  // LIVENESS_VALID_MS and would kick off another capture race.
  const autoCapturedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setCaptured(null)
    setCaptureErrorMsg('')
    livenessRef.current = { eyesClosed: false, blinkAt: null }
    setBlinkOk(false)
    setSkipLiveness(false)
    autoCapturedRef.current = false
    camera.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Own presence-check loop: unlike useFaceCamera's throttled candidate
  // matching, this dialog only needs "is any face in frame right now" to
  // enable the capture button — no candidate list, no match policy.
  useEffect(() => {
    if (camera.cameraState !== 'ready') return
    let cancelled = false

    async function tick() {
      const video = camera.videoRef.current
      if (video && video.readyState >= 2) {
        try {
          const result = await detectFaceLandmarksOnly(video)
          if (cancelled) return
          setFaceDetected(!!result)
          if (result) {
            const now = Date.now()
            const ear = averageEyeAspectRatio(result.landmarks)
            livenessRef.current = nextLivenessState(livenessRef.current, ear, now)
            const live = isLive(livenessRef.current.blinkAt, now)
            setBlinkOk(live)
            if (live && !autoCapturedRef.current) {
              autoCapturedRef.current = true
              void captureFromVideo(video)
            }
          } else {
            livenessRef.current = { eyesClosed: false, blinkAt: null }
            setBlinkOk(false)
          }
          camera.paint(result ? { box: result.box, color: '#14b8a6' } : null)
        } catch {
          // keep looping silently; transient detection errors are common
        }
      }
      if (!cancelled) detectRafRef.current = requestAnimationFrame(tick)
    }
    detectRafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.cameraState])

  // Shared by the auto-capture-on-blink trigger (tick loop above) and the
  // manual "ถ่ายภาพ" button (still needed as a fallback when the user taps
  // "ข้ามการตรวจสอบกระพริบตา").
  async function captureFromVideo(video: HTMLVideoElement) {
    const result = await detectFaceWithDescriptor(video)
    if (!result) {
      setCaptureErrorMsg('ไม่พบใบหน้าในเฟรมนี้ กรุณาจัดใบหน้าให้อยู่ตรงกลางกล้องแล้วลองใหม่')
      return
    }
    setCaptureErrorMsg('')
    const snapCanvas = captureCleanMirroredFrame(video)
    const photo = snapCanvas?.toDataURL('image/jpeg', 0.85)
    if (!photo) {
      setCaptureErrorMsg('ถ่ายภาพไม่สำเร็จ กรุณาลองใหม่')
      return
    }
    setCaptured({ descriptor: Array.from(result.descriptor), photo })
    if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current)
    camera.stop()
  }

  async function handleCapture() {
    const video = camera.videoRef.current
    if (!video) return
    if (!skipLiveness && !blinkOk) return
    await captureFromVideo(video)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const img = new Image()
    img.src = dataUrl
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
    })

    const result = await detectFaceWithDescriptor(img)
    if (!result) {
      setCaptureErrorMsg('ไม่พบใบหน้าในรูปภาพนี้ กรุณาเลือกรูปภาพอื่นที่เห็นใบหน้าชัดเจน')
      return
    }
    setCaptureErrorMsg('')
    const photo = cropFaceToDataUrl(img, result.box)
    setCaptured({ descriptor: Array.from(result.descriptor), photo })
    if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current)
    camera.stop()
  }

  function handleConfirm() {
    if (!captured) return
    onCaptured(captured.descriptor, captured.photo)
    onOpenChange(false)
  }

  function handleRetake() {
    setCaptured(null)
    livenessRef.current = { eyesClosed: false, blinkAt: null }
    setBlinkOk(false)
    setSkipLiveness(false)
    autoCapturedRef.current = false
    camera.start(camera.activeDeviceId)
  }

  const showFrameWarning = camera.cameraState === 'ready' && (camera.trackMuted || camera.noFrames || camera.blackFrames)
  const scanning = camera.cameraState === 'ready' && !captured

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ScanFace className="h-5 w-5 text-primary" />
            ลงทะเบียนใบหน้า
          </DialogTitle>
          <DialogDescription>สำหรับสมาชิก: {memberName}</DialogDescription>
        </DialogHeader>

        {scanning && camera.devices.length > 1 && (
          <Select value={camera.activeDeviceId} onValueChange={(id) => camera.start(id)}>
            <SelectTrigger className="h-8 text-xs">
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

        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
          {!captured && camera.cameraState === 'loading' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">กำลังเตรียมกล้องและโมเดล...</p>
            </div>
          )}

          {!captured && camera.cameraState === 'error' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 overflow-y-auto p-4 text-center text-white/80">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed">{camera.errorMsg}</p>
            </div>
          )}

          {/* <video> is only a decode source for the paint loop; the visible
              surface is always the canvas below (except for the final
              still photo once captured). */}
          <video
            ref={camera.videoRef}
            muted
            playsInline
            webkit-playsinline="true"
            className="absolute -left-full -top-full h-px w-px opacity-0"
          />

          {(scanning || captured) && (
            <>
              <canvas
                ref={camera.canvasRef}
                className={cn('h-full w-full object-cover', captured && 'hidden')}
              />
              {captured && (
                <img src={captured.photo} className="h-full w-full object-cover" alt="ใบหน้าที่บันทึก" />
              )}
              {scanning && !showFrameWarning && (
                <div
                  className={cn(
                    'absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium backdrop-blur',
                    faceDetected ? 'bg-emerald-500/90 text-white' : 'bg-black/50 text-white/80'
                  )}
                >
                  {!faceDetected
                    ? 'กำลังค้นหาใบหน้า...'
                    : skipLiveness
                      ? 'ตรวจพบใบหน้า พร้อมถ่ายภาพ'
                      : blinkOk
                        ? 'กำลังถ่ายภาพ...'
                        : 'ตรวจพบใบหน้า กระพริบตาเพื่อถ่ายภาพอัตโนมัติ'}
                </div>
              )}
              {captured && (
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-medium text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" /> บันทึกใบหน้าแล้ว
                </div>
              )}
            </>
          )}

          {showFrameWarning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto bg-slate-900/95 p-4 text-center">
              <ShieldAlert className="h-6 w-6 shrink-0 text-amber-400" />
              {camera.blackFrames && !camera.noFrames && !camera.trackMuted ? (
                <p className="text-xs leading-relaxed text-white/90">
                  กล้องเชื่อมต่อและส่งภาพมาจริง แต่เนื้อหาของภาพเป็นสีดำสนิท — ไม่ใช่ปัญหาจากตัวแอปนี้
                  แต่เป็นระบบปฏิบัติการหรือซอฟต์แวร์ความปลอดภัยของเครื่องนี้เองที่ปิดกั้นภาพจริงไว้
                  แนะนำให้ปิดหน้าต่างนี้แล้วใช้เช็คอินแบบ Manual แทนสำหรับเครื่องนี้ไปก่อน
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-white/90">
                  เชื่อมต่อกล้องสำเร็จแต่ไม่มีสัญญาณภาพส่งมา มักเกิดจากซอฟต์แวร์ป้องกันเว็บแคมบล็อกไว้
                  ลองปิดการป้องกันชั่วคราว หรือปิดหน้าต่างนี้แล้วใช้เช็คอินแบบ Manual แทน
                </p>
              )}
            </div>
          )}
        </div>

        {scanning && !showFrameWarning && (
          <>
            <p className="text-center text-sm font-medium text-foreground">
              {faceDetected && !skipLiveness && !blinkOk ? 'กระพริบตา 1 ครั้งเพื่อยืนยันตัวตน' : 'มองตรงเข้ากล้อง'}
            </p>
            <p className="text-center text-xs text-muted-foreground">
              ถ้าภาพเป็นสีดำสนิท ลองเลือกกล้องอื่นจากเมนูด้านบน (บางเครื่องมีกล้อง IR สำหรับ Windows Hello ด้วย)
            </p>
          </>
        )}

        {captureErrorMsg && scanning && (
          <p className="text-center text-xs text-destructive">{captureErrorMsg}</p>
        )}

        <DialogFooter className="gap-2 sm:justify-center">
          {scanning && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                <ImagePlus className="h-4 w-4" /> เพิ่มรูปภาพ
              </Button>
              {faceDetected && !skipLiveness && !blinkOk && (
                <Button variant="ghost" onClick={() => setSkipLiveness(true)} className="text-xs text-muted-foreground">
                  ข้ามการตรวจสอบกระพริบตา
                </Button>
              )}
              <Button
                onClick={handleCapture}
                disabled={!faceDetected || (!skipLiveness && !blinkOk)}
                className="gap-1.5"
              >
                <ScanFace className="h-4 w-4" /> ถ่ายภาพและบันทึก
              </Button>
            </>
          )}
          {captured && (
            <>
              <Button variant="outline" onClick={handleRetake} className="gap-1.5">
                <RotateCcw className="h-4 w-4" /> ถ่ายใหม่
              </Button>
              <Button onClick={handleConfirm} className="gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> ยืนยันการลงทะเบียน
              </Button>
            </>
          )}
          {!captured && camera.cameraState === 'error' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              ปิดหน้าต่าง
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
