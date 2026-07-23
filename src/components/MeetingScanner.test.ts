import { describe, it, expect } from 'vitest'
import { nextMatchStreak, streakHeldMs, type MatchStreak } from './MeetingScanner'

describe('nextMatchStreak', () => {
  const idle: MatchStreak = { memberId: null, since: 0 }

  it('resets when there is no match', () => {
    expect(nextMatchStreak({ memberId: 'a', since: 500 }, null, 1000)).toEqual({ memberId: null, since: 0 })
  })

  it('starts a new streak on the first match', () => {
    expect(nextMatchStreak(idle, 'member-1', 1000)).toEqual({ memberId: 'member-1', since: 1000 })
  })

  it('keeps the streak (same since) while the same member keeps matching', () => {
    const streak: MatchStreak = { memberId: 'member-1', since: 1000 }
    expect(nextMatchStreak(streak, 'member-1', 1500)).toEqual(streak)
  })

  it('restarts the streak when a different member matches', () => {
    const streak: MatchStreak = { memberId: 'member-1', since: 1000 }
    expect(nextMatchStreak(streak, 'member-2', 1500)).toEqual({ memberId: 'member-2', since: 1500 })
  })
})

describe('streakHeldMs', () => {
  it('is 0 for an idle streak', () => {
    expect(streakHeldMs({ memberId: null, since: 0 }, 5000)).toBe(0)
  })

  it('is the elapsed time since the streak started', () => {
    expect(streakHeldMs({ memberId: 'member-1', since: 1000 }, 2500)).toBe(1500)
  })
})
