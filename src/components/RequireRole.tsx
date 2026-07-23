import { Navigate, useLocation } from 'react-router-dom'
import { useAdminAuth } from '@/lib/adminAuth'

// Shared redirect-to-login gate behind RequireAdmin/RequireAuth — see
// lib/adminAuth.tsx for why this is a UI convenience gate, not real access
// control. `adminOnly` picks which of the two roles are let through:
// admin-only pages (create/edit/delete) vs. either role (read-only pages).
export default function RequireRole({ adminOnly, children }: { adminOnly: boolean; children: React.ReactNode }) {
  const { admin } = useAdminAuth()
  const location = useLocation()

  const allowed = adminOnly ? admin?.role === 'admin' : Boolean(admin)
  if (!allowed) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
