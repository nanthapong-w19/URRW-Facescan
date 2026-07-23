import { describe, it, expect } from 'vitest'
import { nextLivenessState, isLive, type LivenessState } from './FaceScanner'
import { EAR_BLINK_THRESHOLD } from '@/lib/faceEngine'

const OPEN_EAR = EAR_BLINK_THRESHOLD + 0.1
const CLOSED_EAR = EAR_BLINK_THRESHOLD - 0.05

describe('nextLivenessState', () => {
  const idle: LivenessState = { eyesClosed: false, blinkAt: null }

  it('marks eyesClosed when EAR dips below the blink threshold', () => {
    const next = nextLivenessState(idle, CLOSED_EAR, 1000)
    expect(next).toEqual({ eyesClosed: true, blinkAt: null })
  })

  it('records a blink timestamp on the closed -> open transition', () => {
    const closed: LivenessState = { eyesClosed: true, blinkAt: null }
    const next = nextLivenessState(closed, OPEN_EAR, 2000)
    expect(next).toEqual({ eyesClosed: false, blinkAt: 2000 })
  })

  it('leaves state unchanged when eyes stay open with no prior close', () => {
    const next = nextLivenessState(idle, OPEN_EAR, 3000)
    expect(next).toEqual(idle)
  })
})

describe('isLive', () => {
  it('is false when no blink has ever been recorded', () => {
    expect(isLive(null, 1000)).toBe(false)
  })

  it('is true shortly after a blink', () => {
    expect(isLive(1000, 1500)).toBe(true)
  })

  it('expires once LIVENESS_VALID_MS has passed', () => {
    expect(isLive(1000, 1000 + 4000)).toBe(false)
  })
})
