import { describe, it, expect } from 'vitest'
import { applyMemberEvent, applyCheckinEvent, applyMeetingCheckinEvent, type RealtimeChange } from './realtimeSync'
import type { Member, CheckinRecord, MemberRow, CheckinChangeRow, MeetingCheckin, MeetingCheckinRow } from './types'

const member: Member = {
  id: 'm1',
  employeeId: 'E1',
  name: 'สมชาย ใจดี',
  department: 'ครู',
  position: '',
  role: 'user',
  faceStatus: 'registered',
  faceDescriptor: [0, 0, 0],
  photo: null,
  createdAt: '2026-01-01T00:00:00Z',
}

const memberRow: MemberRow = {
  id: 'm2',
  employee_id: 'E2',
  name: 'สมหญิง ดีใจ',
  email: null,
  department: 'คณิตศาสตร์',
  position: '',
  role: 'user',
  photo_url: null,
  face_descriptor: null,
  registered_at: null,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

describe('applyMemberEvent', () => {
  it('prepends a new member on INSERT', () => {
    const event: RealtimeChange<MemberRow> = { eventType: 'INSERT', new: memberRow, old: {} }
    expect(applyMemberEvent([member], event)).toEqual([
      {
        ...member,
        id: 'm2',
        employeeId: 'E2',
        name: 'สมหญิง ดีใจ',
        department: 'คณิตศาสตร์',
        faceDescriptor: null,
        faceStatus: 'unregistered',
        createdAt: memberRow.created_at,
      },
      member,
    ])
  })

  it('updates the matching member in place on UPDATE', () => {
    const updatedRow: MemberRow = { ...memberRow, id: 'm1', name: 'สมชาย ใจดี (แก้ไข)' }
    const event: RealtimeChange<MemberRow> = { eventType: 'UPDATE', new: updatedRow, old: {} }
    const result = applyMemberEvent([member], event)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('สมชาย ใจดี (แก้ไข)')
  })

  it('removes the member on DELETE', () => {
    const event: RealtimeChange<MemberRow> = { eventType: 'DELETE', new: {}, old: { id: 'm1' } }
    expect(applyMemberEvent([member], event)).toEqual([])
  })
})

describe('applyCheckinEvent', () => {
  const checkinRow: CheckinChangeRow = {
    id: 'c1',
    member_id: 'm1',
    checked_in_at: '2026-01-03T09:00:00Z',
    method: 'face',
    confidence: 0.9,
  }

  it('resolves name/department from the already-loaded members list on INSERT', () => {
    const event: RealtimeChange<CheckinChangeRow> = { eventType: 'INSERT', new: checkinRow, old: {} }
    const result = applyCheckinEvent([], event, [member])
    expect(result).toEqual([
      {
        id: 'c1',
        memberId: 'm1',
        name: 'สมชาย ใจดี',
        department: 'ครู',
        position: '',
        time: '2026-01-03T09:00:00Z',
        method: 'face',
        confidence: 0.9,
      },
    ])
  })

  it('falls back to a placeholder name when the member cannot be found (race with that member\'s own INSERT)', () => {
    const event: RealtimeChange<CheckinChangeRow> = { eventType: 'INSERT', new: checkinRow, old: {} }
    const result = applyCheckinEvent([], event, [])
    expect(result[0].name).toBe('ไม่ทราบชื่อ')
  })

  it('removes the checkin on DELETE', () => {
    const existing: CheckinRecord = {
      id: 'c1',
      memberId: 'm1',
      name: 'สมชาย ใจดี',
      department: 'ครู',
      position: '',
      time: '2026-01-03T09:00:00Z',
      method: 'face',
    }
    const event: RealtimeChange<CheckinChangeRow> = { eventType: 'DELETE', new: {}, old: { id: 'c1' } }
    expect(applyCheckinEvent([existing], event, [member])).toEqual([])
  })
})

describe('applyMeetingCheckinEvent', () => {
  const row: MeetingCheckinRow = {
    id: 'mc1',
    meeting_id: 'meet1',
    member_id: 'm1',
    checked_in_at: '2026-01-03T09:00:00Z',
    method: 'manual',
    confidence: null,
    photo_url: null,
  }

  it('appends a new meeting checkin on INSERT (not prepended, unlike member/checkin events)', () => {
    const event: RealtimeChange<MeetingCheckinRow> = { eventType: 'INSERT', new: row, old: {} }
    const existing: MeetingCheckin = {
      id: 'mc0',
      meetingId: 'meet1',
      memberId: 'm0',
      checkedInAt: '2026-01-03T08:00:00Z',
      method: 'manual',
    }
    const result = applyMeetingCheckinEvent([existing], event)
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe('mc1')
  })

  it('removes the meeting checkin on DELETE', () => {
    const event: RealtimeChange<MeetingCheckinRow> = { eventType: 'DELETE', new: {}, old: { id: 'mc1' } }
    const existing: MeetingCheckin = {
      id: 'mc1',
      meetingId: 'meet1',
      memberId: 'm1',
      checkedInAt: '2026-01-03T09:00:00Z',
      method: 'manual',
    }
    expect(applyMeetingCheckinEvent([existing], event)).toEqual([])
  })
})
