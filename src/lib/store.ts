import { supabase } from './supabaseClient'
import type {
  Member,
  CheckinRecord,
  CheckinMethod,
  MemberRow,
  CheckinRow,
  MemberRole,
  Meeting,
  MeetingRow,
  MeetingParticipantRow,
  MeetingCheckin,
  MeetingCheckinRow,
} from './types'

// Data layer for the app — backed by Supabase (Postgres) instead of
// localStorage, so every kiosk device reads and writes the same shared
// member roster and check-in history in real time. All functions here are
// async network calls; `src/hooks/useAppData.ts` is what wraps them with
// React state + a Realtime subscription for "live" UI updates.
//
// Member/CheckinRecord (camelCase) is the shape the rest of the app already
// uses; MemberRow/CheckinRow (snake_case) is what Postgres/PostgREST
// actually returns. The mapping happens only in this file so no component
// had to change its field names during the migration off localStorage.

const CHECKINS_FETCH_LIMIT = 500 // recent-history window; plenty for a live feed + today's stats

// Exported so src/lib/realtimeSync.ts can reuse the exact same row->domain
// mapping when patching state from a Realtime event, instead of duplicating
// it — row-shape knowledge stays in this one file either way.
export function rowToMember(row: MemberRow): Member {
  return {
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    department: row.department,
    position: row.position ?? '',
    role: row.role === 'admin' ? 'admin' : 'user',
    faceStatus: row.face_descriptor ? 'registered' : 'unregistered',
    faceDescriptor: row.face_descriptor ?? null,
    // Not present on the lean select getMembers() below uses — `?? null`
    // here means "not fetched" and "fetched as NULL" both resolve to the
    // same `null`, which is what every caller of Member.photo already
    // treats as "no photo, fall back to initials" (see MemberList.tsx).
    photo: row.photo_url ?? null,
    createdAt: row.created_at,
  }
}

function rowToCheckin(row: CheckinRow): CheckinRecord {
  return {
    id: row.id,
    memberId: row.member_id,
    name: row.facein_members?.name ?? 'ไม่ทราบชื่อ',
    department: row.facein_members?.department ?? '',
    time: row.checked_in_at,
    method: row.method,
    confidence: row.confidence ?? undefined,
  }
}

/**
 * Friendlier Thai messages for the Postgres/PostgREST errors this app can
 * actually hit.
 *
 * IMPORTANT: the `error` object supabase-js returns from a query (a
 * PostgrestError) is a plain object, NOT an `instanceof Error` — so the old
 * `err instanceof Error ? err.message : String(err)` fell through to
 * `String(err)` for every real database error, which for a plain object
 * just gives the useless literal string "[object Object]". That completely
 * hid the actual reason a query failed (RLS denial, missing column, bad
 * relationship, etc.) behind "เกิดข้อผิดพลาดในการบันทึกข้อมูล: [object Object]".
 * Pull `.message`/`.details`/`.hint`/`.code` off the error object directly
 * instead of blindly stringifying it.
 */
function describeDbError(err: unknown): string {
  let message: string
  if (err instanceof Error) {
    message = err.message
  } else if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    if (typeof e.message === 'string' && e.message) {
      message = e.message
    } else if (typeof e.details === 'string' && e.details) {
      message = e.details
    } else if (typeof e.hint === 'string' && e.hint) {
      message = e.hint
    } else {
      try {
        message = JSON.stringify(err)
      } catch {
        message = String(err)
      }
    }
    if (typeof e.code === 'string' && e.code && !message.includes(e.code)) {
      message = `${message} (${e.code})`
    }
  } else {
    message = String(err)
  }

  if (message.includes('duplicate key value') || message.includes('facein_members_employee_id_key')) {
    return 'รหัสพนักงานนี้มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น'
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
  }
  return `เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${message}`
}

// Columns for the shared roster query behind useAppData() — every field
// EXCEPT photo_url. Members register a face as a full-resolution base64
// JPEG (see FaceCaptureDialog.tsx), measured at ~60-120KB per member versus
// ~1KB for face_descriptor — by far the heaviest thing this table holds.
// useAppData is consumed by five pages, only one of which (MemberList.tsx)
// ever displays a photo, so it's fetched there instead, on demand, via
// getMemberPhotos() below — see the "column trimming" decision in the
// architecture-review grilling session for the numbers behind this split.
const MEMBER_COLUMNS =
  'id, employee_id, name, email, department, position, role, face_descriptor, registered_at, created_at, updated_at'

export async function getMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('facein_members')
    .select(MEMBER_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(describeDbError(error))
  return (data as unknown as MemberRow[]).map(rowToMember)
}

// Photos only — used by MemberList.tsx to render avatars, decoupled from
// the shared lean roster query above. Not realtime-synced: a photo added
// from a different kiosk while this page is open won't appear until it's
// reloaded (acceptable trade-off — the member's faceStatus badge itself
// still updates live via useAppData, only the thumbnail lags).
export async function getMemberPhotos(): Promise<Record<string, string | null>> {
  const { data, error } = await supabase.from('facein_members').select('id, photo_url')
  if (error) throw new Error(describeDbError(error))
  const photos: Record<string, string | null> = {}
  for (const row of data as { id: string; photo_url: string | null }[]) {
    photos[row.id] = row.photo_url
  }
  return photos
}

export async function getCheckins(): Promise<CheckinRecord[]> {
  const { data, error } = await supabase
    .from('facein_checkins')
    .select('*, facein_members(name, department)')
    .order('checked_in_at', { ascending: false })
    .limit(CHECKINS_FETCH_LIMIT)
  if (error) throw new Error(describeDbError(error))
  return (data as unknown as CheckinRow[]).map(rowToCheckin)
}

export async function addMember(input: {
  employeeId: string
  name: string
  department: string
  position: string
  role: MemberRole
}): Promise<Member> {
  const { data, error } = await supabase
    .from('facein_members')
    .insert({
      employee_id: input.employeeId,
      name: input.name,
      department: input.department,
      position: input.position,
      role: input.role,
    })
    .select('*')
    .single()
  if (error) throw new Error(describeDbError(error))
  return rowToMember(data as MemberRow)
}

export async function updateMember(
  id: string,
  patch: Partial<Pick<Member, 'employeeId' | 'name' | 'department' | 'position' | 'role'>>
): Promise<Member> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.employeeId !== undefined) dbPatch.employee_id = patch.employeeId
  if (patch.name !== undefined) dbPatch.name = patch.name
  if (patch.department !== undefined) dbPatch.department = patch.department
  if (patch.position !== undefined) dbPatch.position = patch.position
  if (patch.role !== undefined) dbPatch.role = patch.role

  const { data, error } = await supabase
    .from('facein_members')
    .update(dbPatch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(describeDbError(error))
  return rowToMember(data as MemberRow)
}

export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.from('facein_members').delete().eq('id', id)
  if (error) throw new Error(describeDbError(error))
}

export async function registerFace(id: string, descriptor: number[], photo: string): Promise<Member> {
  const { data, error } = await supabase
    .from('facein_members')
    .update({ face_descriptor: descriptor, photo_url: photo, registered_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(describeDbError(error))
  return rowToMember(data as MemberRow)
}

export async function recordCheckin(
  member: Pick<Member, 'id' | 'name' | 'department'>,
  method: CheckinMethod,
  confidence?: number
): Promise<CheckinRecord> {
  const { data, error } = await supabase
    .from('facein_checkins')
    .insert({ member_id: member.id, method, confidence: confidence ?? null })
    .select('*, facein_members(name, department)')
    .single()
  if (error) throw new Error(describeDbError(error))
  return rowToCheckin(data as unknown as CheckinRow)
}

// --- Meetings ---------------------------------------------------------
// Created by an admin after face-login (see src/pages/Login.tsx). Each
// meeting has its own list of participants drawn from the member roster,
// stored in the join table `facein_meeting_participants`.

function rowToMeeting(
  row: MeetingRow,
  participantRows: MeetingParticipantRow[],
  checkinCounts: Record<string, number> = {}
): Meeting {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    meetingTime: row.meeting_time,
    location: row.location ?? '',
    createdByName: row.created_by_name ?? '',
    createdAt: row.created_at,
    participants: participantRows
      .filter((p) => p.meeting_id === row.id && p.facein_members)
      .map((p) => ({
        memberId: p.facein_members!.id,
        employeeId: p.facein_members!.employee_id,
        name: p.facein_members!.name,
        department: p.facein_members!.department,
        position: p.facein_members!.position,
        faceDescriptor: p.facein_members!.face_descriptor ?? null,
      })),
    checkedInCount: checkinCounts[row.id] ?? 0,
  }
}

// Two variants of the same join, split by how much each caller needs:
// getMeetings() (the list view) only ever reads participants.length for a
// headcount, so it skips face_descriptor — getMeeting() (the detail view)
// keeps it, since MeetingDetail's face scanner needs it to match a scanned
// face against this meeting's invitees. Kept side by side so they can't
// silently drift apart in which OTHER columns they join.
const MEETING_PARTICIPANTS_SELECT_LEAN =
  'id, meeting_id, member_id, facein_members(id, name, department, position, employee_id)'
const MEETING_PARTICIPANTS_SELECT_FULL =
  'id, meeting_id, member_id, facein_members(id, name, department, position, employee_id, face_descriptor)'

export async function getMeetings(): Promise<Meeting[]> {
  const [
    { data: meetingRows, error: meetingsErr },
    { data: participantRows, error: participantsErr },
    { data: checkinRows, error: checkinsErr },
  ] = await Promise.all([
    supabase.from('facein_meetings').select('*').order('created_at', { ascending: false }),
    supabase.from('facein_meeting_participants').select(MEETING_PARTICIPANTS_SELECT_LEAN),
    // Only the meeting_id column is needed here — this powers the
    // attendance-rate summary on the meetings list, not the full
    // check-in detail (that's fetched separately, per-meeting, by
    // getMeetingCheckins on MeetingDetail.tsx).
    supabase.from('facein_meeting_checkins').select('meeting_id'),
  ])
  if (meetingsErr) throw new Error(describeDbError(meetingsErr))
  if (participantsErr) throw new Error(describeDbError(participantsErr))
  if (checkinsErr) throw new Error(describeDbError(checkinsErr))
  const participants = (participantRows ?? []) as unknown as MeetingParticipantRow[]
  const checkinCounts: Record<string, number> = {}
  for (const row of (checkinRows ?? []) as { meeting_id: string }[]) {
    checkinCounts[row.meeting_id] = (checkinCounts[row.meeting_id] ?? 0) + 1
  }
  return (meetingRows as MeetingRow[]).map((row) => rowToMeeting(row, participants, checkinCounts))
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const [{ data: meetingRow, error: meetingErr }, { data: participantRows, error: participantsErr }] =
    await Promise.all([
      supabase.from('facein_meetings').select('*').eq('id', id).maybeSingle(),
      supabase.from('facein_meeting_participants').select(MEETING_PARTICIPANTS_SELECT_FULL).eq('meeting_id', id),
    ])
  if (meetingErr) throw new Error(describeDbError(meetingErr))
  if (participantsErr) throw new Error(describeDbError(participantsErr))
  if (!meetingRow) return null
  return rowToMeeting(meetingRow as MeetingRow, (participantRows ?? []) as unknown as MeetingParticipantRow[])
}

export async function createMeeting(input: {
  title: string
  description: string
  meetingTime: string | null
  location: string
  createdByMemberId: string
  createdByName: string
  participantIds: string[]
}): Promise<Meeting> {
  const { data: meetingRow, error: meetingErr } = await supabase
    .from('facein_meetings')
    .insert({
      title: input.title,
      description: input.description || null,
      meeting_time: input.meetingTime,
      location: input.location || null,
      created_by: input.createdByMemberId,
      created_by_name: input.createdByName,
    })
    .select('*')
    .single()
  if (meetingErr) throw new Error(describeDbError(meetingErr))

  const meeting = meetingRow as MeetingRow

  if (input.participantIds.length > 0) {
    const { error: participantsErr } = await supabase.from('facein_meeting_participants').insert(
      input.participantIds.map((memberId) => ({ meeting_id: meeting.id, member_id: memberId }))
    )
    if (participantsErr) throw new Error(describeDbError(participantsErr))
  }

  const created = await getMeeting(meeting.id)
  if (!created) throw new Error('สร้างการประชุมสำเร็จ แต่ไม่พบข้อมูลที่เพิ่งสร้าง')
  return created
}

// Used by MeetingDetail.tsx's inline click-to-edit fields (date/time,
// location, description) — partial, like updateMember, since each field is
// saved independently rather than through one big edit form.
export async function updateMeeting(
  id: string,
  patch: Partial<Pick<Meeting, 'title' | 'description' | 'meetingTime' | 'location'>>
): Promise<Meeting> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.title !== undefined) dbPatch.title = patch.title
  if (patch.description !== undefined) dbPatch.description = patch.description || null
  if (patch.meetingTime !== undefined) dbPatch.meeting_time = patch.meetingTime
  if (patch.location !== undefined) dbPatch.location = patch.location || null

  const { error } = await supabase.from('facein_meetings').update(dbPatch).eq('id', id)
  if (error) throw new Error(describeDbError(error))

  const updated = await getMeeting(id)
  if (!updated) throw new Error('แก้ไขการประชุมสำเร็จ แต่ไม่พบข้อมูลที่อัปเดต')
  return updated
}

export async function deleteMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('facein_meetings').delete().eq('id', id)
  if (error) throw new Error(describeDbError(error))
}

// --- Per-meeting check-ins ---------------------------------------------
// Tracks which invited participants have actually checked in to a specific
// meeting (via the face scanner on MeetingDetail.tsx), separate from the
// daily kiosk check-ins in facein_checkins/CheckinRecord above.

// Exported for src/lib/realtimeSync.ts — see rowToMember above for why.
export function rowToMeetingCheckin(row: MeetingCheckinRow): MeetingCheckin {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    memberId: row.member_id,
    checkedInAt: row.checked_in_at,
    method: row.method,
    confidence: row.confidence ?? undefined,
  }
}

export async function getMeetingCheckins(meetingId: string): Promise<MeetingCheckin[]> {
  const { data, error } = await supabase
    .from('facein_meeting_checkins')
    .select('*')
    .eq('meeting_id', meetingId)
  if (error) throw new Error(describeDbError(error))
  return (data as MeetingCheckinRow[]).map(rowToMeetingCheckin)
}

export async function recordMeetingCheckin(
  meetingId: string,
  memberId: string,
  method: CheckinMethod,
  confidence?: number
): Promise<MeetingCheckin> {
  const { data, error } = await supabase
    .from('facein_meeting_checkins')
    .insert({ meeting_id: meetingId, member_id: memberId, method, confidence: confidence ?? null })
    .select('*')
    .single()
  if (error) throw new Error(describeDbError(error))
  return rowToMeetingCheckin(data as MeetingCheckinRow)
}

// --- Pure helpers below: these operate on a `checkins` array that's already
// loaded in memory (via useAppData), rather than hitting the database again.
// FaceScanner.tsx calls `hasCheckedInToday` on every detection tick (twice a
// second), so it must stay a synchronous, local check rather than a query.

export function hasCheckedInToday(checkins: CheckinRecord[], memberId: string): boolean {
  const today = new Date().toDateString()
  return checkins.some((c) => c.memberId === memberId && new Date(c.time).toDateString() === today)
}

export function todaysCheckins(checkins: CheckinRecord[]): CheckinRecord[] {
  const today = new Date().toDateString()
  return checkins.filter((c) => new Date(c.time).toDateString() === today)
}
