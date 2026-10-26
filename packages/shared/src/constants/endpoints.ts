/**
 * Default server configuration
 */
/**
 * The backend's one port: the HTTP server (console, OAuth callbacks, health check) and the
 * WebSocket endpoint it hosts at TRPC_PATH.
 */
export const DEFAULT_SERVER_PORT = 8080;
export const DEFAULT_HOST = '127.0.0.1'; // localhost only

/** Vite dev server port (packages/frontend/vite.config.ts) */
export const DEFAULT_FRONTEND_DEV_PORT = 3000;

/** The console's WebSocket endpoint: the backend's tRPC router. */
export const TRPC_PATH = '/trpc';

/**
 * HTTP endpoints
 */
export const HEALTH_PATH = '/health';
