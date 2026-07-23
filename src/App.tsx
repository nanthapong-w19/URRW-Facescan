import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import Navbar from '@/components/Navbar'
import RequireAdmin from '@/components/RequireAdmin'
import RequireAuth from '@/components/RequireAuth'
import Dashboard from '@/pages/Dashboard'
import MemberList from '@/pages/MemberList'
import FaceScanner from '@/pages/FaceScanner'
import Login from '@/pages/Login'
import MeetingList from '@/pages/MeetingList'
import CreateMeeting from '@/pages/CreateMeeting'
import MeetingDetail from '@/pages/MeetingDetail'
import MeetingSummary from '@/pages/MeetingSummary'
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import { AdminAuthProvider } from '@/lib/adminAuth'

// Shown instead of the app when .env is missing or incomplete — the most
// common first-run mistake, and previously produced a silent blank white
// page instead of an actionable message.
function SupabaseSetupNotice() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500" />
      <h1 className="font-display text-xl font-bold text-foreground">ยังไม่ได้ตั้งค่าฐานข้อมูล (Supabase)</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        ไม่พบไฟล์ <code className="rounded bg-muted px-1 py-0.5">.env</code> หรือค่าภายในยังไม่ครบ กรุณาสร้างไฟล์{' '}
        <code className="rounded bg-muted px-1 py-0.5">.env</code> ที่ root ของโปรเจกต์ (คัดลอกจาก{' '}
        <code className="rounded bg-muted px-1 py-0.5">.env.example</code>) แล้วใส่ค่า{' '}
        <code className="rounded bg-muted px-1 py-0.5">VITE_SUPABASE_URL</code> และ{' '}
        <code className="rounded bg-muted px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code> ให้ครบ จากนั้นหยุดแล้วรัน{' '}
        <code className="rounded bg-muted px-1 py-0.5">npm run dev</code> ใหม่อีกครั้ง (ต้องรันใหม่ทุกครั้งหลังแก้ .env)
      </p>
    </div>
  )
}

// Split out from App so it can call useLocation() — that hook only works
// inside the <HashRouter>, so this has to render below it, not alongside it.
function AppShell() {
  const location = useLocation()
  // /#/login is a full-screen face-scan kiosk view — the top nav (with its
  // "เข้าสู่ระบบผู้ดูแล" button, member/meeting links, etc.) doesn't belong
  // there since the visitor isn't logged in yet and shouldn't be able to
  // jump elsewhere in the app from this screen.
  const hideNavbar = location.pathname === '/login'

  return (
    <div className="min-h-screen bg-background">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[420px] bg-gradient-to-b from-primary/10 via-accent/10 to-transparent dark:from-primary/20 dark:via-transparent"
        aria-hidden
      />
      {!hideNavbar && <Navbar />}
      <main
        className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <Routes>
          {/* /#/login is now the home page — a kiosk/browser opening the
              site fresh should land on the face-login scanner, not the
              dashboard. Dashboard.tsx still exists and still works, just
              moved off "/" to "/dashboard" so it's reachable by URL
              rather than being deleted outright. */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/members" element={<MemberList />} />
          <Route path="/scan" element={<FaceScanner />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/meetings"
            element={
              <RequireAuth>
                <MeetingList />
              </RequireAuth>
            }
          />
          <Route
            path="/meetings/new"
            element={
              <RequireAdmin>
                <CreateMeeting />
              </RequireAdmin>
            }
          />
          {/* Deliberately NOT wrapped in RequireAdmin: this is the page a
              meeting's participants open (e.g. from a shared link/QR
              code, or on a shared kiosk) to scan their face and check
              in to that specific meeting — they aren't admins and
              shouldn't need to log in as one. The delete button inside
              MeetingDetail is the only part still gated, checked
              client-side via useAdminAuth(). */}
          <Route path="/meetings/:id" element={<MeetingDetail />} />
          {/* Read-only report view — same "no login required" reasoning as
              /meetings/:id above, since anyone with the meeting link should
              be able to check attendance without needing admin access. */}
          <Route path="/meetings/:id/summary" element={<MeetingSummary />} />
        </Routes>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  )
}

function App() {
  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />
  }

  return (
    <AdminAuthProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </AdminAuthProvider>
  )
}

export default App
