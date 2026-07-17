/**
 * Maps getUserMedia/DOMException failures to specific, actionable Thai
 * messages instead of one generic "cannot access camera" string — the
 * failure mode (permission denied vs. no camera vs. camera busy vs.
 * insecure context) differs a lot across Windows/Mac/iOS/Android and each
 * needs a different fix from the user.
 */
export function describeGetUserMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'เบราว์เซอร์ปฏิเสธสิทธิ์การใช้กล้อง กรุณากดไอคอนกุญแจ/กล้องที่แถบที่อยู่ (ด้านซ้ายของ URL) แล้วเปลี่ยนเป็น "อนุญาต" จากนั้นรีเฟรชหน้านี้ หรือใช้ "เช็คอินแบบ Manual" แทน'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'ไม่พบกล้องในอุปกรณ์นี้ กรุณาต่อกล้องเว็บแคม หรือใช้ "เช็คอินแบบ Manual" แทน'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'ไม่สามารถเปิดกล้องได้ อาจมีแอปอื่นกำลังใช้กล้องอยู่ (เช่น Zoom, Teams, หรือแท็บเบราว์เซอร์อื่น) กรุณาปิดแอปเหล่านั้นแล้วลองใหม่ หรือใช้ "เช็คอินแบบ Manual" แทน'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'ไม่สามารถเปิดกล้องที่เลือกได้ กำลังลองเปิดกล้องเริ่มต้นแทน...'
    case 'SecurityError':
      return 'หน้านี้ไม่ได้เปิดผ่าน https หรือ localhost จึงขอสิทธิ์กล้องไม่ได้ กรุณารันผ่าน npm run dev หรือ deploy ผ่าน https'
    case 'AbortError':
      return 'เปิดกล้องไม่สำเร็จเนื่องจากปัญหาฮาร์ดแวร์ กรุณาลองใหม่ หรือใช้ "เช็คอินแบบ Manual" แทน'
    default:
      if (!navigator.mediaDevices?.getUserMedia) {
        return 'เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับการเข้าถึงกล้องผ่านเว็บ กรุณาใช้เบราว์เซอร์รุ่นใหม่ (Chrome, Edge, Safari) หรือใช้ "เช็คอินแบบ Manual" แทน'
      }
      return 'ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตการใช้งานกล้อง หรือใช้ "เช็คอินแบบ Manual" แทน'
  }
}

/**
 * Average luminance (0-255) of a canvas, sampled on a small downscaled
 * copy for speed. Used to tell "the video pipeline is broken and painting
 * nothing" apart from "frames are arriving but the actual image content
 * is genuinely black" — the latter is an OS/driver/security-software
 * issue (e.g. a privacy blackout frame) that no client-side JS can fix,
 * so the app should say so plainly instead of implying it's a bug here.
 */
export function sampleCanvasBrightness(canvas: HTMLCanvasElement): number | null {
  if (canvas.width === 0 || canvas.height === 0) return null
  const sampleSize = 24
  const sampler = document.createElement('canvas')
  sampler.width = sampleSize
  sampler.height = sampleSize
  const ctx = sampler.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(canvas, 0, 0, sampleSize, sampleSize)
  const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize)
  let sum = 0
  const pixelCount = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  }
  return sum / pixelCount
}
