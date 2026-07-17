export type FaceStatus = 'registered' | 'unregistered'

export interface Member {
  id: string
  employeeId: string
  name: string
  email: string
  department: string
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
