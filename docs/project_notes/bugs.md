# Bug Log

Chronological log of bugs and their solutions for face-checkin-app.

## Format

```
### YYYY-MM-DD - Brief Bug Description
- **Issue**: What went wrong
- **Root Cause**: Why it happened
- **Solution**: How it was fixed
- **Prevention**: How to avoid it in the future
```

Keep entries concise (1-3 lines each). Remove entries 6+ months old when no longer relevant.

## Entries

### 2026-07-23 - Meeting delete had no confirmation
- **Issue**: "ลบการประชุม" button in MeetingDetail called `handleDelete` directly on click — no confirm step, unlike MemberList's delete flow
- **Root Cause**: Confirmation dialog was never added when the delete button was built
- **Solution**: Extracted shared `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`), wired it in front of `handleDelete`
- **Prevention**: Any new destructive action (delete/remove) should use `ConfirmDialog`, not fire directly on click
