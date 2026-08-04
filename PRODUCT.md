# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff and teachers ("บุคลากร/ครู") of ศูนย์ทัศนราชกัญญาราชวิทยาลัย นครราชสีมา — an internal
organization tool, not used by students or outside visitors. Members carry one of three
roles: `admin` (full meeting management), `viewer` (read-only meeting access), and `user`
(roster entry only, no login access).

## Product Purpose

FaceIn tracks attendance at internal meetings. An admin/viewer logs in (face-scan or manual
employee-ID), creates a meeting with a chosen list of participants from the member roster,
and each participant checks into that specific meeting via face-scan or manual entry.
Success is an accurate, tamper-resistant attendance record without a sign-in sheet.

## Positioning

Face-scan check-in exists specifically to prevent proxy attendance (one person signing in for
another) and to be faster than a paper sign-in sheet or form — this is the reason face
recognition was chosen over simpler alternatives, not a secondary nicety.

## Operating Context

Runs as a kiosk-style screen for face-scan check-in as well as on regular staff phones/tablets
for manual entry — devices span a fixed kiosk display down to handheld mobile, all in daily
use around meetings at the organization.

## Capabilities and Constraints

- Face descriptor matching (face-api.js) against a registered member roster, with manual
  employee-ID entry as the fallback/alternative on every check-in and login surface.
- Two distinct check-in scopes: a daily kiosk check-in (`facein_checkins`) and a per-meeting
  check-in (`facein_meeting_checkins`) — the same person can check into both independently.
- No real authentication or authorization system: Supabase RLS is fully open
  (`for all to anon using (true) with check (true)`) on every table. `MemberRole` and the
  client-side admin session are a UX convenience gate for the intended kiosk/admin workflow,
  not a security boundary. Do not present role checks as access control in copy or design.
- Thai is the primary interface language; expect Thai copy throughout, not just labels.

## Brand Commitments

- Product name "FaceIn," rendered as a stylized wordmark on the login screen.
- Organization crest at `/logo.png` ("ตราสัญลักษณ์ศูนย์ทัศนราชกัญญาราชวิทยาลัย นครราชสีมา") —
  keep as-is, do not swap or redraw.

## Evidence on Hand

No user testimonials, case studies, or usage metrics on hand — do not fabricate any for
marketing-style copy. This is an internal operational tool, not a marketed product.

## Product Principles

1. Prevent proxy attendance and minimize check-in friction — the two reasons face-scan exists
   over a sign-in sheet; any check-in flow change should serve one of these.
2. Never imply the app has real authentication/authorization — role gates are UX convenience
   only, per the open RLS constraint above.
3. Work across the full device range in daily use: fixed kiosk display, staff phones, and
   tablets — do not design or fix only for one form factor.
4. Thai-first content and copy; preserve existing organization branding (name, wordmark,
   crest) rather than replacing it.

## Accessibility & Inclusion

No formally required standard confirmed. Keep existing a11y practices already present in the
codebase (labeled controls, screen-reader landmarks, `prefers-reduced-motion` handling) intact
when touching a surface.
