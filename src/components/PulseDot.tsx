import { cn } from '@/lib/utils'

export interface PulseDotProps {
  size?: 'sm' | 'md'
  className?: string
}

// The ping+solid emerald dot used by every "live/realtime" indicator in the
// app (Dashboard, MeetingSummary, MeetingDetail, Navbar) — each of those kept
// its own label text and outer wrapper (Badge, plain span, div), which still
// differ enough to stay page-specific, but the dot markup itself was
// byte-for-byte identical in all four.
export function PulseDot({ size = 'sm', className }: PulseDotProps) {
  const dim = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'
  return (
    <span className={cn('relative flex', dim, className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className={cn('relative inline-flex rounded-full bg-emerald-500', dim)} />
    </span>
  )
}
