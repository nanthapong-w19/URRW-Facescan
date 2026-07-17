import { HashRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import Navbar from '@/components/Navbar'
import Dashboard from '@/pages/Dashboard'
import MemberList from '@/pages/MemberList'
import FaceScanner from '@/pages/FaceScanner'

function App() {
  return (
    <HashRouter>
      <div className="min-h-screen bg-background">
        <div
          className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[420px] bg-gradient-to-b from-teal-100/60 via-amber-50/30 to-transparent dark:from-teal-950/40 dark:via-transparent"
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
