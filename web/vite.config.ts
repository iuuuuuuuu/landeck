import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// 产物同时给 Go embed 与 Tauri 共用：相对 base + HashRouter，任何静态托管都能跑。
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 5199,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8420', changeOrigin: true, ws: true },
    },
  },
})
