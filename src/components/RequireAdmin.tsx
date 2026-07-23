import RequireRole from '@/components/RequireRole'

// Redirects to the face-login page unless an admin (not viewer) is "logged
// in" client-side — for pages that manage data (create/edit/delete), not
// just read it. For pages a viewer session may also see, use RequireAuth
// instead.
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  return <RequireRole adminOnly>{children}</RequireRole>
}
