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
import { cleanDeviceLabel } from '@/lib/cameraHelpers'
import {
  detectFaceWithDescriptor,
  detectFaceLandmarksOnly,
  captureCleanMirroredFrame,
  averageDescriptors,
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

// Registration averages several descriptors taken a beat apart (natural
// micro-variance in angle/expression as the person holds still) into one
// centroid via averageDescriptors() — noticeably more robust to the
// lighting/angle the person will actually show up in at check-in time than
// a single frozen frame, at zero extra cost on the match side.
const ENROLLMENT_SHOT_COUNT = 4
const ENROLLMENT_SHOT_INTERVAL_MS = 350

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
  const [shotsCollected, setShotsCollected] = useState(0)
  // Guards the auto-capture-on-detect trigger below so it only fires once
  // per scan session — without it, every tick after the first detection
  // would kick off another enrollment-sequence race. A ref (not state)
  // because the tick loop's closure only refreshes when camera.cameraState
  // changes, so a state value read there would stay stale.
  const enrollmentRunningRef = useRef(false)
  // Flips false when the dialog closes/unmounts so an in-flight multi-shot
  // sequence stops writing state after the fact.
  const activeRef = useRef(true)

  useEffect(() => {
    if (!open) return
    activeRef.current = true
    setCaptured(null)
    setCaptureErrorMsg('')
    setShotsCollected(0)
    enrollmentRunningRef.current = false
    camera.start()
    return () => {
      activeRef.current = false
    }
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
          if (result && !enrollmentRunningRef.current) {
            enrollmentRunningRef.current = true
            void runEnrollmentCapture(video)
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

  function finishCapture(descriptor: number[], photo: string) {
    setCaptureErrorMsg('')
    setCaptured({ descriptor, photo })
    if (detectRafRef.current) cancelAnimationFrame(detectRafRef.current)
    camera.stop()
  }

  // Auto-capture-on-detect trigger (tick loop above): takes ENROLLMENT_SHOT_COUNT
  // descriptors a beat apart and averages them into one steadier reference
  // (see the comment on ENROLLMENT_SHOT_COUNT above). Bails and lets the tick
  // loop retry from scratch if the face is lost mid-sequence, rather than
  // silently registering off fewer shots.
  async function runEnrollmentCapture(video: HTMLVideoElement) {
    const descriptors: number[][] = []
    for (let i = 0; i < ENROLLMENT_SHOT_COUNT; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, ENROLLMENT_SHOT_INTERVAL_MS))
      if (!activeRef.current) return
      const result = await detectFaceWithDescriptor(video)
      if (!activeRef.current) return
      if (!result) {
        setShotsCollected(0)
        enrollmentRunningRef.current = false
        return
      }
      descriptors.push(Array.from(result.descriptor))
      setShotsCollected(i + 1)
    }

    const snapCanvas = captureCleanMirroredFrame(video)
    const photo = snapCanvas?.toDataURL('image/jpeg', 0.85)
    if (!photo) {
      setCaptureErrorMsg('ถ่ายภาพไม่สำเร็จ กรุณาลองใหม่')
      setShotsCollected(0)
      enrollmentRunningRef.current = false
      return
    }
    finishCapture(averageDescriptors(descriptors), photo)
  }

  // Manual fallback for when the auto sequence above keeps losing the face
  // mid-capture (e.g. can't hold still long enough) — a single shot beats
  // being stuck.
  async function handleCapture() {
    const video = camera.videoRef.current
    if (!video) return
    const result = await detectFaceWithDescriptor(video)
    if (!result) {
      setCaptureErrorMsg('ไม่พบใบหน้าในเฟรมนี้ กรุณาจัดใบหน้าให้อยู่ตรงกลางกล้องแล้วลองใหม่')
      return
    }
    const snapCanvas = captureCleanMirroredFrame(video)
    const photo = snapCanvas?.toDataURL('image/jpeg', 0.85)
    if (!photo) {
      setCaptureErrorMsg('ถ่ายภาพไม่สำเร็จ กรุณาลองใหม่')
      return
    }
    finishCapture(Array.from(result.descriptor), photo)
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
    finishCapture(Array.from(result.descriptor), cropFaceToDataUrl(img, result.box))
  }

  function handleConfirm() {
    if (!captured) return
    onCaptured(captured.descriptor, captured.photo)
    onOpenChange(false)
  }

  function handleRetake() {
    setCaptured(null)
    setShotsCollected(0)
    enrollmentRunningRef.current = false
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
              <SelectValue placeholder="เลือกกล้อง" className="min-w-0" />
            </SelectTrigger>
            <SelectContent>
              {camera.devices.map((d, i) => (
                <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
                  {d.label ? cleanDeviceLabel(d.label) : `กล้อง ${i + 1}`}
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
                    : shotsCollected > 0
                      ? `กำลังถ่ายภาพ ${shotsCollected}/${ENROLLMENT_SHOT_COUNT}`
                      : 'ตรวจพบใบหน้า กำลังเตรียมถ่ายภาพ...'}
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
              {shotsCollected > 0 ? 'อยู่นิ่ง ๆ จนกว่าจะถ่ายครบ' : 'มองตรงเข้ากล้อง'}
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
              <Button onClick={handleCapture} disabled={!faceDetected || shotsCollected > 0} className="gap-1.5">
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
