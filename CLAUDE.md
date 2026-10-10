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

Vitest is configured in the backend workspace (`npm test --workspace @turingmod/backend`); tests live beside their subjects as `*.test.ts`. Type checking (`npm run type-check`) remains the primary verification step, since coverage is partial.

## Quick Reference: File Locations

Use this to quickly locate files without searching. Organized by system/feature.

### Integration System
- **UI (Table View)**: `packages/frontend/src/components/dashboard/IntegrationStatus.tsx`
- **UI (Card View)**: `packages/frontend/src/components/integrations/IntegrationPanel.tsx`
- **Setup Modal**: `packages/frontend/src/components/integrations/SetupModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Modal**: `packages/frontend/src/components/integrations/OAuthModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Provider Configs**: `packages/frontend/src/components/integrations/oauthProviders.tsx` (per-provider content) + `oauthIntegrationRegistry.tsx` (name → modal/config lookup)
- **Backend Manager**: `packages/backend/src/integrations/IntegrationManager.ts`
- **Base Class**: `packages/backend/src/integrations/BaseIntegration.ts` — shared status/error/event-emitter plumbing; all integrations extend this
- **Interfaces**: `packages/backend/src/integrations/interfaces/IIntegration.ts`, `IOAuthIntegration.ts` (extends `IIntegration` for OAuth-capable integrations)
- **Implementations**: `packages/backend/src/integrations/implementations/*.ts` (Twitch, YouTube, Spotify, Discord, OBS, Arduino, Sound)
- **YouTube chat stream client**: `packages/backend/src/integrations/implementations/youtube/YouTubeChatStream.ts` + the response frame splitter `parseJsonFrames.ts` beside it
- **WebSocket Handler**: `packages/backend/src/server/handlers/IntegrationHandler.ts`, `OAuthHandler.ts`, `YouTubeHandler.ts`
- **Types & Enums**: `packages/shared/src/types/integration.ts`

### Commands System
- **Interface**: `packages/backend/src/commands/interfaces/ICommand.ts`
- **Implementations**: `packages/backend/src/commands/implementations/*.ts`
- **Loader**: `packages/backend/src/commands/loadCommands.ts`
- **WebSocket Handler**: `packages/backend/src/server/handlers/CommandHandler.ts`

### Platform Provider Layer
- **Interface**: `packages/backend/src/platforms/interfaces/IStreamPlatform.ts` — platform-agnostic façade; capability-guarded methods are optional
- **Implementations**: `packages/backend/src/platforms/TwitchPlatform.ts`, `YouTubePlatform.ts`
- **Registry**: `packages/backend/src/platforms/PlatformRegistry.ts` (Platform → façade)
- **Mirroring/reads**: `packages/backend/src/platforms/StreamControlService.ts` — the seam commands depend on
- **Auth reporting**: `packages/backend/src/platforms/availability.ts` (`unavailableReason`) + `errors.ts` (`NotAuthenticatedError`)
- **Chat routing**: `packages/backend/src/platforms/ChatRouter.ts`
- **Display names**: `packages/backend/src/platforms/platformNames.ts`

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

All integrations extend `BaseIntegration` (`integrations/BaseIntegration.ts`), which implements the `IIntegration` interface (`integrations/interfaces/IIntegration.ts`) and provides shared status/error/event-emitter plumbing. Concrete integrations implement `initialize(config)` → `start()` → `stop()` and call `setStatus()` to report lifecycle transitions; `getStatus()` returns `IntegrationStatus` enum values.

`IntegrationManager` resolves dependencies via topological sort before startup. Integrations declare dependencies through `getDependencies()`.

**Twitch** is split into three integrations following SRP: `TwitchAuthIntegration` (OAuth) → `TwitchApiIntegration` (Helix API) → `TwitchEventSubIntegration` (real-time events). **YouTube** follows the same three-part shape: `YouTubeAuthIntegration` → `YouTubeApiIntegration` → `YouTubeChatIntegration`. Spotify has an auth/api split only: `SpotifyAuthIntegration` → `SpotifyApiIntegration`. Discord, OBS, Arduino, and Sound are single-file integrations with no auth/api split.

**YouTube chat streams over the official client, via a method that is easy to miss.** The server-streaming live chat RPC is exposed by `googleapis` as `client.youtube.v3.liveChat.messages.stream()` — note that it is named `stream`, not `streamList` (its gRPC name), and that it hangs off a separate nested resource rather than the top-level `client.liveChatMessages` that holds `list`/`insert`/`delete`. Searching for `streamList`, or looking only at `liveChatMessages`, finds nothing and produces the false conclusion that the method is gRPC-only and needs a hand-rolled client. It does not: this project carried a vendored `stream_list.proto` and a `@grpc/proto-loader` client on exactly that mistake until it was removed.

`YouTubeChatStream` requests it with `responseType: 'stream'` and `timeout: 0`, then splits the body with `JsonFrameParser` (`parseJsonFrames.ts`). Both details are load-bearing. Awaiting the ordinary overload buffers the whole response, so messages would only arrive once the broadcast ended; any timeout would cut a multi-hour stream short. Discovery types the response as a single `LiveChatMessageListResponse` — a code-generator artifact, since the generator emits `response.$ref` identically for unary and streaming methods — so that type describes **one frame** and says nothing about how frames are delimited. `JsonFrameParser` therefore scans for balanced top-level objects instead of assuming a delimiter, which decodes a chunked JSON array, newline-delimited JSON, and bare concatenated objects alike.

`YouTubeChatIntegration` has no periodic timers. It idles until a go-live signal — OBS's `obs.stream.stateChanged` (`OBS_WEBSOCKET_OUTPUT_STARTED`), or a `youtube.goLive` message from the console — then resolves the broadcast's `liveChatId` with a bounded retry (a broadcast doesn't expose one until YouTube transitions it to `live`) and opens the stream. Its `idle → resolving → streaming` transitions are broadcast to the frontend as `YOUTUBE_CHAT_STATE`.

OAuth-capable integrations (currently `TwitchAuthIntegration`, `SpotifyAuthIntegration`) additionally implement `IOAuthIntegration` (`integrations/interfaces/IOAuthIntegration.ts`) and expose it via a `get oauth()` getter (`null` on `BaseIntegration` by default). This is the single source of truth for OAuth capability — `IntegrationManager`/`HttpServer` derive callback routing and the frontend's OAuth affordance from it instead of checking integration names.

Cross-integration communication uses `EventBus` (`core/EventBus.ts`) — a simple pub/sub with sync and async emit.

### WebSocket Protocol

All messages follow `IWebSocketMessage<T>` from `packages/shared/src/protocol/messages.ts`: `{ id, type, timestamp, payload }`. Message IDs are UUIDs used for request/response correlation. Use `createMessage()` and typed creator functions (e.g., `createCommandResultMessage()`) to construct messages.

### Database

sql.js (WASM SQLite, no native compilation). `DatabaseManager` handles auto-save every 5 seconds if dirty. Access via repository pattern: `UserRepository`, `CommandHistoryRepository`, `IntegrationStateRepository`. Integration configs are encrypted with AES-256-GCM before storage.

### Platform Provider Layer

`IStreamPlatform` is a platform-agnostic façade over one platform's integration group, registered
in `PlatformRegistry` and consumed through `StreamControlService`. Commands depend on this seam, not
on integrations — a command should never resolve `TwitchApiIntegration`/`TwitchAuthIntegration` from
the container. Platform-specific logic (Twitch category name → id resolution) lives inside the
façade, and the DTOs crossing it (`StreamInfo`, `ScheduleSegment`, `AdBreakInfo`) are agnostic, so no
Twurple/googleapis types leak into the interface.

Capabilities that only some platforms have are declared in `PlatformCapability` and exposed as
*optional* interface methods. `StreamControlService.capableMethod()` resolves one and asserts the
façade both advertises the capability and implements the method, so a drifted capability set fails
loudly. A command declares `requiredCapabilities` and is hidden on platforms that don't satisfy them
(`CommandExecutor` treats hidden as `COMMAND_NOT_FOUND`); the frontend mirrors the same sets manually
in `packages/frontend/src/constants/platformCapabilities.ts`.

**Commands never check authentication.** The façade decides, and only reports a problem once nothing
can recover it automatically — an expired access token is refreshed transparently by the provider, so
`NotAuthenticatedError` means a human must redo OAuth. Two paths handle it differently:
`requireUserId()` throws `NotAuthenticatedError`, which `toCommandError()`
(`commands/utils/commandErrors.ts`) maps to a `NOT_AUTHENTICATED` result; mirrored *writes* instead
call `getUnavailableReason()` and log a warning, because a mirror replies in public chat where the
broadcaster's token state doesn't belong.

### Frontend State

React Context for state management: `WebSocketContext` (connection + send/subscribe) and `AppStateContext` (commands, integrations, health). Custom hooks: `useWebSocket()`, `useWebSocketMessage()`, `useCommands()`, `useIntegrations()`.

### HTTP Server

Minimal Node.js `http` server (`server/HttpServer.ts`). Serves static frontend build in production. OAuth callback routes (currently `/callback/twitch` and `/callback/spotify`) are built from each `IOAuthIntegration.getCallbackPath()` via `IntegrationManager.getOAuthCallbackRoutes()`, not hardcoded. Health check at `/health`. Localhost-only binding enforced.

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
- **Commands reach platforms through `StreamControlService`**, never through an integration directly, and never check auth themselves (see Platform Provider Layer).
- **API-backed read commands need a cooldown.** `ICommand.cooldown` is per-viewer seconds; `CommandExecutor` exempts moderators and above, so a shared read/write command (`!game`, `!tags`, `!cw`) can be throttled for viewers without blocking a moderator's write.
- **New integrations** extend `BaseIntegration`, get registered in `setup.ts` (both container + `initializeComponents`), and need a `MessageRouter` handler if they accept WebSocket messages. OAuth-capable integrations also implement `IOAuthIntegration`, override `get oauth()` to return `this`, and need an entry in the frontend's `oauthIntegrationRegistry.tsx` + a config in `oauthProviders.tsx`.
