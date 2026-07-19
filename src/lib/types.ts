export type FaceStatus = 'registered' | 'unregistered'

// Access role — currently just descriptive data (this app has no login/auth,
// so a "role" doesn't gate anything yet), but modeled as a real union type
// rather than a free string since the value space is fixed at exactly these two.
export type MemberRole = 'admin' | 'user'

export interface Member {
  id: string
  employeeId: string
  name: string
  email: string
  department: string // กลุ่มสาระการเรียนรู้ (learning-area/subject group)
  position: string // ตำแหน่ง (job position/rank, e.g. ครู, ครูอัตราจ้าง, ผู้อำนวยการ)
  role: MemberRole
  faceStatus: FaceStatus
  faceDescriptor: number[] | null
  photo: string | null // data URL captured during registration
  createdAt: string
}

export type CheckinMethod = 'face' | 'manual'

export interface CheckinRecord {
  id: string
  memberId: string
  name: string
  department: string
  time: string // ISO timestamp
  method: CheckinMethod
  confidence?: number // similarity score for face match (0-1)
}

export interface AppData {
  members: Member[]
  checkins: CheckinRecord[]
}

// Shape of a row in the `facein_members` Postgres table (snake_case, as
// Supabase/PostgREST returns it) before it's mapped to the app-facing
// `Member` shape above.
export interface MemberRow {
  id: string
  employee_id: string
  name: string
  email: string | null
  department: string
  position: string
  role: MemberRole
  photo_url: string | null
  face_descriptor: number[] | null
  registered_at: string | null
  created_at: string
  updated_at: string
}

// Shape of a row in `facein_checkins`, joined with the member's name/department
// so the dashboard's recent-activity feed doesn't need a second round trip.
export interface CheckinRow {
  id: string
  member_id: string
  checked_in_at: string
  method: CheckinMethod
  confidence: number | null
  facein_members: { name: string; department: string } | null
}

// A meeting created by an admin (after face-login), with a chosen list of
// participants drawn from the member roster. This app has no real
// authentication system — see MemberRole above — so "created by an admin"
// here just means the member who was matched during face-login on
// /login, recorded for display purposes only.
export interface MeetingParticipant {
  memberId: string
  employeeId: string
  name: string
  department: string
  position: string
  // Needed for the per-meeting face-check-in scanner on MeetingDetail.tsx to
  // match a scanned face against only this meeting's invitees, not the
  // whole roster. null if this participant never registered a face.
  faceDescriptor: number[] | null
}

export interface Meeting {
  id: string
  title: string
  description: string
  meetingTime: string | null // ISO timestamp, optional
  location: string
  createdByName: string
  createdAt: string
  participants: MeetingParticipant[]
  // Count of participants who have checked into THIS meeting (via
  // facein_meeting_checkins) — used to show an attendance rate
  // (checkedInCount / participants.length) on the meetings list. Computed
  // from a lightweight count-only query in getMeetings(); getMeeting()
  // leaves this at 0 since MeetingDetail.tsx tracks live check-in state
  // itself instead of relying on this snapshot value.
  checkedInCount: number
}

// Shape of a row in `facein_meetings` (snake_case, as PostgREST returns it).
export interface MeetingRow {
  id: string
  title: string
  description: string | null
  meeting_time: string | null
  location: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
}

// Shape of a row in `facein_meeting_participants`, joined with the
// participant's member record so the meeting overview page doesn't need a
// second round trip to show names/departments/face descriptors.
export interface MeetingParticipantRow {
  id: string
  meeting_id: string
  member_id: string
  facein_members: {
    id: string
    name: string
    department: string
    position: string
    employee_id: string
    face_descriptor: number[] | null
  } | null
}

// A single participant's check-in to one specific meeting — distinct from
// the daily kiosk check-ins in `facein_checkins`/CheckinRecord above, since
// someone can check into a meeting on a day they've already (or haven't
// yet) done their daily check-in.
export interface MeetingCheckin {
  id: string
  meetingId: string
  memberId: string
  checkedInAt: string
  method: CheckinMethod
  confidence?: number
}

// Shape of a row in `facein_meeting_checkins`.
export interface MeetingCheckinRow {
  id: string
  meeting_id: string
  member_id: string
  checked_in_at: string
  method: CheckinMethod
  confidence: number | null
}
