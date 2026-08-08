import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.API_PORT ?? '3000';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/health': `http://127.0.0.1:${apiPort}`,
      '/ready': `http://127.0.0.1:${apiPort}`,
    },
  },
  build: {
    outDir: '../dist-web',
    emptyOutDir: true,
  },
});
