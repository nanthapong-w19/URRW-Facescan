import * as React from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface SearchInputProps extends React.ComponentProps<typeof Input> {
  containerClassName?: string
}

// The "Search icon absolutely positioned inside a relative wrapper, Input
// with ps-8" pattern was hand-rolled identically in MemberList, CreateMeeting,
// and FaceScanner's manual-checkin search. MeetingDetail's ManualMeetingCheckin
// has its own bespoke variant (smaller icon, fullscreen kiosk theming on both
// icon and input) left as-is — different enough that forcing it in here would
// mean more prop knobs than the shared markup is worth.
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, containerClassName, ...props }, ref) => (
    <div className={cn("relative", containerClassName)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input ref={ref} className={cn("ps-8", className)} {...props} />
    </div>
  )
)
SearchInput.displayName = "SearchInput"

export { SearchInput }
