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
