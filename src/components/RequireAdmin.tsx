import { Navigate, useLocation } from 'react-router-dom'
import { useAdminAuth } from '@/lib/adminAuth'

// Redirects to the face-login page if no admin is "logged in" client-side.
// See lib/adminAuth.tsx for why this is a UI convenience gate, not real
// access control.
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { admin } = useAdminAuth()
  const location = useLocation()

  if (!admin) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
