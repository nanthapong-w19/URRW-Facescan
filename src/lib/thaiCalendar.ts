// Thai written date format: "dd/MM/yyyy" with a Buddhist-era year
// (Gregorian + 543) — see CreateMeeting.tsx's typed date field.

// Accepts 1-2 digit day/month so "3/7/2569" works while typing, not just
// the zero-padded form.
export function parseThaiDateInput(text: string): Date | undefined {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return undefined
  const day = Number(m[1])
  const month = Number(m[2])
  const yearAD = Number(m[3]) - 543
  const date = new Date(yearAD, month - 1, day)
  // Rejects overflow like 31/02 silently rolling into March.
  if (date.getFullYear() !== yearAD || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  return date
}

export function formatThaiDateInput(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear() + 543}`
}
