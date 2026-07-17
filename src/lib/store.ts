import type { Member, CheckinRecord, CheckinMethod } from './types'

const MEMBERS_KEY = 'facecheckin_members_v1'
const CHECKINS_KEY = 'facecheckin_checkins_v1'

// Tiny pub/sub so pages re-render "in real time" whenever data changes,
// even across components that aren't directly connected via props.
type Listener = () => void
const listeners = new Set<Listener>()
export function subscribe(fn: Listener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() {
  listeners.forEach((fn) => fn())
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function seedMembers(): Member[] {
  const now = new Date()
  const iso = (daysAgo: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString()
  }
  return [
    {
      id: uid(),
      employeeId: 'EMP-001',
      name: 'Aran Suksawat',
      email: 'aran.s@company.com',
      department: 'Engineering',
      faceStatus: 'unregistered',
      faceDescriptor: null,
      photo: null,
      createdAt: iso(30),
    },
    {
      id: uid(),
      employeeId: 'EMP-002',
      name: 'Nichapa Wongsakul',
      email: 'nichapa.w@company.com',
      department: 'Design',
      faceStatus: 'unregistered',
      faceDescriptor: null,
      photo: null,
      createdAt: iso(28),
    },
    {
      id: uid(),
      employeeId: 'EMP-003',
      name: 'Kittipong Chai',
      email: 'kittipong.c@company.com',
      department: 'Marketing',
      faceStatus: 'unregistered',
      faceDescriptor: null,
      photo: null,
      createdAt: iso(20),
    },
    {
      id: uid(),
      employeeId: 'EMP-004',
      name: 'Suthida Ratana',
      email: 'suthida.r@company.com',
      department: 'HR',
      faceStatus: 'unregistered',
      faceDescriptor: null,
      photo: null,
      createdAt: iso(15),
    },
    {
      id: uid(),
      employeeId: 'EMP-005',
      name: 'Panupong Intharak',
      email: 'panupong.i@company.com',
      department: 'Engineering',
      faceStatus: 'unregistered',
      faceDescriptor: null,
      photo: null,
      createdAt: iso(10),
    },
    {
      id: uid(),
      employeeId: 'EMP-006',
      name: 'Waraporn Srisuk',
      email: 'waraporn.s@company.com',
      department: 'Finance',
      faceStatus: 'unregistered',
      faceDescriptor: null,
      photo: null,
      createdAt: iso(5),
    },
  ]
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function initStore() {
  if (!localStorage.getItem(MEMBERS_KEY)) {
    writeJSON(MEMBERS_KEY, seedMembers())
  }
  if (!localStorage.getItem(CHECKINS_KEY)) {
    writeJSON(CHECKINS_KEY, [])
  }
}

export function getMembers(): Member[] {
  return readJSON<Member[]>(MEMBERS_KEY, [])
}

export function getCheckins(): CheckinRecord[] {
  return readJSON<CheckinRecord[]>(CHECKINS_KEY, [])
}

export function addMember(input: {
  employeeId: string
  name: string
  email: string
  department: string
}): Member {
  const members = getMembers()
  const member: Member = {
    id: uid(),
    employeeId: input.employeeId,
    name: input.name,
    email: input.email,
    department: input.department,
    faceStatus: 'unregistered',
    faceDescriptor: null,
    photo: null,
    createdAt: new Date().toISOString(),
  }
  writeJSON(MEMBERS_KEY, [member, ...members])
  notify()
  return member
}

export function updateMember(id: string, patch: Partial<Member>) {
  const members = getMembers().map((m) => (m.id === id ? { ...m, ...patch } : m))
  writeJSON(MEMBERS_KEY, members)
  notify()
}

export function deleteMember(id: string) {
  const members = getMembers().filter((m) => m.id !== id)
  writeJSON(MEMBERS_KEY, members)
  notify()
}

export function registerFace(id: string, descriptor: number[], photo: string) {
  updateMember(id, { faceStatus: 'registered', faceDescriptor: descriptor, photo })
}

export function recordCheckin(
  member: Pick<Member, 'id' | 'name' | 'department'>,
  method: CheckinMethod,
  confidence?: number
): CheckinRecord {
  const checkins = getCheckins()
  const record: CheckinRecord = {
    id: uid(),
    memberId: member.id,
    name: member.name,
    department: member.department,
    time: new Date().toISOString(),
    method,
    confidence,
  }
  writeJSON(CHECKINS_KEY, [record, ...checkins])
  notify()
  return record
}

export function hasCheckedInToday(memberId: string): boolean {
  const today = new Date().toDateString()
  return getCheckins().some(
    (c) => c.memberId === memberId && new Date(c.time).toDateString() === today
  )
}

export function todaysCheckins(): CheckinRecord[] {
  const today = new Date().toDateString()
  return getCheckins().filter((c) => new Date(c.time).toDateString() === today)
}

export function resetAllData() {
  writeJSON(MEMBERS_KEY, seedMembers())
  writeJSON(CHECKINS_KEY, [])
  notify()
}
