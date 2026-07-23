import { MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

// Same bg-{color}-500/10 + text-{color}-700/dark:text-{color}-400 pairing
// StatBadge uses elsewhere in the app — kept separate (rather than reusing
// StatBadge/badgeVariants) because this needs a color *per room name*,
// picked automatically, not a fixed small variant set.
const ROOM_COLORS = [
  'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  'bg-amber-500/10 text-amber-800 dark:text-amber-400',
  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
]

// Deterministic (not indexed off MEETING_ROOMS) so the color a room gets
// stays stable even if rooms are reordered/added in constants.ts, and so
// legacy meetings with a room name no longer in that list still get a
// consistent color instead of falling back to one default look.
function roomColorClass(room: string): string {
  let hash = 0
  for (let i = 0; i < room.length; i++) {
    hash = (hash * 31 + room.charCodeAt(i)) | 0
  }
  return ROOM_COLORS[Math.abs(hash) % ROOM_COLORS.length]
}

export interface MeetingRoomBadgeProps {
  room: string | null | undefined
  className?: string
}

// Color-coded chip for a meeting room name, used in MeetingList's cards and
// MeetingDetail's "สถานที่" tile. Renders nothing when there's no room set —
// callers don't need to guard with `meeting.location && ...` themselves.
export function MeetingRoomBadge({ room, className }: MeetingRoomBadgeProps) {
  const trimmed = room?.trim()
  if (!trimmed) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-0.5 text-xs font-medium',
        roomColorClass(trimmed),
        className
      )}
    >
      <MapPin className="h-3 w-3 shrink-0" />
      {trimmed}
    </span>
  )
}
