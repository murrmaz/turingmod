import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {
  DEFAULT_FRONTEND_DEV_PORT,
  DEFAULT_HOST,
  DEFAULT_SERVER_PORT,
  TRPC_PATH,
  WS_PATH,
} from '@turingmod/shared';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The backend reads the same variables from the same repository-root .env
// (packages/backend/src/utils/loadEnv.ts), so the proxy follows it to whatever host and port it
// was started on. Variables set in the shell win over the file, as they do for the backend.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error;
  }
}

const backendHost = process.env.HOST ?? DEFAULT_HOST;
const backendPort = process.env.SERVER_PORT ?? String(DEFAULT_SERVER_PORT);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: DEFAULT_FRONTEND_DEV_PORT,
    // The backend only accepts WebSocket connections from this origin, so don't let Vite drift
    // to another port when this one is taken.
    strictPort: true,
    proxy: {
      // The console connects to /ws and /trpc on the page's own origin; in development that's
      // this server.
      [WS_PATH]: {
        target: `ws://${backendHost}:${backendPort}`,
        ws: true,
        changeOrigin: true,
      },
      [TRPC_PATH]: {
        target: `ws://${backendHost}:${backendPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
