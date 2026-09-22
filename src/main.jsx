import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { getSupabaseClient } from './supabase/client.js'
import { applyTheme, readStoredTheme } from './ui/theme.js'
import { registerPwa } from './pwa/registerPwa.js'

applyTheme(readStoredTheme())
registerPwa()

if (import.meta.env.DEV) {
  globalThis.__paDreSupabase = getSupabaseClient
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
