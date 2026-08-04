import { cn } from '@/lib/utils'

export interface ScanFrameOverlayProps {
  active: boolean
  className?: string
}

// Decorative viewfinder framing for a face-scan camera view — four gold
// corner brackets (the familiar "align your face here" cue from phone
// Face ID / QR scanners) plus a slow scanning-line sweep while the camera
// is actively looking for a face. Shared by FaceScanner.tsx and
// MeetingScanner.tsx, both of which already render their own match-box +
// label directly on the canvas (see useCameraStream's paint loop) — this
// is purely an ambient frame around that, never touches the canvas itself.
export function ScanFrameOverlay({ active, className }: ScanFrameOverlayProps) {
  const corner = 'absolute h-7 w-7 border-accent/85 drop-shadow-[0_0_6px_hsl(var(--accent)/0.55)] sm:h-9 sm:w-9'
  return (
    <div className={cn('pointer-events-none absolute inset-3 sm:inset-4', className)} aria-hidden>
      <div className={cn(corner, 'left-0 top-0 rounded-tl-xl border-l-[3px] border-t-[3px]')} />
      <div className={cn(corner, 'right-0 top-0 rounded-tr-xl border-r-[3px] border-t-[3px]')} />
      <div className={cn(corner, 'bottom-0 left-0 rounded-bl-xl border-b-[3px] border-l-[3px]')} />
      <div className={cn(corner, 'bottom-0 right-0 rounded-br-xl border-b-[3px] border-r-[3px]')} />
      {active && (
        <div className="absolute inset-0 overflow-hidden rounded-xl">
          <div className="animate-scan-line absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-accent/50 to-transparent" />
        </div>
      )}
    </div>
  )
}
