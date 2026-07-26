import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' hace que los assets funcionen en cualquier hosting (carpeta/URL)
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,              // 👈 AGREGA ESTO
    allowedHosts: true,     // 👈 Y ESTO

    // Evita que Vite se refresque cuando PostgreSQL/Docker cambia archivos en backend/data
    watch: {
      ignored: ['**/backend/**', '**/data/**'],
    },

    proxy: {
      // Todas las peticiones que empiecen con /api serán redirigidas al backend
      '/api': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        secure: false,
        configure: (proxy, options) => {
          // Logs para debugging
          proxy.on('error', (err, _req, _res) => {
            console.log('🔴 Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('📤 Request to backend:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('📥 Response from backend:', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
})