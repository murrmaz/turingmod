# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: Keep this file updated when adding new major systems or changing module organization. Focus on stable structural information, not implementation details.

## Commands

```bash
# Development (starts both backend + frontend via concurrently)
npm run dev                # Backend on :8080, Frontend on :3000
npm run dev:backend        # Backend only (tsc --watch + node --watch)
npm run dev:frontend       # Frontend only (Vite dev server)

# Building (prebuild runs check + type-check automatically)
npm run build              # Builds shared → backend → frontend (order matters)
npm run build:shared       # Build shared package only

# Code quality
npm run check              # Biome lint + format check
npm run check:fix          # Biome lint + format with auto-fix
npm run type-check         # TypeScript type checking across all workspaces

```

Vitest is configured in both the backend and frontend workspaces (`npm test --workspace @turingmod/backend`, `npm test --workspace @turingmod/frontend`); tests live beside their subjects as `*.test.ts`. Type checking (`npm run type-check`) remains the primary verification step, since coverage is partial.

## Quick Reference: File Locations

Use this to quickly locate files without searching. Organized by system/feature.

### Integration System
- **UI (Table View)**: `packages/frontend/src/components/dashboard/IntegrationStatus.tsx`
- **UI (Card View)**: `packages/frontend/src/components/integrations/IntegrationPanel.tsx`
- **Setup Modal**: `packages/frontend/src/components/integrations/SetupModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Modal**: `packages/frontend/src/components/integrations/OAuthModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Provider Configs**: `packages/frontend/src/components/integrations/oauthProviders.tsx` (per-provider content) + `oauthIntegrationRegistry.tsx` (name → modal/config lookup)
- **Backend Manager**: `packages/backend/src/integrations/IntegrationManager.ts`
- **Dependency graph**: `packages/backend/src/integrations/DependencyGraph.ts` — pure sort/levels/dependents/validate queries over the registered integrations
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
- **DI**: [tsyringe](https://github.com/microsoft/tsyringe) — `@injectable()`/`@singleton()` on class definitions; `registerRootFactories()` in `setup.ts` for the handful of classes tsyringe can't auto-construct
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
- **`packages/backend`** (`@turingmod/backend`) — Node.js server with WebSocket + HTTP. Dev mode runs `tsc --build --watch` and `node --watch dist/index.js` concurrently (not `tsx`: esbuild's TS transform — what `tsx` uses — doesn't emit `emitDecoratorMetadata`, which tsyringe's constructor injection needs).
- **`packages/frontend`** (`@turingmod/frontend`) — React 18 + Vite 6 + Cloudscape Design System. Dev server proxies `/ws` to backend.

### Backend Core Flow

Entry point: `packages/backend/src/index.ts` → calls `registerRootFactories()` and `initializeComponents()` from `setup.ts` → resolves `Application` → `app.initialize()` → `app.start()`.

**Dependency injection** uses [tsyringe](https://github.com/microsoft/tsyringe), Microsoft's lightweight constructor-injection container. Every injectable class is decorated `@injectable()` (and `@singleton()` for app-lifetime singletons, which is effectively all of them); tsyringe resolves a class's dependencies by reading its constructor's typed parameters via `reflect-metadata` — no string tokens, and a typo'd dependency is a compile error, not a runtime "Service not registered" failure. This reflection-based inference requires TypeScript's real compiler (`emitDecoratorMetadata`) to emit `design:paramtypes` — esbuild does not support this, which is why dev mode runs through `tsc --watch` rather than `tsx` (see above).

A handful of classes take primitives or derived values rather than other injectable classes (e.g. `Logger`'s log level, `DatabaseManager`'s file path, `Encryption`'s master password + DB-stored salt, `HttpServer`/`WebSocketServer`'s port/host/allowed-origins) — these can't be auto-constructed from decorated parameters, so they're registered via `container.register(Token, { useFactory: instanceCachingFactory(...) })` in `registerRootFactories()` (`setup.ts`) instead. `instanceCachingFactory` preserves the old container's lazy-singleton semantics, which matters for `Encryption`: its factory reads a salt from the database and must not run before `initializeDatabase()` has created the schema.

Commands remain auto-discovered by directory scan (`loadCommands.ts`): each file's default-exported class is `@injectable()`, and the loader calls `container.resolve(mod.default)` instead of registering it anywhere — tsyringe can construct any `@injectable()` class on demand, so dropping a new command file in `commands/implementations/` still requires no other wiring.

**Message routing**: WebSocket messages arrive at `WebSocketServer` → `MessageRouter` dispatches by `MessageType` → handler classes (`CommandHandler`, `IntegrationHandler`, `OAuthHandler`) process and return response messages.

### Integration System

All integrations extend `BaseIntegration` (`integrations/BaseIntegration.ts`), which implements the `IIntegration` interface (`integrations/interfaces/IIntegration.ts`) and provides shared status/error/event-emitter plumbing. Concrete integrations implement `initialize(config)` → `start()` → `stop()` and call `setStatus()` to report lifecycle transitions; `getStatus()` returns `IntegrationStatus` enum values.

`IntegrationManager` resolves dependencies through `DependencyGraph`, a pure module over the live
registry (`sort`, `levels`, `stopOrder`, `transitiveDependentsOf`, `validate`). Integrations declare
dependencies through `getDependencies()`, which returns **the depended-on integration instances, not
names** — implementations return the very objects they already take in their constructor, so the
declared graph cannot drift from the injected one and a wrong dependency is a compile error. Names
are derived for the wire format. `validateDependencies()` runs once in `setup.ts` after every
registration and rejects unregistered or circular dependencies across the whole graph, not just the
enabled subset.

**Dependency state is maintained, not just checked at start.** `startIntegration()` gates on
dependencies being CONNECTED, and beyond that the manager reacts to status changes:

- A dependency entering ERROR, NEEDS_REAUTH, BLOCKED or DISCONNECTED cascades to its transitive
  dependents, most downstream first. What each dependent *does* is its own choice, declared as
  `dependencyFailurePolicy` (`DependencyFailurePolicy` in `interfaces/IIntegration.ts`):
  - `STOP` (the default) tears it down and records it for restart. Correct for anything holding a
    long-lived connection — `TwitchEventSubIntegration`, `YouTubeChatIntegration` — because a
    dependency failure is evidence about the environment, not just about a token, so a socket
    established under the old conditions can't be assumed valid. Those reconnect and resubscribe
    from scratch.
  - `BLOCK` leaves it running and reports `BLOCKED`. Used by the three API layers, which hold
    nothing bound to the grant. Stopping them is destructive rather than redundant: `stop()` also
    discards unrelated state (`TwitchApiIntegration`'s shoutout cooldowns), so a brief auth blip
    would forget Twitch's global shoutout cooldown.
  - A `BLOCK`-policy integration **must refuse to act while its dependency isn't CONNECTED**, which
    its `resolve*()` gates on. Resolving a client on access protects against holding the *wrong*
    object; it does nothing about holding the right object with dead credentials —
    `markAuthRequired()` sets NEEDS_REAUTH *without* discarding the provider/client.
- A dependency returning to CONNECTED triggers a `reconcile()` pass that recovers both the stopped
  and the blocked dependents — so completing OAuth brings the whole group back on its own. A
  `BLOCKED` integration is started rather than flipped to CONNECTED, which covers "was running" and
  "never started" with one path (for a `BLOCK`-policy integration `start()` is just
  resolve-and-report, so it's cheap and idempotent). One attempt each; a failure drops it from the
  candidates rather than retrying, so a persistently failing `start()` cannot become a restart loop.
  There is deliberately no backoff: a genuinely flapping dependency cascades and recovers once per
  flap. The cost of that is concentrated in the `STOP` dependents, whose resubscribe cycle is the
  expensive part, and a rate-limited restart is currently terminal rather than retried.
- Both directions of that reactive work share one serialization queue (`enqueue()`). A cascade
  running concurrently with a reconcile pass could otherwise call `stopIntegration()` on an
  integration whose `start()` was still in flight, since the dependency checks either side of an
  `await` don't hold across it. A start requested directly from the console still races the queue;
  that wants a per-integration lifecycle lock.
- An unmet dependency is reported as `IntegrationStatus.BLOCKED`, not ERROR — nothing is broken, a
  prerequisite is off — via `reportBlocked()`.

**Status is persisted in one place**: the `'status'` listener in `register()`. Integrations own their
own status; `startIntegration`/`stopIntegration` no longer write it, which is what let the stored row
disagree with `getStatus()`.

Startup and shutdown both work in dependency *levels* (`DependencyGraph.levels()`), concurrent within
a level and reversed for shutdown, with a per-integration start timeout
(`IntegrationManager.START_TIMEOUT_MS`) so one integration that never settles can't hang boot.

**API-layer integrations resolve their dependency's client on access, not at `start()`.**
`TwitchApiIntegration`, `YouTubeApiIntegration` and `SpotifyApiIntegration` compare the auth
integration's current provider/client/credentials against the one their cached client was built on
and rebuild when it changed, so a stale reference can't exist in the first place. This makes the
auth accessors (`getAuthProvider()`, `getAuthClient()`) contractually obliged to return a *stable*
instance rather than a new object per call. The cascade above still matters for the long-lived
listeners — `TwitchEventSubIntegration`'s EventSub WebSocket and `YouTubeChatIntegration`'s stream
own their provider for their lifetime and cannot be re-pointed.

**Twitch** is split into three integrations following SRP: `TwitchAuthIntegration` (OAuth) → `TwitchApiIntegration` (Helix API) → `TwitchEventSubIntegration` (real-time events). **YouTube** follows the same three-part shape: `YouTubeAuthIntegration` → `YouTubeApiIntegration` → `YouTubeChatIntegration`. Spotify has an auth/api split only: `SpotifyAuthIntegration` → `SpotifyApiIntegration`. Discord, OBS, Arduino, and Sound are single-file integrations with no auth/api split.

**YouTube chat streams over the official client, via a method that is easy to miss.** The server-streaming live chat RPC is exposed by `googleapis` as `client.youtube.v3.liveChat.messages.stream()` — note that it is named `stream`, not `streamList` (its gRPC name), and that it hangs off a separate nested resource rather than the top-level `client.liveChatMessages` that holds `list`/`insert`/`delete`. Searching for `streamList`, or looking only at `liveChatMessages`, finds nothing and produces the false conclusion that the method is gRPC-only and needs a hand-rolled client. It does not: this project carried a vendored `stream_list.proto` and a `@grpc/proto-loader` client on exactly that mistake until it was removed.

`YouTubeChatStream` requests it with `responseType: 'stream'` and `timeout: 0`, then splits the body with `JsonFrameParser` (`parseJsonFrames.ts`). Both details are load-bearing. Awaiting the ordinary overload buffers the whole response, so messages would only arrive once the broadcast ended; any timeout would cut a multi-hour stream short. Discovery types the response as a single `LiveChatMessageListResponse` — a code-generator artifact, since the generator emits `response.$ref` identically for unary and streaming methods — so that type describes **one frame** and says nothing about how frames are delimited. `JsonFrameParser` therefore scans for balanced top-level objects instead of assuming a delimiter, which decodes a chunked JSON array, newline-delimited JSON, and bare concatenated objects alike.

`YouTubeChatIntegration` has no periodic timers. It idles until a go-live signal — OBS's `obs.stream.stateChanged` (`OBS_WEBSOCKET_OUTPUT_STARTED`), or a `youtube.goLive` message from the console — then resolves the broadcast's `liveChatId` with a bounded retry (a broadcast doesn't expose one until YouTube transitions it to `live`) and opens the stream. Its `idle → resolving → streaming` transitions are broadcast to the frontend as `YOUTUBE_CHAT_STATE`.

OAuth-capable integrations (currently `TwitchAuthIntegration`, `SpotifyAuthIntegration`) additionally implement `IOAuthIntegration` (`integrations/interfaces/IOAuthIntegration.ts`) and expose it via a `get oauth()` getter (`null` on `BaseIntegration` by default). This is the single source of truth for OAuth capability — `IntegrationManager`/`HttpServer` derive callback routing and the frontend's OAuth affordance from it instead of checking integration names.

Cross-integration communication uses `EventBus` (`core/EventBus.ts`) — a simple pub/sub with sync and async emit.

**Status changes are the integration→UI channel, not per-provider events.** `setStatus()` → the
`'status'` listener in `IntegrationManager.register()` → `integration:status` on the bus →
`Application.setupEventHandlers()` broadcasts `INTEGRATION_STATUS` → `AppStateContext`. A new status
(like `BLOCKED`) reaches the console through that path with no extra wiring, carrying its reason in
`errorMessage`. Don't add a per-provider `*.ready` event for this: eight such emits
(`twitch.auth.ready`, `twitch.api.ready`, the Spotify/YouTube equivalents, and two
`*.auth.token-refreshed`) were removed as redundant with it — and the `*.ready` ones published live
auth providers and API clients onto the bus, which is exactly the stale-reference trap the
resolve-on-access change above eliminates.

A token refresh is the one thing status *can't* express (the integration stays CONNECTED through
it), so it has its own forward: `BaseIntegration.reportTokenRefreshed(expiresAt?)` →
`'token-refreshed'` → logged and republished as `integration:token-refreshed` with
`{ name, expiresAt? }`. It carries no credentials by design — anything needing the token asks the
integration on access.

### WebSocket Protocol

All messages follow `IWebSocketMessage<T>` from `packages/shared/src/protocol/messages.ts`: `{ id, type, timestamp, payload }`. Message IDs are UUIDs used for request/response correlation. Use `createMessage()` and typed creator functions (e.g., `createCommandResultMessage()`) to construct messages.

### Database

`node:sqlite` (`DatabaseSync`, file-backed, WAL mode) — chosen over `better-sqlite3` to avoid reintroducing a native-compilation dependency. Every write commits durably as it happens; there is no in-memory buffering or periodic flush to lose writes or corrupt the file on crash. Access via repository pattern: `UserRepository`, `CommandHistoryRepository`, `IntegrationStateRepository`. Integration configs are encrypted with AES-256-GCM before storage.

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
- **`getDependencies()` returns integration instances**, not names — return the constructor-injected
  objects so the graph can't drift. Unmet dependencies are `BLOCKED`, not `ERROR`.
- **A new integration with a dependency should consider `dependencyFailurePolicy`.** It defaults to
  `STOP`, which is the safe answer; only override to `BLOCK` if the integration holds nothing bound
  to the dependency and gates its work on the dependency's status.
- **Accessors a dependent caches against must return a stable instance** (`getAuthProvider()`,
  `getAuthClient()`) — the API layers compare the reference to decide whether to rebuild, so
  returning a fresh object per call makes them rebuild on every access.
- **Integration lifecycle** — always call `initialize(config)` before `start()`.
- **New commands** go in `packages/backend/src/commands/implementations/` and implement `ICommand`. They're auto-discovered by `loadCommands()`.
- **Commands reach platforms through `StreamControlService`**, never through an integration directly, and never check auth themselves (see Platform Provider Layer).
- **API-backed read commands need a cooldown.** `ICommand.cooldown` is per-viewer seconds; `CommandExecutor` exempts moderators and above, so a shared read/write command (`!game`, `!tags`, `!cw`) can be throttled for viewers without blocking a moderator's write.
- **New integrations** extend `BaseIntegration`, get decorated `@injectable()`/`@singleton()`, get registered with `IntegrationManager` in `setup.ts`'s `initializeComponents()`, and need a `MessageRouter` handler if they accept WebSocket messages. OAuth-capable integrations also implement `IOAuthIntegration`, override `get oauth()` to return `this`, and need an entry in the frontend's `oauthIntegrationRegistry.tsx` + a config in `oauthProviders.tsx`.
