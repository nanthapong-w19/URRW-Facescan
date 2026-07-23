import { rowToMember, rowToMeetingCheckin } from './store'
import type {
  Member,
  MemberRow,
  CheckinRecord,
  CheckinChangeRow,
  MeetingCheckin,
  MeetingCheckinRow,
} from './types'

// Turns a Supabase Realtime postgres_changes payload into a state update,
// without hitting the database again. Kept as plain, dependency-free
// functions (no Supabase client, no React) so each one is a direct
// input-in/output-out unit — the useAppData/MeetingDetail effects that call
// these are just wiring the result into React state, not logic to test.

export interface RealtimeChange<TRow> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: TRow | Record<string, never>
  old: Partial<TRow>
}

function upsertById<T extends { id: string }>(list: T[], next: T, prepend: boolean): T[] {
  const index = list.findIndex((item) => item.id === next.id)
  if (index === -1) return prepend ? [next, ...list] : [...list, next]
  const copy = list.slice()
  copy[index] = next
  return copy
}

function removeById<T extends { id: string }>(list: T[], id: string | undefined): T[] {
  if (!id) return list
  return list.filter((item) => item.id !== id)
}

// facein_members — new rows go to the front, matching getMembers()'s own
// `order('created_at', { ascending: false })`.
export function applyMemberEvent(members: Member[], event: RealtimeChange<MemberRow>): Member[] {
  if (event.eventType === 'DELETE') return removeById(members, event.old.id)
  return upsertById(members, rowToMember(event.new as MemberRow), true)
}

// facein_checkins — the raw realtime row only has `member_id`, not the
// joined name/department getCheckins() normally adds via a PostgREST
// select; resolved here from the already-loaded `members` list instead of
// an extra round trip. Falls back the same way rowToCheckin (store.ts)
// does when a member can't be found — e.g. a race with that member's own
// INSERT event arriving a beat later.
export function applyCheckinEvent(
  checkins: CheckinRecord[],
  event: RealtimeChange<CheckinChangeRow>,
  members: Member[]
): CheckinRecord[] {
  if (event.eventType === 'DELETE') return removeById(checkins, event.old.id)
  const row = event.new as CheckinChangeRow
  const member = members.find((m) => m.id === row.member_id)
  const next: CheckinRecord = {
    id: row.id,
    memberId: row.member_id,
    name: member?.name ?? 'ไม่ทราบชื่อ',
    department: member?.department ?? '',
    position: member?.position ?? '',
    time: row.checked_in_at,
    method: row.method,
    confidence: row.confidence ?? undefined,
  }
  return upsertById(checkins, next, true)
}

// facein_meeting_checkins — no join to resolve; the raw row already has
// everything MeetingCheckin needs, so this is a straight row->domain map.
export function applyMeetingCheckinEvent(
  checkins: MeetingCheckin[],
  event: RealtimeChange<MeetingCheckinRow>
): MeetingCheckin[] {
  if (event.eventType === 'DELETE') return removeById(checkins, event.old.id)
  return upsertById(checkins, rowToMeetingCheckin(event.new as MeetingCheckinRow), false)
}
