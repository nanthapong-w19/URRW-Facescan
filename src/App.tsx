import { HashRouter, Routes, Route } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import Navbar from '@/components/Navbar'
import Dashboard from '@/pages/Dashboard'
import MemberList from '@/pages/MemberList'
import FaceScanner from '@/pages/FaceScanner'
import { isSupabaseConfigured } from '@/lib/supabaseClient'

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

function App() {
  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-background">
        <div
          className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[420px] bg-gradient-to-b from-primary/10 via-accent/10 to-transparent dark:from-primary/20 dark:via-transparent"
          aria-hidden
        />
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/members" element={<MemberList />} />
            <Route path="/scan" element={<FaceScanner />} />
          </Routes>
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </HashRouter>
  )
}

export default App
