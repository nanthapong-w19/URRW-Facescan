import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initStore } from '@/lib/store'

// Seed localStorage before the component tree renders, so every page's
// initial state (which reads localStorage synchronously) already sees data.
initStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
