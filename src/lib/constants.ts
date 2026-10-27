// Fixed meeting-room list (unlike free text) — mirrors the DEPARTMENTS
// pattern in MemberList.tsx. Shared between CreateMeeting.tsx (choosing a
// room for a new meeting) and MeetingDetail.tsx (editing one after the
// fact) so both stay in sync with exactly one canonical list — add a new
// room here and it shows up in both places.
export const MEETING_ROOMS = ['ห้องประชุมบัวหลวง', 'ห้องประชุมบัวฉัตร', 'ห้องประชุมบัวแดง']

// The hidden system account's employee ID. Logging in with it starts a
// 'superadmin' session (see lib/adminAuth.tsx) instead of a plain admin
// one; it's also kept off every member picker (CreateMeeting.tsx, the
// teacher-vote candidate list) since it isn't a real person.
export const SUPERADMIN_EMPLOYEE_ID = 'superurrwnm'
