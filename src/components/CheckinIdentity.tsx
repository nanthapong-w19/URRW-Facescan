import { InitialsAvatar } from '@/components/ui/initials-avatar'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

export interface CheckinIdentityProps {
  name: string
  position?: string
  department?: string
  photo?: string | null
  avatarVariant?: 'solid' | 'soft' | 'muted'
  // Light-on-dark kiosk theming for the subtitle color — only meaningful
  // when this row renders inside MeetingDetail's fullscreen mode.
  theme?: 'default' | 'fullscreen'
  // MeetingDetail inlines the check-in time on the same line as the
  // subtitle ("ตำแหน่ง · กลุ่มสาระ · 09:42 น.") instead of a separate column —
  // Dashboard/MeetingSummary pass their time to a sibling element instead and
  // leave this unset.
  subtitleSuffix?: string
}

// The avatar + name + "ตำแหน่ง · กลุ่มสาระ" block shared by every recent-checkin
// list in the app (Dashboard, MeetingSummary, MeetingDetail) — each list's
// right-hand column (method badge vs inline time vs stacked time) differs
// enough to stay page-specific, but this left-hand identity block was
// duplicated near-verbatim in all three.
export function CheckinIdentity({
  name,
  position,
  department,
  photo,
  avatarVariant = 'solid',
  theme = 'default',
  subtitleSuffix,
}: CheckinIdentityProps) {
  const subtitleBase = [position, department].filter(Boolean).join(' · ')
  const subtitle = subtitleSuffix
    ? `${subtitleBase}${subtitleBase ? ' · ' : ''}${subtitleSuffix}`
    : subtitleBase
  const isFullscreen = theme === 'fullscreen'

  // A wrapping <div> (not InitialsAvatar itself) is the HoverCardTrigger's
  // asChild target — Radix's Slot attaches a ref to it to position the
  // zoomed preview, and InitialsAvatar doesn't forward one, so the trigger
  // has to be a plain element that does.
  const avatar = <InitialsAvatar name={name} photo={photo} variant={avatarVariant} />

  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      {photo ? (
        <HoverCard openDelay={150} closeDelay={0}>
          <HoverCardTrigger asChild>
            <div className="cursor-zoom-in">{avatar}</div>
          </HoverCardTrigger>
          <HoverCardContent side="top" align="start" className="w-auto border-none bg-transparent p-0 shadow-none">
            <img
              src={photo}
              alt={name}
              className="h-40 w-40 rounded-xl border border-border object-cover shadow-lift sm:h-48 sm:w-48"
            />
          </HoverCardContent>
        </HoverCard>
      ) : (
        avatar
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className={cn('truncate text-xs', isFullscreen ? 'text-slate-500' : 'text-muted-foreground')}>
          {subtitle}
        </p>
      </div>
    </div>
  )
}
