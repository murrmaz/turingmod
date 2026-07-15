# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: Keep this file updated when adding new major systems or changing module organization. Focus on stable structural information, not implementation details.

## Commands

```bash
# Development (starts both backend + frontend via concurrently)
npm run dev                # Backend on :8080, Frontend on :3000
npm run dev:backend        # Backend only (tsx watch)
npm run dev:frontend       # Frontend only (Vite dev server)

# Building (prebuild runs check + type-check automatically)
npm run build              # Builds shared → backend → frontend (order matters)
npm run build:shared       # Build shared package only

# Code quality
npm run check              # Biome lint + format check
npm run check:fix          # Biome lint + format with auto-fix
npm run type-check         # TypeScript type checking across all workspaces

```

There is no test runner configured. Type checking (`npm run type-check`) is the primary verification step.

## Quick Reference: File Locations

Use this to quickly locate files without searching. Organized by system/feature.

### Integration System
- **UI (Table View)**: `packages/frontend/src/components/dashboard/IntegrationStatus.tsx`
- **UI (Card View)**: `packages/frontend/src/components/integrations/IntegrationPanel.tsx`
- **Setup Modals**: `packages/frontend/src/components/integrations/{Twitch,Spotify}SetupModal.tsx`
- **OAuth Modals**: `packages/frontend/src/components/integrations/{Twitch,Spotify}OAuthModal.tsx`
- **Backend Manager**: `packages/backend/src/integrations/IntegrationManager.ts`
- **Interface**: `packages/backend/src/integrations/interfaces/IIntegration.ts`
- **Implementations**: `packages/backend/src/integrations/implementations/*.ts`
- **WebSocket Handler**: `packages/backend/src/server/handlers/IntegrationHandler.ts`
- **Types & Enums**: `packages/shared/src/types/integration.ts`

### Commands System
- **Interface**: `packages/backend/src/commands/interfaces/ICommand.ts`
- **Implementations**: `packages/backend/src/commands/implementations/*.ts`
- **Loader**: `packages/backend/src/commands/loadCommands.ts`
- **WebSocket Handler**: `packages/backend/src/server/handlers/CommandHandler.ts`

### WebSocket Protocol
- **Server**: `packages/backend/src/server/WebSocketServer.ts`
- **Router**: `packages/backend/src/server/MessageRouter.ts`
- **Messages/Types**: `packages/shared/src/protocol/messages.ts`
- **Frontend Context**: `packages/frontend/src/context/WebSocketContext.tsx`
- **Frontend Hooks**: `packages/frontend/src/hooks/useWebSocket.ts`

### Database
- **Manager**: `packages/backend/src/database/DatabaseManager.ts`
- **Repositories**: `packages/backend/src/database/repositories/*.ts`
- **Migrations**: `packages/backend/src/database/migrations/*.ts` (run automatically on startup via `Application.initialize()`)

### Core Infrastructure
- **DI Container**: `packages/backend/src/core/Container.ts`
- **EventBus**: `packages/backend/src/core/EventBus.ts`
- **Application**: `packages/backend/src/core/Application.ts`
- **Setup/Bootstrap**: `packages/backend/src/setup.ts`
- **Entry Point**: `packages/backend/src/index.ts`

### Frontend State
- **App State Context**: `packages/frontend/src/context/AppStateContext.tsx`
- **Integration Hooks**: `packages/frontend/src/hooks/useIntegrations.ts`
- **Command Hooks**: `packages/frontend/src/hooks/useCommands.ts`

## Architecture

npm workspaces monorepo with three packages:

- **`packages/shared`** (`@turingmod/shared`) — WebSocket protocol types, message creators, shared enums (IntegrationStatus, PermissionLevel, MessageType). Must be built first since both other packages depend on it.
- **`packages/backend`** (`@turingmod/backend`) — Node.js server with WebSocket + HTTP. Uses `tsx` for development with watch mode.
- **`packages/frontend`** (`@turingmod/frontend`) — React 18 + Vite 6 + Cloudscape Design System. Dev server proxies `/ws` to backend.

### Backend Core Flow

Entry point: `packages/backend/src/index.ts` → calls `setupDependencies()` and `initializeComponents()` from `setup.ts` → resolves `Application` → `app.initialize()` → `app.start()`.

**Dependency injection** uses a custom `Container` (`core/Container.ts`) with string token registration. All services are singletons registered in `setup.ts`. No DI framework — just `container.registerSingleton(token, factory)` and `container.resolve<T>(token)`.

**Message routing**: WebSocket messages arrive at `WebSocketServer` → `MessageRouter` dispatches by `MessageType` → handler classes (`CommandHandler`, `IntegrationHandler`, `OAuthHandler`) process and return response messages.

### Integration System

All integrations implement `IIntegration` interface (`integrations/interfaces/IIntegration.ts`): `initialize(config)` → `start()` → `stop()` lifecycle with `getStatus()` returning `IntegrationStatus` enum values.

`IntegrationManager` resolves dependencies via topological sort before startup. Integrations declare dependencies through `getDependencies()`.

**Twitch** is split into three integrations following SRP: `TwitchAuthIntegration` (OAuth) → `TwitchApiIntegration` (Helix API) → `TwitchEventSubIntegration` (real-time events). Spotify follows the same pattern: `SpotifyAuthIntegration` → `SpotifyApiIntegration`.

Cross-integration communication uses `EventBus` (`core/EventBus.ts`) — a simple pub/sub with sync and async emit.

### WebSocket Protocol

All messages follow `IWebSocketMessage<T>` from `packages/shared/src/protocol/messages.ts`: `{ id, type, timestamp, payload }`. Message IDs are UUIDs used for request/response correlation. Use `createMessage()` and typed creator functions (e.g., `createCommandResultMessage()`) to construct messages.

### Database

sql.js (WASM SQLite, no native compilation). `DatabaseManager` handles auto-save every 5 seconds if dirty. Access via repository pattern: `UserRepository`, `CommandHistoryRepository`, `IntegrationStateRepository`. Integration configs are encrypted with AES-256-GCM before storage.

### Frontend State

React Context for state management: `WebSocketContext` (connection + send/subscribe) and `AppStateContext` (commands, integrations, health). Custom hooks: `useWebSocket()`, `useWebSocketMessage()`, `useCommands()`, `useIntegrations()`.

### HTTP Server

Minimal Node.js `http` server (`server/HttpServer.ts`). Serves static frontend build in production. OAuth callback routes at `/callback/twitch` and `/callback/spotify`. Health check at `/health`. Localhost-only binding enforced.

## Code Style

- **Biome** for linting and formatting (not ESLint/Prettier). Config in `biome.json`.
- Line width 100, single quotes, semicolons always, trailing commas (es5).
- Naming: camelCase/PascalCase for functions, PascalCase for classes/interfaces, CONSTANT_CASE for enum members.
- Pre-commit hook (Husky + lint-staged) runs `biome check --write` on staged files.

## TypeScript

- Strict mode with `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` — these are stricter than default strict. When assigning to optional properties, you must use `undefined` explicitly (not just omit the property). Indexed access returns `T | undefined`.
- Backend uses `NodeNext` module resolution; frontend uses `bundler` resolution.
- ESM throughout (`"type": "module"` in root package.json). Backend imports use `.js` extensions in source files.

## Key Conventions

- **Localhost only** — all servers bind to 127.0.0.1, never 0.0.0.0.
- **No REST API** — all frontend-backend communication is WebSocket. HTTP server is only for static files and OAuth callbacks.
- **IntegrationStatus enum** — never use string literals for integration status.
- **Integration lifecycle** — always call `initialize(config)` before `start()`.
- **New commands** go in `packages/backend/src/commands/implementations/` and implement `ICommand`. They're auto-discovered by `loadCommands()`.
- **New integrations** implement `IIntegration`, get registered in `setup.ts` (both container + `initializeComponents`), and need a `MessageRouter` handler if they accept WebSocket messages.
