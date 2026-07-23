import { Navigate, useLocation } from 'react-router-dom'
import { useAdminAuth } from '@/lib/adminAuth'

// Redirects to the face-login page unless an admin (not viewer) is "logged
// in" client-side — for pages that manage data (create/edit/delete), not
// just read it. See lib/adminAuth.tsx for why this is a UI convenience
// gate, not real access control. For pages a viewer session may also see,
// use RequireAuth instead.
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin } = useAdminAuth()
  const location = useLocation()

  if (!admin || admin.role !== 'admin') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
