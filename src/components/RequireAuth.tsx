import { Navigate, useLocation } from 'react-router-dom'
import { useAdminAuth } from '@/lib/adminAuth'

// Like RequireAdmin, but lets either role in ('admin' or 'viewer') — for
// read-only pages (e.g. the meeting list) a viewer session should also be
// able to reach. See lib/adminAuth.tsx for why this is a UI convenience
// gate, not real access control.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { admin } = useAdminAuth()
  const location = useLocation()

  if (!admin) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
