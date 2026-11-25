import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// React app (public site + admin panel, one bundle with React Router).
// In development, /api calls are forwarded to the Express server.
export default defineConfig(({ mode }) => {
  // Only API_PORT: PORT is often set for the dev server itself, which would make /api proxy to itself.
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.API_PORT || 4000;
  return {
    plugins: [react()],
    server: {
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
    build: {
      chunkSizeWarningLimit: 900, // three.js lives in the lazily loaded match-page chunk
    },
  };
});
