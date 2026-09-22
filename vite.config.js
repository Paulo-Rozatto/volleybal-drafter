import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { padrePwaPlugin } from './scripts/padrePwaPlugin.js'

export default defineConfig({
  plugins: [react(), tailwindcss(), padrePwaPlugin('/volleybal-drafter/')],
  base: '/volleybal-drafter/',
  test: {
    hookTimeout: 60_000,
  },
})
