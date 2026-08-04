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

  it('rejects a match whose runner-up is within MATCH_MARGIN, even under MATCH_THRESHOLD', () => {
    // Both candidates are close enough to clear MATCH_THRESHOLD on their
    // own, but only 0.02 apart from each other — an ambiguous photo-finish
    // that should read as "no confident match", not a coin-flip pick.
    const tooClose: TestCandidate[] = [
      { id: 'a', faceDescriptor: [0, 0, 0.05] },
      { id: 'b', faceDescriptor: [0, 0, 0.07] },
    ]
    const result = resolveTick(face([0, 0, 0]), tooClose)
    expect(result?.bestMatch?.candidate.id).toBe('a')
    expect(result?.isMatch).toBe(false)
  })

  it('accepts a match whose runner-up clears MATCH_MARGIN', () => {
    const clearlyDistinct: TestCandidate[] = [
      { id: 'a', faceDescriptor: [0, 0, 0.05] },
      { id: 'b', faceDescriptor: [1, 1, 1] },
    ]
    const result = resolveTick(face([0, 0, 0]), clearlyDistinct)
    expect(result?.bestMatch?.candidate.id).toBe('a')
    expect(result?.isMatch).toBe(true)
  })

  it('a lone candidate always clears the margin (no runner-up to compare against)', () => {
    const single: TestCandidate[] = [{ id: 'only', faceDescriptor: [0, 0, 0.05] }]
    expect(resolveTick(face([0, 0, 0]), single)?.isMatch).toBe(true)
  })
})
