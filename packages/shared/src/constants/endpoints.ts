/**
 * Default server configuration
 */
/**
 * The backend's one port: the HTTP server (console, OAuth callbacks, health check) and the
 * WebSocket endpoints it hosts at WS_PATH and TRPC_PATH.
 */
export const DEFAULT_SERVER_PORT = 8080;
export const DEFAULT_HOST = '127.0.0.1'; // localhost only

/** Vite dev server port (packages/frontend/vite.config.ts) */
export const DEFAULT_FRONTEND_DEV_PORT = 3000;

/**
 * WebSocket endpoints
 */
export const WS_PATH = '/ws';
/** The tRPC router's endpoint, which requests move to from WS_PATH as the console is rebuilt. */
export const TRPC_PATH = '/trpc';

/**
 * HTTP endpoints
 */
export const HEALTH_PATH = '/health';
