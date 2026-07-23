import { NavLink, useNavigate } from 'react-router-dom'
import { Users, CalendarDays, ShieldCheck, LogIn, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PulseDot } from '@/components/PulseDot'
import { useAdminAuth } from '@/lib/adminAuth'
import { cn } from '@/lib/utils'

// "ภาพรวม" (Dashboard, "/") and "สแกนเช็คอิน" (FaceScanner, "/scan") were
// removed from this nav by request — the routes themselves still exist in
// App.tsx (e.g. a kiosk can still be pointed straight at /#/scan), they're
// just no longer reachable from the top nav.
const links = [
  { to: '/members', label: 'สมาชิก', icon: Users, end: false },
  { to: '/meetings', label: 'การประชุม', icon: CalendarDays, end: false },
]

export default function Navbar() {
  const { admin, logout } = useAdminAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-40 border-b border-primary/15 bg-background/80 shadow-[0_1px_0_hsl(var(--accent)/0.25)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5">
          <img src="/logo.png" alt="โลโก้ศูนย์ทัศนราชกัญญาราชวิทยาลัย นครราชสีมา" className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10" />
          <div className="min-w-0 leading-tight">
            {/* "FaceIn" wordmark given the same maroon-to-gold gradient +
                drop-shadow treatment as the login page's card title (see
                Login.tsx), now animated the same way there too — bg-size
                200% with an animated background-position — so the brand
                mark reads consistently wherever it appears, not just on
                /#/login. */}
            <p className="font-display animate-gradient-move truncate bg-gradient-to-r from-primary via-[hsl(350_65%_42%)] to-accent bg-[length:200%_auto] bg-clip-text text-[15px] font-bold tracking-tight text-transparent drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
              FaceIn
            </p>
            <p className="hidden truncate text-[11px] text-muted-foreground xs:block">ระบบเช็คอินราชกัญญาฯ</p>
          </div>
        </div>

        <nav className="flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-card/60 p-1 shadow-soft">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 sm:px-3.5',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-soft ring-1 ring-accent/40'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <PulseDot size="md" />
            <span className="text-xs font-medium text-muted-foreground">ระบบพร้อมใช้งาน</span>
          </div>

          {admin ? (
            <div className="flex items-center gap-1.5">
              <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground md:flex">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> {admin.name}
              </span>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5 text-xs">
                <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">ออกจากระบบ</span>
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => navigate('/login')} className="gap-1.5 text-xs">
              <LogIn className="h-3.5 w-3.5" /> <span className="hidden sm:inline">เข้าสู่ระบบผู้ดูแล</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
