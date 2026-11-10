// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Flask serves the built React app from the same origin in production.
  base: '/',

  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      '/terms': 'http://127.0.0.1:5001',
      '/query': 'http://127.0.0.1:5001',
      '/help': 'http://127.0.0.1:5001',
      '/auth': 'http://127.0.0.1:5001',
      '/workspace': 'http://127.0.0.1:5001',
    }
  }
})

