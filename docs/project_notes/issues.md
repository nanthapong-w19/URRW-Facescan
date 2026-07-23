# Issues / Work Log

Quick-reference work log for face-checkin-app. Not a replacement for the ticket system — link to source of truth.

## Format

```
### YYYY-MM-DD - TICKET-ID: Brief Description
- **Status**: Completed / In Progress / Blocked
- **Description**: 1-2 line summary
- **URL**: link to ticket
- **Notes**: context
```

Clean out entries 3+ months old periodically.

## Entries

### 2026-07-23 - MEMBERS-001: Hide admin/viewer roles by default on /#/members
- **Status**: Completed
- **Description**: Added show/hide toggle for admin + viewer role rows in MemberList; defaults to hidden so the table opens showing regular staff only.
- **Notes**: `src/pages/MemberList.tsx` — `showAdminViewer` state gates the role filter.

### 2026-07-23 - MEMBERS-002: Add "บุคลากรทางการศึกษา" department option
- **Status**: Completed
- **Description**: New entry in the DEPARTMENTS list (member form + filter dropdown).
- **Notes**: `src/pages/MemberList.tsx` — DEPARTMENTS is local to this file, not shared like MEETING_ROOMS in constants.ts.

### 2026-07-23 - UI-003: CSS-first logical-property pass (site-wide)
- **Status**: Completed
- **Description**: Swapped physical Tailwind utilities (`left-`, `pl-`, `mr-`, `-ml-`, `-right-`) for logical equivalents (`start-`, `ps-`, `me-`, `-ms-`, `-end-`) across app-authored pages/components; added `group-focus-within:opacity-100` to MemberList row actions for keyboard a11y.
- **Notes**: Scoped to `src/pages/` and `src/components/*.tsx`; deliberately skipped `src/components/ui/*` (vendor shadcn code). See [[decisions.md]] ADR-001.

### 2026-07-23 - UI-004: Extract shared UI components (StatBadge, EmptyState, ConfirmDialog, PageHeader, LoadingState)
- **Status**: Completed
- **Description**: Scaffolded 5 reusable components in `src/components/ui/` and wired them into the pages that had hand-rolled duplicates (MemberList, MeetingDetail, MeetingSummary, MeetingList, Dashboard, FaceScanner, CreateMeeting). Also added an `isLoading`/`icon` prop pair to the base `Button` component, replacing 3 manual spinner-vs-icon ternaries.
- **Notes**: Fixed a real gap along the way — MeetingDetail's delete button had no confirmation dialog at all (see [[bugs.md]]).

### 2026-07-23 - UI-005: Extract InitialsAvatar (photo-or-initials circle)
- **Status**: Completed
- **Description**: Found the photo-with-initials-fallback avatar block hand-rolled 8x across MemberList, Dashboard, MeetingDetail (x2), MeetingSummary (x4) with 3 slightly different color variants. Extracted `src/components/ui/initials-avatar.tsx` (`variant`: solid/soft/muted, optional `children` slot for badge overlays) and wired all 8 spots.
- **Notes**: Normalized one inconsistent detail while at it — 2 spots used `text-xs` instead of the other 6's `text-sm` for the initial letter; now all `text-sm` via the shared component.
