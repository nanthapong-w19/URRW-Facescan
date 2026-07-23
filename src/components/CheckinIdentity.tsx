import { CheckCircle2 } from 'lucide-react'
import { InitialsAvatar } from '@/components/ui/initials-avatar'
import { cn } from '@/lib/utils'

export interface CheckinIdentityProps {
  name: string
  position?: string
  department?: string
  photo?: string | null
  avatarVariant?: 'solid' | 'soft' | 'muted'
  // Emerald ring around the avatar for the newest entry — MeetingSummary's
  // recentCheckins style.
  highlightRing?: boolean
  // Small check badge on the avatar's corner instead of a ring — MeetingDetail's
  // recentScans style. Mutually exclusive with highlightRing in practice (no
  // caller uses both), but nothing stops combining them.
  checkOverlay?: boolean
  // Light-on-dark kiosk theming for the checkOverlay background/subtitle
  // color — only meaningful when this row renders inside MeetingDetail's
  // fullscreen mode.
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
  highlightRing = false,
  checkOverlay = false,
  theme = 'default',
  subtitleSuffix,
}: CheckinIdentityProps) {
  const subtitleBase = [position, department].filter(Boolean).join(' · ')
  const subtitle = subtitleSuffix
    ? `${subtitleBase}${subtitleBase ? ' · ' : ''}${subtitleSuffix}`
    : subtitleBase
  const isFullscreen = theme === 'fullscreen'

  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <InitialsAvatar
        name={name}
        photo={photo}
        variant={avatarVariant}
        className={cn(highlightRing && 'ring-2 ring-emerald-500/60')}
      >
        {checkOverlay && (
          <CheckCircle2
            className={cn(
              'absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full text-emerald-500',
              isFullscreen ? 'bg-white' : 'bg-card'
            )}
          />
        )}
      </InitialsAvatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className={cn('truncate text-xs', isFullscreen ? 'text-slate-500' : 'text-muted-foreground')}>
          {subtitle}
        </p>
      </div>
    </div>
  )
}
