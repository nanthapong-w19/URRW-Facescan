import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Users, ScanFace, Radar } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { to: '/', label: 'ภาพรวม', icon: LayoutDashboard, end: true },
  { to: '/members', label: 'สมาชิก', icon: Users, end: false },
  { to: '/scan', label: 'สแกนเช็คอิน', icon: ScanFace, end: false },
]

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal-600 text-primary-foreground shadow-soft">
            <Radar className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <p className="font-display text-[15px] font-bold tracking-tight text-foreground">FaceIn</p>
            <p className="text-[11px] text-muted-foreground">ระบบเช็คอินด้วยใบหน้า</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 rounded-full border border-border/70 bg-card/60 p-1 shadow-soft">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-soft'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">ระบบพร้อมใช้งาน</span>
        </div>
      </div>
    </header>
  )
}
