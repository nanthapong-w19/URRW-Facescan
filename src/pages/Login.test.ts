import { describe, it, expect } from 'vitest'
import { describeRecognition } from './Login'
import type { TickResult } from '@/hooks/useFaceCamera'
import type { Member } from '@/lib/types'
import type { DetectedFace } from '@/lib/faceEngine'

const face: DetectedFace = {
  descriptor: new Float32Array([0, 0, 0]),
  box: { x: 1, y: 2, width: 3, height: 4 },
  landmarks: {} as DetectedFace['landmarks'],
}

const member: Member = {
  id: 'm1',
  employeeId: 'E1',
  name: 'สมชาย ใจดี',
  department: 'ครู',
  position: '',
  role: 'admin',
  faceStatus: 'registered',
  faceDescriptor: [0, 0, 0],
  photo: null,
  createdAt: '',
}

describe('describeRecognition', () => {
  it('returns null when no face is detected', () => {
    expect(describeRecognition(null)).toBeNull()
  })

  it('labels a match with the member name and a green box', () => {
    const result: TickResult<Member> = { face, bestMatch: { candidate: member, distance: 0.1 }, isMatch: true }
    expect(describeRecognition(result)).toEqual({ box: face.box, color: '#10b981', label: member.name })
  })

  it('labels a non-match as unknown with an amber box, never acting on it', () => {
    const result: TickResult<Member> = { face, bestMatch: null, isMatch: false }
    expect(describeRecognition(result)).toEqual({ box: face.box, color: '#f59e0b', label: 'ไม่รู้จัก' })
  })
})
