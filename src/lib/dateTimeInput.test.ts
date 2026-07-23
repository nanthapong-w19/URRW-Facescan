import { describe, it, expect } from 'vitest'
import { parseTimeInput, autoFormatSegmented } from './dateTimeInput'

describe('parseTimeInput', () => {
  it('accepts H:mm and HH:mm, normalizing to zero-padded hours', () => {
    expect(parseTimeInput('9:05')).toBe('09:05')
    expect(parseTimeInput('23:59')).toBe('23:59')
  })

  it('rejects out-of-range hours/minutes', () => {
    expect(parseTimeInput('24:00')).toBeUndefined()
    expect(parseTimeInput('12:60')).toBeUndefined()
  })

  it('rejects text with no colon', () => {
    expect(parseTimeInput('1200')).toBeUndefined()
  })
})

describe('autoFormatSegmented', () => {
  const dateGroups = [2, 2, 4]

  it('inserts a separator right after a non-last segment fills up, eagerly (even before the next segment has digits)', () => {
    expect(autoFormatSegmented('23', '', dateGroups, '/')).toBe('23/')
    expect(autoFormatSegmented('2307', '23', dateGroups, '/')).toBe('23/07/')
  })

  it('stops at the combined group length', () => {
    expect(autoFormatSegmented('230720699999', '23/07', dateGroups, '/')).toBe('23/07/2069')
  })

  it('treats backspace landing on a separator as deleting the digit before it too', () => {
    // Cursor right after "23/07"'s "/" — backspace removes only that
    // character, so the raw value ("2307") still has the same 4 digits as
    // before. Without the special case this would look like backspace did
    // nothing (the "/" would just get re-inserted); it drops the last
    // digit too so the edit is actually felt.
    expect(autoFormatSegmented('2307', '23/07', dateGroups, '/')).toBe('23/0')
  })

  it('supports a different group/separator config for the time field', () => {
    expect(autoFormatSegmented('1230', '12', [2, 2], ':')).toBe('12:30')
  })
})
