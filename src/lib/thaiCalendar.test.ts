import { describe, it, expect } from 'vitest'
import { parseThaiDateInput, formatThaiDateInput } from './thaiCalendar'

describe('parseThaiDateInput', () => {
  it('parses a zero-padded Buddhist-era date', () => {
    const date = parseThaiDateInput('03/07/2569')
    expect(date).toEqual(new Date(2026, 6, 3))
  })

  it('parses 1-2 digit day/month while typing', () => {
    expect(parseThaiDateInput('3/7/2569')).toEqual(new Date(2026, 6, 3))
  })

  it('rejects text that does not match dd/MM/yyyy', () => {
    expect(parseThaiDateInput('2569-07-03')).toBeUndefined()
    expect(parseThaiDateInput('not a date')).toBeUndefined()
  })

  it('rejects overflow days instead of silently rolling into the next month', () => {
    expect(parseThaiDateInput('31/02/2569')).toBeUndefined()
  })
})

describe('formatThaiDateInput', () => {
  it('formats a date as zero-padded dd/MM/yyyy with the Buddhist-era year', () => {
    expect(formatThaiDateInput(new Date(2026, 6, 3))).toBe('03/07/2569')
  })

  it('round-trips through parseThaiDateInput', () => {
    const date = new Date(2025, 0, 15)
    expect(parseThaiDateInput(formatThaiDateInput(date))).toEqual(date)
  })
})
