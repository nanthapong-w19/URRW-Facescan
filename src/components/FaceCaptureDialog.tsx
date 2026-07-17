import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScanFace, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react'
import { loadFaceModels, detectFaceWithDescriptor } from '@/lib/faceEngine'
import { cn } from '@/lib/utils'

interface FaceCaptureDialogProps {
  open: boolean
  memberName: string
  onOpenChange: (open: boolean) => void
  onCaptured: (descriptor: number[], photo: string) => void
}

type Stage = 'loading-models' | 'camera-error' | 'scanning' | 'captured'

export default function FaceCaptureDialog({ open, memberName, onOpenChange, onCaptured }: FaceCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const [stage, setStage] = useState<Stage>('loading-models')
  const [errorMsg, setErrorMsg] = useState('')
  const [captured, setCaptured] = useState<{ descriptor: number[]; photo: string } | null>(null)
  const [faceDetected, setFaceDetected] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStage('loading-models')
    setCaptured(null)
    setErrorMsg('')

    async function start() {
      try {
        await loadFaceModels()
      } catch {
        if (!cancelled) {
          setErrorMsg(
            'ไม่สามารถโหลดโมเดลตรวจจับใบหน้าได้ (อาจเกิดจากข้อจำกัดเครือข่ายในหน้าตัวอย่างนี้) กรุณารันโปรเจกต์นี้ภายนอกเพื่อใช้งานกล้องจริง หรือใช้การเช็คอินแบบ Manual แทน'
          )
          setStage('camera-error')
        }
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStage('scanning')
        detectLoop()
      } catch {
        if (!cancelled) {
          setErrorMsg('ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการใช้งานกล้อง หรือใช้เบราว์เซอร์ที่รองรับ')
          setStage('camera-error')
        }
      }
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [open])

  function detectLoop() {
    async function tick() {
      const video = videoRef.current
      if (!video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      try {
        const result = await detectFaceWithDescriptor(video)
        setFaceDetected(!!result)
        drawBox(result?.box ?? null)
      } catch {
        // keep looping silently; transient detection errors are common
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function drawBox(box: { x: number; y: number; width: number; height: number } | null) {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (box) {
      ctx.strokeStyle = '#14b8a6'
      ctx.lineWidth = 3
      ctx.strokeRect(box.x, box.y, box.width, box.height)
    }
  }

  async function handleCapture() {
    const video = videoRef.current
    if (!video) return
    const result = await detectFaceWithDescriptor(video)
    if (!result) {
      setErrorMsg('ไม่พบใบหน้าในเฟรมนี้ กรุณาจัดใบหน้าให้อยู่ตรงกลางกล้องแล้วลองใหม่')
      return
    }
    const snapCanvas = document.createElement('canvas')
    snapCanvas.width = video.videoWidth
    snapCanvas.height = video.videoHeight
    const ctx = snapCanvas.getContext('2d')
    ctx?.drawImage(video, 0, 0)
    const photo = snapCanvas.toDataURL('image/jpeg', 0.85)
    setCaptured({ descriptor: Array.from(result.descriptor), photo })
    setStage('captured')
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  function handleConfirm() {
    if (!captured) return
    onCaptured(captured.descriptor, captured.photo)
    onOpenChange(false)
  }

  function handleRetake() {
    setCaptured(null)
    setStage('loading-models')
    onOpenChange(true)
    // Re-trigger effect by toggling open externally is complex; simplest: restart manually
    ;(async () => {
      try {
        await loadFaceModels()
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStage('scanning')
        detectLoop()
      } catch {
        setStage('camera-error')
      }
    })()
  }

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

        <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
          {stage === 'loading-models' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">กำลังเตรียมกล้องและโมเดล...</p>
            </div>
          )}

          {stage === 'camera-error' && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-white/80">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <p className="text-xs leading-relaxed">{errorMsg}</p>
            </div>
          )}

          {(stage === 'scanning' || stage === 'captured') && (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                className={cn('h-full w-full object-cover -scale-x-100', stage === 'captured' && captured && 'hidden')}
              />
              {captured && stage === 'captured' && (
                <img src={captured.photo} className="h-full w-full -scale-x-100 object-cover" alt="ใบหน้าที่บันทึก" />
              )}
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100" />
              {stage === 'scanning' && (
                <div
                  className={cn(
                    'absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium backdrop-blur',
                    faceDetected ? 'bg-emerald-500/90 text-white' : 'bg-black/50 text-white/80'
                  )}
                >
                  {faceDetected ? 'ตรวจพบใบหน้า พร้อมถ่ายภาพ' : 'กำลังค้นหาใบหน้า...'}
                </div>
              )}
              {stage === 'captured' && (
                <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-medium text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" /> บันทึกใบหน้าแล้ว
                </div>
              )}
            </>
          )}
        </div>

        {errorMsg && stage === 'scanning' && (
          <p className="text-center text-xs text-destructive">{errorMsg}</p>
        )}

        <DialogFooter className="gap-2 sm:justify-center">
          {stage === 'scanning' && (
            <Button onClick={handleCapture} disabled={!faceDetected} className="gap-1.5">
              <ScanFace className="h-4 w-4" /> ถ่ายภาพและบันทึก
            </Button>
          )}
          {stage === 'captured' && (
            <>
              <Button variant="outline" onClick={handleRetake} className="gap-1.5">
                <RotateCcw className="h-4 w-4" /> ถ่ายใหม่
              </Button>
              <Button onClick={handleConfirm} className="gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> ยืนยันการลงทะเบียน
              </Button>
            </>
          )}
          {stage === 'camera-error' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              ปิดหน้าต่าง
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
