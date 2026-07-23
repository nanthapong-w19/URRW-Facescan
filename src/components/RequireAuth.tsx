import RequireRole from '@/components/RequireRole'

// Like RequireAdmin, but lets either role in ('admin' or 'viewer') — for
// read-only pages (e.g. the meeting list) a viewer session should also be
// able to reach.
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  return <RequireRole adminOnly={false}>{children}</RequireRole>
}
