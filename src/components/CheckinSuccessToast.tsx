import { CheckCircle2 } from 'lucide-react'

export interface CheckinSuccessToastProps {
  name: string
  department?: string
  position?: string
  method?: 'face' | 'manual'
  durationMs?: number
}

// Rich toast.custom() content for FaceScanner's check-in success — replaces
// the plain toast.success() string so successful check-ins get the same
// polished treatment as the in-frame flash overlay (name, position,
// department, a progress bar timed to the toast's own duration) instead of
// one line of text.
export function CheckinSuccessToast({ name, department, position, method = 'face', durationMs = 3500 }: CheckinSuccessToastProps) {
  const subtitle = [position, department].filter(Boolean).join(' · ')
  return (
    <div className="flex w-[320px] flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card text-card-foreground shadow-soft animate-in fade-in zoom-in-95">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-primary">เช็คอินสำเร็จ</p>
          <p className="truncate text-sm font-medium">{name}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {method === 'manual' && (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
            Manual
          </span>
        )}
      </div>
      <div className="h-1 w-full bg-secondary">
        <div
          className="h-full origin-left animate-toast-progress bg-accent"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </div>
  )
}
