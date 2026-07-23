import { describe, it, expect } from 'vitest'
import { resolveTick, type FaceCandidate } from './useFaceCamera'
import type { DetectedFace } from '@/lib/faceEngine'

function face(descriptor: number[]): DetectedFace {
  return {
    descriptor: descriptor as unknown as Float32Array,
    box: { x: 0, y: 0, width: 100, height: 100 },
    landmarks: {} as DetectedFace['landmarks'],
  }
}

interface TestCandidate extends FaceCandidate {
  id: string
}

describe('resolveTick', () => {
  it('returns null when no face is detected', () => {
    expect(resolveTick(null, [])).toBeNull()
  })

  it('reports no match when there are no candidates', () => {
    const result = resolveTick(face([0, 0, 0]), [])
    expect(result).toEqual({ face: face([0, 0, 0]), bestMatch: null, isMatch: false })
  })

  it('skips candidates with no face descriptor', () => {
    const candidates: TestCandidate[] = [{ id: 'a', faceDescriptor: null }]
    const result = resolveTick(face([0, 0, 0]), candidates)
    expect(result?.bestMatch).toBeNull()
    expect(result?.isMatch).toBe(false)
  })

  it('picks the closest candidate by descriptor distance', () => {
    const candidates: TestCandidate[] = [
      { id: 'far', faceDescriptor: [10, 10, 10] },
      { id: 'near', faceDescriptor: [0, 0, 0.1] },
    ]
    const result = resolveTick(face([0, 0, 0]), candidates)
    expect(result?.bestMatch?.candidate.id).toBe('near')
  })

  it('marks isMatch true only when the closest distance clears MATCH_THRESHOLD', () => {
    const closeCandidates: TestCandidate[] = [{ id: 'close', faceDescriptor: [0, 0, 0.01] }]
    expect(resolveTick(face([0, 0, 0]), closeCandidates)?.isMatch).toBe(true)

    const farCandidates: TestCandidate[] = [{ id: 'far', faceDescriptor: [10, 10, 10] }]
    expect(resolveTick(face([0, 0, 0]), farCandidates)?.isMatch).toBe(false)
  })
})
