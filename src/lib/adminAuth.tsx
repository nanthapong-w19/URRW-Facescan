import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Member } from './types'

// Lightweight client-side "admin session" gate for the meeting features.
//
// IMPORTANT — this is NOT a real authentication/authorization system.
// FaceIn has no login backend and its Supabase RLS policies are fully open
// (`for all to anon using (true) with check (true)`) on every table,
// including the new facein_meetings ones. This module only remembers
// "which admin member's face last matched on /login" in localStorage and
// uses that to show/hide the meeting-creation UI and redirect away from
// it — it does not and cannot stop a determined user from calling the
// Supabase REST API directly. Treat it as a convenience gate for the
// intended kiosk/admin workflow, not a security boundary.

export interface AdminSession {
  id: string
  name: string
  employeeId: string
}

const STORAGE_KEY = 'facein_admin_session'

interface AdminAuthContextValue {
  admin: AdminSession | null
  loginAsAdmin: (member: Member) => void
  logout: () => void
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

function readStoredSession(): AdminSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return { id: parsed.id, name: parsed.name, employeeId: parsed.employeeId ?? '' }
    }
    return null
  } catch {
    return null
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminSession | null>(() => readStoredSession())

  useEffect(() => {
    if (admin) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(admin))
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  }, [admin])

  function loginAsAdmin(member: Member) {
    setAdmin({ id: member.id, name: member.name, employeeId: member.employeeId })
  }

  function logout() {
    setAdmin(null)
  }

  return (
    <AdminAuthContext.Provider value={{ admin, loginAsAdmin, logout }}>{children}</AdminAuthContext.Provider>
  )
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within an AdminAuthProvider')
  return ctx
}
