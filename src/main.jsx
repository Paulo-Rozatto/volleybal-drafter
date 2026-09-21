import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { getSupabaseClient } from './supabase/client.js'

if (import.meta.env.DEV) {
  globalThis.__paDreSupabase = getSupabaseClient
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
