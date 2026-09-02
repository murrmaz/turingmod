# QWEN.md

Guidance for AI agents working in this repository. This complements `CLAUDE.md`,
which is the authoritative architecture reference — read it for the full deep-dive
into every subsystem before making structural changes.

## Project Overview

**TuringMod** is a local Twitch streamer tool: chat commands, third-party
integrations, and a web UI, all running on the user's own machine. It is a
TypeScript **monorepo** using npm workspaces, organized into three packages:

- **`packages/shared`** (`@turingmod/shared`) — shared types and the WebSocket
  message protocol (`IWebSocketMessage<T>`, creator functions, enums). No
  runtime deps; built to `dist/` and consumed by both backend and frontend.
- **`packages/backend`** (`@turingmod/backend`) — Node ESM server. Runs
  integrations, chat commands, a WebSocket server, and an sql.js database.
  Runs in dev via `tsx watch`; built with `tsc`.
- **`packages/frontend`** (`@turingmod/frontend`) — React 19 + Vite UI using
  `@cloudscape-design/components` (AWS Console Design System).

### Core architectural facts

- **Localhost only.** Every server binds to `127.0.0.1`, never `0.0.0.0`. This
  is a hard constraint, not a preference.
- **No REST API.** All frontend ↔ backend communication is over **WebSocket**.
  The HTTP server (`server/HttpServer.ts`) exists only to serve the static
  frontend build, expose `/health`, and handle OAuth callback routes
  (e.g. `/callback/twitch`, `/callback/spotify` — derived per-integration, not
  hardcoded).
- **Database:** sql.js (WASM SQLite, no native compilation). `DatabaseManager`
  auto-saves every 5s if dirty; access is via a repository pattern. Integration
  configs are encrypted with AES-256-GCM before storage. Migrations run
  automatically on startup.
- **DI + events:** a manual DI `Container`, a pub/sub `EventBus` (sync + async
  emit) used for cross-integration communication, and an `Application`
  bootstrap (`core/Application.ts`). Entry point is `src/index.ts` → `src/setup.ts`.

## Building and Running

Node `>=18` (repo pins LTS via `.nvmrc`), npm `>=9`.

```bash
npm install          # install all workspaces (also wires up husky via prepare)

npm run dev          # run backend (tsx watch) + frontend (vite) together
npm run dev:backend  # backend only
npm run dev:frontend # frontend only

npm run build        # build shared → backend → frontend (prebuild runs `npm run check`)
npm run start        # run the built backend (node dist/index.js)

npm run type-check   # tsc --noEmit across all workspaces
npm run clean        # remove dist/ and *.tsbuildinfo
```

Build order matters: `shared` must build before `backend`/`frontend` consume it.

## Testing

- **Unit tests:** Vitest, per-workspace. `npm run test` runs every workspace that
  has tests (integration tests live next to their sources, e.g.
  `integrations/IntegrationManager.test.ts`, `commands/...`). Target a single
  package with `npm run test -w @turingmod/backend`.
- **E2E:** Playwright is configured (helpers in `scripts/playwright/`).
- **Type check is a gate:** `npm run type-check` (and `npm run check`) should be
  green before considering work done.

## Linting and Formatting

- **Biome** handles both linting and formatting — **not** ESLint/Prettier.
  Config lives in `biome.json`.
- Style: line width 100, single quotes, semicolons always, trailing commas (es5).
  Naming: `camelCase`/`PascalCase` functions, `PascalCase` classes/interfaces,
  `CONSTANT_CASE` enum members.
- Commands: `npm run lint`, `npm run format`, `npm run check`, and the `:fix`
  variants.
- A **Husky + lint-staged** pre-commit hook runs `biome check --write` on staged
  TS/JS/JSON files. Don't bypass it with `--no-verify`; fix the findings.

## Development Conventions

### TypeScript (stricter than default `strict`)

- `exactOptionalPropertyTypes: true` — to set an optional property to "absent"
  you must assign `undefined` explicitly, not just omit it.
- `noUncheckedIndexedAccess: true` — indexed access returns `T | undefined`;
  handle the `undefined` case.
- ESM throughout (`"type": "module"`). **Backend source imports use `.js`
  extensions** (NodeNext resolution); the frontend uses `bundler` resolution.

### Integrations (`packages/backend/src/integrations/`)

- Always **call `initialize(config)` before `start()`**.
- Never use string literals for status — use the `IntegrationStatus` enum.
- All integrations extend `BaseIntegration` (shared status/error/emitter
  plumbing). Implementations live in `integrations/implementations/`:
  - Twitch: `TwitchApiIntegration`, `TwitchAuthIntegration`, `TwitchEventSubIntegration`
  - YouTube: `YouTubeApiIntegration`, `YouTubeAuthIntegration`, `YouTubeChatIntegration`
    (gRPC chat stream — see note below)
  - Spotify: `SpotifyApiIntegration`, `SpotifyAuthIntegration`
  - `ObsIntegration`, plus `DiscordIntegration` / `ArduinoIntegration` /
    `SoundIntegration` (some of these are stubs — check `TODO`s; several still
    report `CONNECTED` without a real connection behind them).
- **Adding a new integration:** extend `BaseIntegration`, register it in
  `src/setup.ts` (both the DI container and `initializeComponents`), and add a
  `MessageRouter` handler if it accepts WebSocket messages.
- **OAuth-capable integrations** additionally implement `IOAuthIntegration` and
  override `get oauth()` to return `this` (it's `null` on `BaseIntegration`).
  This getter is the single source of truth for OAuth capability — do not infer
  OAuth support from integration names. Frontend side needs an entry in
  `oauthIntegrationRegistry.tsx` and a config in `oauthProviders.tsx`.

### Commands (`packages/backend/src/commands/`)

- Implement `ICommand` and drop the file in `commands/implementations/` —
  they are auto-discovered by `loadCommands()`. No manual registration.
- Existing: `Ad`, `Bonk`, `ContentWarning`, `Game`, `Schedule`, `Tags`, `Title`,
  `Uptime`, `Who`.

### WebSocket protocol (`packages/shared/src/protocol/messages.ts`)

- Every message is `IWebSocketMessage<T>`: `{ id, type, timestamp, payload }`.
  IDs are UUIDs used for request/response correlation.
- **Always construct messages with `createMessage()` / the typed creator
  functions** (e.g. `createCommandResultMessage()`) rather than raw literals —
  this is what keeps payload-shape changes compile-time safe. (Note: some
  existing call sites still build raw literals; prefer the creators.)

### Frontend (`packages/frontend/src/`)

- State via React Context: `WebSocketContext` (connect + send/subscribe) and
  `AppStateContext` (commands, integrations, health).
- Custom hooks under `hooks/`: `useWebSocket`, `useWebSocketMessage`,
  `useCommands`, `useIntegrations`, `useIntegrationActions`.
- Components use `@cloudscape-design/components`.

### YouTube chat streaming (special case)

The server-streaming live chat RPC **is** in the official client, at
`client.youtube.v3.liveChat.messages.stream()`. It is easy to miss: it is named
`stream` (not `streamList`, its gRPC name) and lives on a nested resource, not on
the top-level `client.liveChatMessages`. Do not conclude from a failed search that
it is gRPC-only and needs a vendored proto — this project carried one on exactly
that mistake until it was removed.

`YouTubeChatStream` calls it with `responseType: 'stream'` and `timeout: 0`, then
splits the body with `JsonFrameParser` (`parseJsonFrames.ts`), which scans for
balanced top-level JSON objects rather than assuming a delimiter. Awaiting the
ordinary overload instead would buffer the entire response and deliver messages
only once the broadcast ended.
