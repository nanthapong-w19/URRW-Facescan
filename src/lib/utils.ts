import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Shared by MeetingDetail.tsx's own check-in history list and
// MeetingScanner's "เช็คอินล่าสุด" panel — both need the same short
// HH:mm formatting for a check-in timestamp.
export function formatCheckinTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
