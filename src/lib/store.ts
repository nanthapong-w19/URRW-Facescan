import { supabase } from './supabaseClient'
import type { Member, CheckinRecord, CheckinMethod, MemberRow, CheckinRow } from './types'

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

function rowToMember(row: MemberRow): Member {
  return {
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    email: row.email ?? '',
    department: row.department,
    faceStatus: row.face_descriptor ? 'registered' : 'unregistered',
    faceDescriptor: row.face_descriptor ?? null,
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

/** Friendlier Thai messages for the Postgres/PostgREST errors this app can actually hit. */
function describeDbError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (message.includes('duplicate key value') || message.includes('facein_members_employee_id_key')) {
    return 'รหัสพนักงานนี้มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น'
  }
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
  }
  return `เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${message}`
}

export async function getMembers(): Promise<Member[]> {
  const { data, error } = await supabase
    .from('facein_members')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(describeDbError(error))
  return (data as MemberRow[]).map(rowToMember)
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
  email: string
  department: string
}): Promise<Member> {
  const { data, error } = await supabase
    .from('facein_members')
    .insert({
      employee_id: input.employeeId,
      name: input.name,
      email: input.email,
      department: input.department,
    })
    .select('*')
    .single()
  if (error) throw new Error(describeDbError(error))
  return rowToMember(data as MemberRow)
}

export async function updateMember(
  id: string,
  patch: Partial<Pick<Member, 'employeeId' | 'name' | 'email' | 'department'>>
): Promise<Member> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.employeeId !== undefined) dbPatch.employee_id = patch.employeeId
  if (patch.name !== undefined) dbPatch.name = patch.name
  if (patch.email !== undefined) dbPatch.email = patch.email
  if (patch.department !== undefined) dbPatch.department = patch.department

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
