// Generic segmented-input formatting/parsing helpers — no calendar system
// knowledge, unlike thaiCalendar.ts. Shared by CreateMeeting.tsx's typed
// date field ("dd/MM/yyyy") and time field ("HH:mm").

// Plain 24-hour "H:mm" or "HH:mm".
export function parseTimeInput(text: string): string | undefined {
  const m = text.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return undefined
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

// Auto-inserts the group separator as digits are typed, e.g. "2307" ->
// "23/07" -> keep typing -> "23/07/2569". `groupLengths` is each segment's
// digit count (date: [2,2,4], time: [2,2]); a separator is appended right
// after a non-last segment fills up, so typing never requires the user to
// type "/" or ":" themselves.
// Deleting the separator itself (backspace landing on it, character count
// dropping but digit count unchanged) is treated as "delete the last digit
// too" — otherwise backspace would appear to do nothing right after a "/".
export function autoFormatSegmented(raw: string, prevFormatted: string, groupLengths: number[], separator: string): string {
  let digits = raw.replace(/\D/g, '')
  if (raw.length < prevFormatted.length) {
    const prevDigits = prevFormatted.replace(/\D/g, '')
    if (digits.length === prevDigits.length && digits.length > 0) {
      digits = digits.slice(0, -1)
    }
  }
  const maxDigits = groupLengths.reduce((a, b) => a + b, 0)
  digits = digits.slice(0, maxDigits)

  let out = ''
  let idx = 0
  groupLengths.forEach((len, i) => {
    if (digits.length <= idx) return
    const isLast = i === groupLengths.length - 1
    const chunk = digits.slice(idx, idx + len)
    out += chunk
    idx += len
    if (!isLast && chunk.length === len) out += separator
  })
  return out
}
