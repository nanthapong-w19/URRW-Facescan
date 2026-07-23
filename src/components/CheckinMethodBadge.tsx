import { CircleCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { CheckinMethod } from '@/lib/types'

export interface CheckinMethodBadgeProps {
  method: CheckinMethod
  // Dashboard's manual label ("เช็คอินด้วยตนเอง") and MeetingSummary's
  // ("เช็คอินด้วยรหัส") were already slightly different wordings for the same
  // 'manual' case before this was extracted — kept as an override instead of
  // silently unifying the copy.
  manualLabel?: string
  className?: string
}

export function CheckinMethodBadge({ method, manualLabel = 'เช็คอินด้วยตนเอง', className }: CheckinMethodBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border-none text-xs font-normal',
        method === 'face' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        className
      )}
    >
      <CircleCheck className="h-3 w-3" />
      {method === 'face' ? 'สแกนใบหน้า' : manualLabel}
    </Badge>
  )
}
