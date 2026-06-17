import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${process.env.VITE_BACKEND_PORT || 3001}`,
      '/ws': {
        target: `ws://127.0.0.1:${process.env.VITE_BACKEND_PORT || 3001}`,
        ws: true,
      },
    },
  },
})
