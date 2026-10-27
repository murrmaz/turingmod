# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: Keep this file updated when adding new major systems or changing module organization. Focus on stable structural information, not implementation details.
>
> Deep dives into single subsystems live in `CLAUDE.md` files beside their code (`packages/backend/src/integrations/`, `packages/backend/src/platforms/`), which Claude Code loads when you work in those directories. Keep them updated with their code, and keep this file to what every session needs.

## Commands

```bash
# Development (starts both backend + frontend via concurrently)
npm run dev                # Backend on :8080 (SERVER_PORT), Frontend on :3000 (proxies /trpc)
npm run dev:backend        # Backend only (tsc --watch + node --watch)
npm run dev:frontend       # Frontend only (Vite dev server)

# Building (prebuild runs `npm run check` automatically)
npm run build              # Builds shared → backend → frontend (order matters)
npm run build:shared       # Build shared package only

# Code quality
npm run check              # Biome lint + format check
npm run check:fix          # Biome lint + format with auto-fix
npm run type-check         # TypeScript type checking across all workspaces (build shared first)

# Tests
npm test                   # Vitest in every workspace
npm test -w @turingmod/backend   # one workspace (also @turingmod/frontend, @turingmod/shared)
```

Vitest is configured in all three workspaces; tests live beside their subjects as `*.test.ts`. On a fresh checkout, run `npm run build:backend` (which builds shared too) before `type-check` or the frontend/backend tests: both import `@turingmod/shared` from its `dist/`, and the frontend type-checks its tRPC client against the backend's router type in `packages/backend/dist/` (`@turingmod/backend/trpc`), so a backend change to a procedure reaches the console's types only once the backend is rebuilt (if `dist/` was deleted but `tsconfig.tsbuildinfo` wasn't, `tsc --build` thinks it's up to date and does nothing: `npm run clean` first). There is no CI: run `check`, `type-check` and `test` before considering work done.

## Quick Reference: File Locations

Use this to quickly locate files without searching. Organized by system/feature.

### Integration System
- **UI**: `packages/frontend/src/features/integrations/integrations-page.tsx` (dependency chains + detail panel with Start/Stop/Authorize) + `features/dashboard/health-rail.tsx` (the dashboard's Needs attention cards and status list); status wording in `src/lib/integrationStatus.ts`
- **OAuth flow**: `packages/frontend/src/components/integrations/OAuthFlow.tsx` — `OAuthFlowProvider` renders the setup → authorize dialogs once for the whole console; pages start it with `useOAuthFlow().authorize(integration)`. Provider configs are looked up from the registry below
- **Setup Modal**: `packages/frontend/src/components/integrations/SetupModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Modal**: `packages/frontend/src/components/integrations/OAuthModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Provider Configs**: `packages/frontend/src/components/integrations/oauthProviders.tsx` (per-provider content) + `oauthIntegrationRegistry.tsx` (name → provider config lookup)
- **Non-OAuth setup dialogs**: `packages/frontend/src/components/integrations/configIntegrationRegistry.tsx` (name → dialog, shown as Set up on the Integrations page), e.g. `DiscordSetupModal.tsx`; every setup dialog, OAuth credentials included, is built on `IntegrationConfigDialog.tsx` (form, save, error, Cancel/Save)
- **Backend Manager**: `packages/backend/src/integrations/IntegrationManager.ts`
- **OAuth flow**: `packages/backend/src/integrations/OAuthFlowService.ts` — authorization URL, single-use `state`, callback routes, and `handleCallback()`, which exchanges the code on the backend when the provider redirects (no console needs to be open) and announces the result to every console (`oauth.results`, tRPC); the callback page then closes itself (popup) or returns to the console that asked. Client credentials come only from the console's setup dialog (stored encrypted), never from `.env`; `IntegrationInfo.oauth.configured` tells the console whether to open setup or authorization
- **Dependency graph**: `packages/backend/src/integrations/DependencyGraph.ts` — pure sort/levels/dependents/validate queries over the registered integrations
- **Base Class**: `packages/backend/src/integrations/BaseIntegration.ts` — shared status/error/event-emitter plumbing; all integrations extend this
- **OAuth base class**: `packages/backend/src/integrations/OAuthIntegration.ts` — `OAuthIntegration<TConfig>` (extends `BaseIntegration`): credentials, redirect URI, token persistence, and the no-token / missing-scope checks before connecting; `StandardOAuthIntegration.ts` beneath it, for a provider used through its OAuth 2.0 endpoints (Twitch, Spotify): the authorization URL and code exchange from two endpoints, and the shared stored-token schema
- **API layer base class**: `packages/backend/src/integrations/AuthorizedApiIntegration.ts` — `AuthorizedApiIntegration<TAuth, TClient>` (extends `BaseIntegration`): the auth dependency, `BLOCK` policy, refusing to call while auth isn't CONNECTED, and `request()`; `ClientCache.ts` rebuilds a client when its auth object is replaced
- **Interfaces**: `packages/backend/src/integrations/interfaces/IIntegration.ts`, `IOAuthIntegration.ts` (extends `IIntegration` for OAuth-capable integrations)
- **Implementations**: `packages/backend/src/integrations/implementations/*/` (Twitch, YouTube, Spotify, OBS, Sound, Discord, Arduino)
- **Arduino**: `packages/backend/src/integrations/implementations/arduino/ArduinoIntegration.ts` (WebSocket client to a Wi-Fi board) + `arduinoProtocol.ts` (message schemas); the protocol spec and a reference ESP32 sketch for the firmware side are in `firmware/` (`firmware/README.md`)
- **YouTube chat stream client**: `packages/backend/src/integrations/implementations/youtube/YouTubeChatStream.ts` + the response frame splitter `parseJsonFrames.ts` beside it
- **Console API**: `packages/backend/src/server/trpc/integrationsRouter.ts` (tRPC: `integrations.watch` subscription, `start`/`stop`/`configure`), `youtubeChatRouter.ts` (`youtubeChat.watch`, `goLive`/`goOffline`), `liveStateRouter.ts` (`liveState.watch`), `oauthRouter.ts` (`oauth.authorizationUrl`, `oauth.results`)
- **Types & Enums**: `packages/shared/src/types/integration.ts`

### Commands System
- **Interface**: `packages/backend/src/commands/interfaces/ICommand.ts`
- **Implementations**: `packages/backend/src/commands/implementations/*.ts`
- **Loader**: `packages/backend/src/commands/loadCommands.ts`
- **Results**: `packages/backend/src/commands/utils/results.ts` — `ok()`, `fail()`, and `mirrorReply()` for title/game/tags writes
- **Parser**: `packages/backend/src/commands/parseCommand.ts` — the one place command text becomes a name and arguments, for chat and the simulator alike
- **Console API**: `packages/backend/src/server/trpc/commandsRouter.ts` (tRPC: `commands.list`, `commands.simulate`)

### Platform Provider Layer
- **Interface**: `packages/backend/src/platforms/interfaces/IStreamPlatform.ts` — platform-agnostic façade; per-capability objects (`CapabilityApis`) are optional
- **Capability sets**: `packages/backend/src/platforms/capabilities.ts` — `capabilitiesOf()`, derived from the objects a façade has
- **Implementations**: `packages/backend/src/platforms/TwitchPlatform.ts`, `YouTubePlatform.ts`
- **Registry**: `packages/backend/src/platforms/PlatformRegistry.ts` (Platform → façade)
- **Mirroring/reads**: `packages/backend/src/platforms/StreamControlService.ts` — the seam commands depend on
- **Auth reporting**: `packages/backend/src/platforms/availability.ts` (`unavailableReason`) + `errors.ts` (`NotAuthenticatedError`)
- **Availability events**: `packages/backend/src/platforms/PlatformAvailability.ts` — publishes `platform.availability` when a façade becomes usable or stops being usable
- **Display names**: `platformDisplayName()` / `formatPlatformList()` in `packages/shared/src/constants/platform.ts` (shared with the console)

### Channel Point Rewards & Raids
- **Handler interface**: `packages/backend/src/rewards/interfaces/IRewardHandler.ts`
- **Handlers**: `packages/backend/src/rewards/implementations/*.ts` — auto-discovered by `rewards/loadRewardHandlers.ts`
- **Routing**: `packages/backend/src/rewards/RewardRouter.ts` (redemption → handler by title, then fulfil/refund) + `RewardRegistry.ts`
- **Reward sync**: `packages/backend/src/rewards/RewardSync.ts` — creates/corrects each handler's reward on Twitch and pauses it during breaks
- **Raid shoutout**: `packages/backend/src/raids/RaidShoutout.ts`
- **Shared directory loader**: `packages/backend/src/utils/importImplementations.ts` (used by both commands and rewards)

### Facecam Effects
- **Runner**: `packages/backend/src/effects/FacecamEffectRunner.ts` — finds the facecam, serializes effects, restores afterwards
- **Effect contract**: `packages/backend/src/effects/FacecamEffect.ts`; anchor/position math in `transformMath.ts`
- **Effects**: `packages/backend/src/effects/facecam/facecamEffects.ts` (+ `animate.ts`)
- **Settings**: `packages/backend/src/effects/effectSettings.ts`, stored under the `effects` key

### Sound
- **Library**: `packages/backend/src/sounds/SoundLibrary.ts` — plays clips by name from the library directory
- **Clip names**: `packages/backend/src/sounds/clips.ts`; settings in `soundSettings.ts`, stored under the `sounds` key
- **Playback**: `packages/backend/src/integrations/implementations/sound/SoundIntegration.ts` (per-OS player processes)

### Chat
Everything that consumes or produces chat lives under `packages/backend/src/chat/`: the pipeline at the top level, and the chat features in a folder each.
- **Message shape**: `chat/chatMessage.ts` — `ChatMessageEvent` and `toSafeChatText` (applied by every façade to outgoing chat)
- **Own-message gate**: `chat/OwnChatMessages.ts` — records sent message ids; republishes `chat.received` as `chat.message` minus TuringMod's own
- **Chat routing**: `chat/ChatRouter.ts` (moderate → parse → execute → reply)
- **Moderation**: `chat/moderation/ChatModerator.ts` (banned words, quiet mode) + `bannedWords.ts` (matching, 30-day expiry)
- **Interval messages**: `chat/announcements/IntervalAnnouncer.ts`
- **Clip collection**: `chat/clips/ClipCollector.ts`
- **Lurk list**: `chat/lurk/LurkTracker.ts` (in memory; welcomes lurkers back when they chat)

### Going Live
- **OBS stream state**: `packages/backend/src/live/ObsStreamState.ts` — whether OBS is streaming; publishes `stream.output.changed`, platform-neutral
- **YouTube chat auto-connect**: `packages/backend/src/live/YouTubeChatAutoConnect.ts` — connects YouTube chat while OBS streams
- **Platform live state**: `packages/backend/src/live/PlatformLiveStatus.ts` — whether each platform is live and since when, sent to the console through `liveState.watch` (`onChange()`) and published on the bus as `platform.liveState` on going live/offline; event-driven, never polled
- **Discord go-live post**: `packages/backend/src/live/GoLiveAnnouncer.ts` (when to post, edit and end) + `goLivePost.ts` (what it says, and the stored shape); the open post is kept by `database/repositories/GoLivePostRepository.ts`; sent through `integrations/implementations/discord/DiscordIntegration.ts` (bot token over REST)

### Stream Breaks
- **Lifecycle**: `packages/backend/src/breaks/BreakService.ts` — starts/extends/ends breaks; listens for `twitch.ad.break`; emits `stream.break.started`/`.ended`
- **OBS overlay**: `packages/backend/src/breaks/ObsBreakOverlay.ts` — snapshot/apply/restore across all canvases, scenes and groups
- **OBS scene walking**: `packages/backend/src/integrations/implementations/obs/sceneGraph.ts` — every scene on every canvas, and every item in a scene including inside its groups (shared by breaks and effects)
- **Ad pre-warnings**: `packages/backend/src/breaks/AdWarningScheduler.ts`
- **Settings**: `packages/backend/src/breaks/breakSettings.ts` (schema and defaults, `BREAK_SETTINGS`), stored under the `breaks` key via `database/repositories/SettingsRepository.ts`
- **Owed restore**: `packages/backend/src/database/repositories/ObsBreakRestoreRepository.ts` — what a break changed in OBS, kept until it has been put back
- **Manual trigger**: `packages/backend/src/commands/implementations/BreakCommand.ts` (`!break`)

### Activity Log
- **Forwarder**: `packages/backend/src/activity/ActivityForwarder.ts` — maps EventBus events to activity categories (`EVENT_CATEGORIES`), hands each to the console's live feed (`onEntry()`) and persists all but chat and `LIVE_ONLY_EVENTS` (device messages)
- **Storage**: `packages/backend/src/database/repositories/ActivityLogRepository.ts` (capped at 5000 rows)
- **Live feed**: `packages/backend/src/server/trpc/activityRouter.ts` (`activity.feed`: the stored recent entries, then each entry as it's made); the History page reads the stored log through the data inspector
- **Frontend**: `features/dashboard/dashboard-page.tsx` + `hooks/useLiveLog.ts` (live feed, newest first), `features/history/history-page.tsx`; how an entry reads (feed category, badge, title, detail) is `constants/activityFormat.ts` (`toFeedRow`)

### Console ↔ Backend Protocol
- **tRPC router**: `packages/backend/src/server/trpc/appRouter.ts` (`createAppRouter()`, `AppRouter` type) — one sub-router per area, e.g. `integrationsRouter.ts`; `trpc.ts` (instance and `TrpcContext`), `watch.ts` (`watchable()`: current value, then again on each change, read once per change for every console; `events()`: a stream of events, subscribed at once so a snapshot read beside it misses nothing)
- **tRPC endpoint**: `packages/backend/src/server/trpc/TrpcServer.ts` (`TRPC_PATH`); `HttpServer.routeUpgrades()` hands a WebSocket path its endpoint; `server/consoleSockets.ts` (console-only origin check, upgrades, closing with a grace period)
- **tRPC client**: `packages/frontend/src/context/TrpcContext.tsx` (`TrpcProvider`, `useTrpc()`, `useConnection()`; `RouterInputs`/`RouterOutputs` name a procedure's input and output types), `services/trpcLinks.ts` (fail requests while disconnected), `services/connection.ts` (connection state, retry schedule, `ConnectionError`)
- **Reading from the backend**: `packages/frontend/src/hooks/useSubscription.ts` (state kept current by a `watch` subscription, or built from an event stream with `reduce`), `hooks/useServerQuery.ts` (a query, read on connect and on each new input)

### Database
- **Manager**: `packages/backend/src/database/DatabaseManager.ts`
- **Repositories**: `packages/backend/src/database/repositories/*.ts`
- **Migrations**: `packages/backend/src/database/migrations/*.ts`, listed in `migrations/index.ts` (`ALL_MIGRATIONS`), run automatically on startup
- **Read-only inspector**: `packages/backend/src/database/DataInspector.ts` (allow-listed tables, masked secrets) + `server/trpc/dataRouter.ts`; query shape and result types in `shared/src/types/data.ts`; console side `packages/frontend/src/features/data/`

### Core Infrastructure
- **DI**: [tsyringe](https://github.com/microsoft/tsyringe) — `@singleton()` on app-lifetime classes, `@injectable()` on commands and reward handlers; `registerRootFactories()` in `setup.ts` for the handful of classes tsyringe can't auto-construct
- **EventBus**: `packages/backend/src/core/EventBus.ts`; every event name and payload type in `core/events.ts` (`EventMap`)
- **Application**: `packages/backend/src/core/Application.ts`
- **Feature service lifecycle**: `packages/backend/src/core/ServiceLifecycle.ts` (`IService`, `Subscriptions`); the ordered service list is in `setup.ts`
- **Setup/Bootstrap**: `packages/backend/src/setup.ts`
- **Entry Point**: `packages/backend/src/index.ts`
- **Environment**: `packages/backend/src/utils/loadEnv.ts` loads the repository-root `.env` (template: `.env.example`); it's the first import of the entry point (`index.ts`). Shell variables win over the file. `TuringModConfig` (`utils/Config.ts`) is what reads them, through one Zod schema (`parseEnvironment()`): a blank variable gets its default, an invalid one stops startup with a `ConfigurationError` naming it, and only `MASTER_PASSWORD` is required. The file's location is `ENV_FILE` (`utils/paths.ts`).

### Frontend State
- **App State Context**: `packages/frontend/src/context/AppStateContext.tsx`
- **Integration Hooks**: `packages/frontend/src/hooks/useIntegrations.ts`
- **Integration actions**: `packages/frontend/src/hooks/useIntegrationActions.ts` (Start/Stop/OAuth/Reconnect decisions, shared by the Integrations page and the dashboard)
- **Command Hooks**: `packages/frontend/src/hooks/useCommands.ts`
- **YouTube chat control**: `packages/frontend/src/hooks/useYouTubeChat.ts`, in the YouTube badge's menu in `components/site-header.tsx`
- **Platform live badges**: `packages/frontend/src/hooks/usePlatformLiveState.ts`; backend `live/PlatformLiveStatus.ts` + `server/trpc/liveStateRouter.ts`

## Architecture

npm workspaces monorepo with three packages:

- **`packages/shared`** (`@turingmod/shared`) — what the backend and the console both run or both name: enums (`IntegrationStatus`, `PermissionLevel`, `StreamingPlatform`), Zod schemas both sides validate with (setup-dialog configs, `ActivityLogEntrySchema`), constants and small helpers (`TRPC_PATH`, `platformDisplayName()`, `messageOf()`), and the domain types procedures return (`IntegrationInfo`, `DataTableInfo`). Not the protocol: request and response shapes are tRPC procedures in the backend. Must be built first since both other packages depend on it.
- **`packages/backend`** (`@turingmod/backend`) — Node.js server with WebSocket + HTTP. Its package exports only the tRPC router's type (`@turingmod/backend/trpc`), so the console never bundles backend code. Dev mode runs `tsc --build --watch` and `node --watch dist/index.js` concurrently (not `tsx`: esbuild's TS transform — what `tsx` uses — doesn't emit `emitDecoratorMetadata`, which tsyringe's constructor injection needs).
- **`packages/frontend`** (`@turingmod/frontend`) — React 19 + React Router 7 + Vite 8 + shadcn/ui on Tailwind CSS v4 + TanStack Table. Dev server proxies `/trpc` to backend.

### Backend Core Flow

Entry point: `packages/backend/src/index.ts` → calls `registerRootFactories()`, `initializeDatabase()` (open, migrate, validate every settings group) and `initializeComponents()` from `setup.ts` → resolves `Application` → `app.initialize()` (apply stored integration configs) → `app.start()`.

**Dependency injection** uses [tsyringe](https://github.com/microsoft/tsyringe), Microsoft's lightweight constructor-injection container. App-lifetime classes (integrations, services, façades, handlers — effectively everything) are decorated `@singleton()` alone, which makes a class injectable and registers it as a singleton, so adding `@injectable()` beside it is redundant; commands and reward handlers, which their loaders resolve once each, are `@injectable()`; tsyringe resolves a class's dependencies by reading its constructor's typed parameters via `reflect-metadata` — no string tokens, and a typo'd dependency is a compile error, not a runtime "Service not registered" failure. This reflection-based inference requires TypeScript's real compiler (`emitDecoratorMetadata`) to emit `design:paramtypes` — esbuild does not support this, which is why dev mode runs through `tsc --watch` rather than `tsx` (see above).

A handful of classes take primitives or derived values rather than other injectable classes (e.g. `Logger`'s log level, `DatabaseManager`'s file path, `Encryption`'s master password + DB-stored salt, `HttpServer`'s port/host and `TrpcServer`'s router/allowed-origins) — these can't be auto-constructed from decorated parameters, so they're registered via `container.register(Token, { useFactory: instanceCachingFactory(...) })` in `registerRootFactories()` (`setup.ts`) instead. `instanceCachingFactory` makes each factory lazy and run-once, like a singleton, which matters for `Encryption`: its factory reads a salt from the database and must not run before `initializeDatabase()` has created the schema.

Commands are auto-discovered by directory scan (`loadCommands.ts`): each file's default-exported class is `@injectable()`, and the loader calls `container.resolve(mod.default)` instead of registering it anywhere — tsyringe can construct any `@injectable()` class on demand, so dropping a new command file in `commands/implementations/` requires no other wiring. Reward handlers are loaded the same way (`loadRewardHandlers.ts`).

**Feature services** (chat routing, rewards, breaks, effects, announcers — anything that isn't an
integration but subscribes to the bus or holds timers) implement `IService` and are added, in
order, to `ServiceLifecycle` in `setup.ts`. `Application` starts them before integrations, so a
subscriber sees the `platform.availability` changes that connecting causes, and stops them in
reverse before integrations, so a service can still reach OBS or Twitch to undo what it did.
Triggers (chat, redemptions, raids) go last in the list so they stop first: nothing new can start a
break or an effect while those are being restored. Each service keeps its bus subscriptions in a
`Subscriptions` and clears them in `stop()`.

**Console requests**: the console calls procedures on the tRPC router (`server/trpc/appRouter.ts`), served at `TRPC_PATH` by `TrpcServer`; each procedure's Zod input schema is checked before it runs, so procedures never check input shape themselves, and a malformed input is a `BAD_REQUEST` naming the bad fields. See Console ↔ Backend Protocol below.

**EventBus.** Integrations, services and the server communicate through `EventBus` (`core/EventBus.ts`) — a simple pub/sub with sync and async emit.
`emit()` calls handlers in subscription order but runs async ones concurrently, and resolves once
all have settled; a failing handler is logged, never propagated. No handler may depend on another
having run first.
It is typed against `EventMap` (`core/events.ts`), which declares every event name and its payload
type once, so an emitter and its subscribers can't drift apart. A new event is a new `EventMap` entry;
don't declare a payload type beside its emitter or consumer. Names are dot-separated camelCase
segments, most general first (`twitch.channelPoint.redemption`, `integration.tokenRefreshed`).

### Integration System

All integrations extend `BaseIntegration` (OAuth providers extend `OAuthIntegration`) and are run by
`IntegrationManager`, which starts them in dependency order, cascades a dependency's failure to its
dependents and brings them back when it recovers. **Twitch** and **YouTube** are each split into auth
→ API → real-time (`TwitchEventSubIntegration`, `YouTubeChatIntegration`), Spotify into auth → API;
OBS, Sound, Discord and Arduino are single integrations. The status an
integration sets is what the console shows (`integration.status` → the `integrations.watch`
subscription).

How all of this works (stored configs and their schemas, `enabled`, dependency cascades and
`dependencyFailurePolicy`, resolving clients on access, YouTube's chat stream, OAuth and token
refresh, integration events) is in
[`packages/backend/src/integrations/CLAUDE.md`](packages/backend/src/integrations/CLAUDE.md), which
Claude Code loads when you work in that directory. Read it before changing an integration or
anything that holds one of their clients.

### Console ↔ Backend Protocol

The console talks to the backend over one WebSocket, the tRPC router at `TRPC_PATH` (`/trpc`) on
the backend's one port. A request is one procedure in a sub-router of `createAppRouter()`
(`server/trpc/`): its Zod input schema, its handler, and the output type inferred from what the
handler returns. That is the whole contract; nothing is declared in `shared` beyond the domain types
procedures return. The console imports only the router's *type*
(`import type { AppRouter } from '@turingmod/backend/trpc'`, the backend package's one export), so
`useTrpc().integrations.start.mutate({ integrationName })` is checked against the backend's
definition.

- **State** the console shows is a subscription built with `watchable()`, which sends the current
  value on subscribing and again after each change, reading it once per change however many
  consoles watch; tRPC resubscribes after a reconnect, so there's no separate read, and every
  console receives every change. The console reads it with `useSubscription()`.
- **Mutations** answer with the state they left, which the console that asked shows at once
  (`useSubscription()`'s setter), so a spinner never stops on stale state; other consoles get it
  through the subscription.
- **Queries** (the command table, the data inspector) are read with `useServerQuery()`: on every
  connect and whenever the input changes, a superseded read aborted.
- **Streams of events** rather than state (the activity feed, OAuth results) are built with
  `events()`. The activity feed sends a snapshot to start from, read in the same synchronous step
  as subscribing so nothing falls between them, then each event; the console folds them into its
  state with `useSubscription()`'s `reduce`.
- **Errors**: a malformed input is a `BAD_REQUEST`; a handler that throws reaches the console as
  its error message.
- **Context**: every procedure gets the calling console's origin as `ctx.consoleOrigin`
  (`TrpcContext`), read from the connection's Origin header once the origin check has allowed it.
  OAuth keeps it with an attempt so the callback page can send the streamer back.
- **Connection**: requests made while disconnected fail at once (`failWhileDisconnected`) rather
  than being queued, so a click during an outage never runs later. The client retries with backoff
  (`reconnectDelay()`); the connection banner, the sidebar's status and the "reconnecting" dimming
  follow `useConnection()`, whose Retry now skips the wait.

### Database

`node:sqlite` (`DatabaseSync`, file-backed, WAL mode) — chosen over `better-sqlite3` to avoid reintroducing a native-compilation dependency. Every write commits durably as it happens; there is no in-memory buffering or periodic flush to lose writes or corrupt the file on crash. Access via repository pattern: `IntegrationStateRepository`, `SettingsRepository`, `ActivityLogRepository` (the record of everything that happened, commands included), plus repositories for data owned by single features — `BannedWordRepository`, `CounterRepository`, `IntervalMessageRepository`, `ObsBreakRestoreRepository`, `GoLivePostRepository`, `SuggestionRepository`. Repositories are synchronous, because `node:sqlite` is: they return values, not promises. `DatabaseManager.transaction()` takes a synchronous callback and rejects an async one, since an `await` inside it would let other writes on the one shared connection join the transaction. A new migration goes in `migrations/` and must be added to `ALL_MIGRATIONS`. Tests get a migrated temp database from `repositories/testDatabase.ts`. Integration configs are encrypted with AES-256-GCM before storage, keyed from `MASTER_PASSWORD` (required: `TuringModConfig` throws a `ConfigurationError` without it, which `index.ts` prints without a stack trace) and a per-install salt kept in the `settings` table; app-level settings in the `settings` table (`SettingsRepository`) are plain JSON, so nothing secret belongs there. Each settings group is a `SettingsDefinition` (its key plus a strict Zod schema whose defaults apply when nothing is stored, e.g. `BREAK_SETTINGS`), read and written through `SettingsRepository.get()`/`set()`, which throw on a value that doesn't fit. A new group is added to `ALL_SETTINGS` in `setup.ts`, which reads every group at startup so bad settings stop TuringMod there with the fields named. The console has no settings UI yet: outside tests nothing calls `set()`, so stored settings are only ever the defaults or what was written to the database directly.

### Platform Provider Layer

`IStreamPlatform` is a platform-agnostic façade over one platform's integration group, registered
in `PlatformRegistry` and consumed through `StreamControlService`.

Commands and features reach a platform only through `StreamControlService`: its mirrored writes
(`setTitle()`, `setGame()`, `setTags()`), `announce()`, and `require(platform, 'channelPoints')`,
which returns that platform's capability object, typed, or throws. What only some platforms can do
is an optional capability object on `IStreamPlatform` (all listed in `CapabilityApis`). A command
lists the capabilities it uses in `requiredCapabilities` and is hidden on platforms without them
(`CommandExecutor` treats hidden as `COMMAND_NOT_FOUND`); the console gets each command's
`availableOn` from `commands.list`. Every endpoint and platform rule lives in the façade
(`TwitchPlatform`, `YouTubePlatform`), never in a command or in an API integration. How the façades
and their capability sets are built, and how to add a capability, is in
[`packages/backend/src/platforms/CLAUDE.md`](packages/backend/src/platforms/CLAUDE.md).

**Commands never check authentication.** The façade decides, and only reports a problem once nothing
can recover it automatically — an expired access token is refreshed transparently by the provider, so
`NotAuthenticatedError` means a human must redo OAuth. Two paths handle it differently:
`requireUserId()` throws `NotAuthenticatedError`, which `toCommandError()`
(`commands/utils/commandErrors.ts`) maps to a `NOT_AUTHENTICATED` result; mirrored *writes* instead
call `getUnavailableReason()` and log a warning, because a mirror replies in public chat where the
broadcaster's token state doesn't belong.

**Features react to a platform recovering through `platform.availability`, not `integration.status`.**
`PlatformAvailability` re-checks every façade's `getUnavailableReason()` on each integration status
change and publishes only transitions, so a feature like `RewardSync` ("Twitch is back, sync
rewards") never needs to know which integration name decides a platform's availability.

### Going Live

Some platforms need telling that a stream has started. YouTube chat belongs to one broadcast, and
YouTube can't notify a localhost server that one began; Twitch needs nothing, since its chat
subscription is per channel and it announces going live itself (`twitch.stream.online`). The
signal is split in two so a future per-broadcast platform reuses it. `ObsStreamState` knows
whether OBS is streaming and publishes `stream.output.changed`, with no knowledge of platforms; it
asks OBS directly whenever OBS connects, since a transition missed while disconnected (TuringMod
starting mid-stream) produces no event. Each platform that needs it reacts in its own service:
`YouTubeChatAutoConnect` connects chat on that event, and also when YouTube chat itself comes up
while OBS is already streaming (after a restart, or a login recovering mid-stream). OBS streaming
doesn't mean every platform is live, so a platform treats the signal as a reason to look for its
broadcast, bounded in time, not as proof of one.

**The Discord go-live post** (`GoLiveAnnouncer`) follows `platform.liveState`, not OBS: one post
pinging `@everyone` when the first platform goes live, edited as other platforms join and leave
and on `stream.info.changed` (a mirrored title/game write, or any change on Twitch via EventSub
`channel.update`), and rewritten as "was live for …" only on evidence that the stream is over:
every platform it covered offline for a 10-minute grace period, and each of them connected and
answering `isLive()` false. A disconnected platform (TuringMod just started, a lapsed login) is
unknown, not offline, so a crashed or restarted stream, or an auth outage, carries on in the same
post without a second ping. Going live continues the post only if the broadcast started within
the grace period of the post's last heartbeat; a later start ends the old post and announces anew.
The open post is stored (`GoLivePostRepository`) with a once-a-minute "still live" time. Only the
first post pings: `DiscordIntegration` allows `@everyone` and no other mention, and never on an
edit. A post someone deletes stays deleted for the rest of the stream. Twitch's `stream.offline`
and `channel.update` topics are on by default for this; YouTube Studio title changes reach the
post only on its next edit.

### Stream Breaks

A break takes the streamer off camera and mic in OBS. That's one output, so every platform sees it;
only the chat wording differs per platform (`PerPlatformMessage`). Twitch ad breaks
(`channel.ad_break.begin` → `twitch.ad.break`) start one automatically, and `!break` starts one by
hand. A trigger during a running break extends it rather than starting another, so the OBS snapshot
is always of the pre-break state. `ObsBreakOverlay` sets absolute states from that snapshot (never
`ToggleInputMute`-style toggles) and covers every scene on every canvas, including items inside
groups, which keeps the Aitum Vertical canvas in step and makes a mid-break scene switch harmless.
A canvas or group that can't be read is skipped and logged, so the rest is still covered. `AdWarningScheduler` warns chat
ahead of Twitch's scheduled ads, re-reading the schedule before each warning because snoozes and
manual ads move it. Shutdown ends a running break before stopping integrations, so OBS is still
connected to restore it, and `BreakService` refuses new breaks once stopped.
What a break changed in OBS is stored (`ObsBreakRestoreRepository`) until it has been put back,
and whenever OBS connects `BreakService` brings OBS in line: the overlay applied again if a break
is running, the stored state restored if not. That covers a break that ends while OBS is down and
one cut short by TuringMod crashing (a break doesn't survive a restart; what it owes OBS does).
A new break started while a restore is still owed builds on that state, so its "before" is never
the hidden facecam. `ObsIntegration` reconnects on its own while it is started, backing off to
30s; only a failure the streamer must fix (wrong password, old obs-websocket) is an ERROR. Chat fan-out goes through `StreamControlService.announce()`, which
shares the live-platform/auth-skip loop with the mirrored writes.

### Channel Point Rewards & Raids

`TwitchEventSubIntegration` publishes redemptions and raids on the EventBus; nothing else in the
integration layer knows about them. `RewardRouter` subscribes to `twitch.channelPoint.redemption`
and runs the `IRewardHandler` whose `rewardTitle` matches the redemption's title exactly — titles
are unique per channel and rarely renamed, so there are no stored reward ids. Handlers are
auto-discovered like commands: one class per reward in `rewards/implementations/`, default-exported
and `@injectable()`. A redemption with no handler is normal (a reward for the streamer to act on)
and is ignored; a handler that throws is logged and never stops the next redemption.

Each handler also declares its reward's settings (`reward: RewardDefinition`). `RewardSync` makes
Twitch match them whenever the Twitch API connects and whenever a stream break starts or ends:
creating missing rewards, correcting drifted settings, and pausing `pauseDuringBreaks` rewards for
the break. Twitch only lets the application that created a reward edit it, so a same-titled reward
made elsewhere is reported once and left alone (its handler still runs). For rewards TuringMod
does own, `RewardRouter` resolves queued redemptions afterwards — fulfilled on success, canceled
(refunding the viewer) if the handler threw — which is why `autoFulfill` defaults off. All of this
goes through the `CHANNEL_POINTS` platform capability, like any other platform action.

`RaidShoutout` handles `twitch.raid`: a chat message linking the raider plus Twitch's native
shoutout, through `StreamControlService` like any other platform action. The two are independent,
so a rate-limited native shoutout still gets the chat message.

### Facecam Effects

Reward handlers play visual gags on the facecam through `FacecamEffectRunner`. An effect
(`FacecamEffect`) only describes motion against an `EffectContext`; the runner does the rest. It
plays effects one at a time — two effects on one source would each capture the other's
mid-animation state as the "original" — finds the facecam afresh for each one, and restores it in a
`finally`, so an effect that throws, or is cut short at shutdown, still leaves the
facecam where it was. Filters an effect adds are removed the same way. A run rejects when it can't
play (OBS down, no facecam), which makes `RewardRouter` refund the redemption.

The facecam is found by source name (the `effects` setting), placed directly or inside a group, in
the main canvas's program scene and, on every other canvas, in the first scene that contains it:
obs-websocket reports no program scene for a non-main canvas. An item inside a group is addressed
through the group's UUID, and its position is relative to the group, so an effect that moves it in
canvas coordinates (`usesCanvasSize`, the screensaver) plays on the main canvas only and refuses a
grouped facecam. Effects animate on elapsed time, not frame counts, so a slow OBS drops frames
rather than slowing down, and they assume the facecam is unrotated and has no bounding box.

### Sound

Everything that makes a sound goes through `SoundLibrary`, which resolves a clip name against the
library directory (the `sounds` setting, defaulting to `packages/backend/data`) and hands the path
to `SoundIntegration`. `play()` checks first that sound is running and the clip exists and rejects
otherwise, so a sound-only reward is refunded; `tryPlay()` logs instead, for callers where the sound
is incidental (`!bonk`, the Bonk reward, break sounds). Neither waits for the clip to end.
`SoundIntegration` tracks its player processes, so a clip can be cut off after `maxDurationMs` and
`stopAll()` silences everything; an intentional kill counts as a normal end, not an error.

### Chat Pipeline

Each chat integration emits one `chat.received` (`ChatMessageEvent`) per message and nothing else;
commands are not parsed at the source. `OwnChatMessages` drops TuringMod's own messages and
republishes the rest as `chat.message`, which is what every consumer listens to. `ChatRouter` takes
it from there: `ChatModerator.review()`
first, and only a message it allows is parsed with `parseCommand()` and executed. That order is the
point — a command can't carry a banned word past the filter. Moderation acts only on platforms
with the `MODERATION` capability and always exempts the broadcaster. Banned words are data
(`banned_words`, written by the Ban A Word reward) and lapse 30 days after being banned. Other
listeners on `chat.message` (activity log, `ClipCollector`) see every message but TuringMod's own,
moderated or not.

Failures `CommandExecutor` produces itself (`EXECUTOR_ERROR_CODES`: unknown command, permissions,
cooldown, crashed) get **no reply in chat** — an unknown `!word` is often meant for
another bot — and are recorded in the activity log instead (unknown commands are also logged at
debug). Failures a command reports itself (usage, "game not found", a viewer trying a
moderator-only branch) are still replied to. The two sets of codes are separate unions in
`shared/src/types/command.ts`: `ICommand.execute()` returns a `CommandResult`, which admits only
`CommandErrorCode`, so a command can't report an executor code and have its reply silenced.
`CommandResult` is a union: a failure always carries a code and a `reason`, a success carries
neither. Commands build results with `ok()`/`fail()` (`commands/utils/results.ts`), never by hand;
`message` is the reply for chat, and `reason` is for the streamer, recorded with
`command.executed` in the activity log (a crashed command's reason is the error it threw). Protocol
error messages likewise use the `ErrorCode` union in `messages.ts`, not free strings.

**TuringMod never acts on its own chat messages.** It posts with the broadcaster's login — one
identity per platform, deliberately, rather than a separate bot account that would split actions
between two sets of credentials — so its messages come back through ingest as the broadcaster's.
Unchecked, an echoed `!delvod` would run with broadcaster permission (a confused deputy), and a
reaction to its own message could feed a message storm. Sender identity can't tell them apart, so
the message id does: every façade sends through `OwnChatMessages.record()`, which remembers the id
the platform returns, and the gate drops those messages before anything sees them. Ingest can
deliver a message before the send call returns, so a broadcaster message arriving mid-send waits
for in-flight sends to settle before it is judged; other people's messages pass straight through.

**Outgoing chat can never start with a command**, a second layer that also protects other bots in
the channel. Every `IStreamPlatform` passes outgoing chat and announcements through
`toSafeChatText()` (`chat/chatMessage.ts`), which strips leading whitespace, invisible format
characters and `!`/`/` prefixes. There is deliberately no `!echo`-style command that repeats
viewer input.

**Commands receive their arguments already parsed.** `parseCommand()` (`commands/parseCommand.ts`)
lowercases the name, so `!Lurk` runs `lurk` (command names are registered lowercase, which
`CommandRegistry` enforces), and gives the command two views of what follows it: `args`, the words
split on any whitespace with no empty entries, for a command that takes a word (`!so <channel>`),
and `argText`, the trimmed text with its spacing kept, for one that takes free text (`!title`,
`!tags`). A command with a read and a write mode writes only when `argText` isn't empty, so a stray
trailing space reads rather than clearing anything. Commands never re-split or re-join arguments
themselves.

The command simulator deliberately runs commands for real, side effects included: it lets the
streamer act as a viewer to integration-test a command without asking someone to type it. It parses
its text with the same `parseCommand()` as chat, so a command behaves identically in both, and text
chat wouldn't run is answered as not a command. It is only reachable from the localhost console;
there is no message for running a command as an arbitrary user.

### Frontend State

React Context for state management: `TrpcContext` (the tRPC client and its connection) and `AppStateContext` (commands, integrations). State the backend keeps current through a tRPC `watch` subscription is read with `useSubscription()` (`hooks/useSubscription.ts`); anything read with a tRPC query, with `useServerQuery()` (`hooks/useServerQuery.ts`): read whenever the connection comes up and whenever its input changes, a superseded read aborted. Don't hand-write either in a new hook. Dialogs are rendered only while open, so each opening starts fresh rather than resetting its fields. Custom hooks: `useCommands()`, `useIntegrations()`, `useIntegrationActions()`, `useLiveLog()`, `useYouTubeChat()`, `usePlatformLiveState()`, `useDataRows()`. Pages (routes in `App.tsx`, code under `src/features/<page>/`, and listed once for the sidebar, ⌘K palette and header in `constants/pages.ts`): Dashboard, Commands (command table; the simulator is a sheet any page or the ⌘K palette opens, `features/commands/simulator.tsx`), Integrations, History, Data.

### Console UI

The console is dark-only and runs on the streamer's second monitor, so the live feed is the most
prominent thing on the Dashboard and integration health stays quiet until something breaks.
Components are [shadcn/ui](https://ui.shadcn.com) (new-york, zinc), vendored in
`src/components/ui/` from the shadcn repository; edit them there like any other source. Theme
tokens, including the category/status accents (`--cat-*`), are CSS variables in `src/index.css`;
use the tokens, not hex values or Tailwind's fixed palette (`red-900`). `@/` is `src/`, and imports from outside a file's own folder use it: lint rejects `../`. Every table is `components/data-table/data-table.tsx`
over a TanStack table instance the page owns (sorting, filters and paging stay the page's, so the
same component serves client-side lists and server-paged queries), with optional row
virtualization for the live feed. History and the Data page read through the backend's read-only
data inspector (below), paged and filtered on the server.

### Data Inspector

The Data page reads the database through `DataInspector` (`database/DataInspector.ts`) over
the tRPC queries `data.listTables` / `data.queryRows` (`server/trpc/dataRouter.ts`), which report
what it refuses (an unknown table or column) as a `BAD_REQUEST` with its reason. It opens its own
`readOnly` connection, reads only the tables in its `TABLES` allow-list, checks every table and
column name against the schema SQLite reports, and binds every value; there is no free-form SQL.
`integration_state.config` is never selected (only its length, shown as `encrypted · N B`) and the
encryption salt row is hidden. A new table is invisible to it until it gets a `TABLES` entry;
anything secret in it must be listed in `masked` (a column) or `maskedRows` (rows by key). A
secret row also drops out of any query that searches, filters or sorts on its hidden values, so
its value can't be guessed one query at a time.

### HTTP Server

Minimal Node.js `http` server (`server/HttpServer.ts`) on `SERVER_PORT`, which also hosts the console's WebSocket endpoint (`/trpc`) — the backend has one port. The console connects to `/trpc` on its own origin; in development Vite proxies that to the backend. Serves static frontend build in production. OAuth callback routes (`/callback/twitch`, `/callback/spotify`, `/callback/youtube`) are built from each `IOAuthIntegration.getCallbackPath()` via `OAuthFlowService.getCallbackRoutes()`, not hardcoded; it refuses two integrations claiming one path. Redirect URIs are derived, never stored or sent by the console: `getRedirectUri()` combines the callback path, `SERVER_PORT`, and the one loopback host each provider accepts for plain HTTP (Twitch `localhost`; Spotify and Google `127.0.0.1`). Health check at `/health`. Localhost-only binding enforced.

## Code Style

- **Biome** for linting and formatting (not ESLint/Prettier). Config in `biome.json`.
- Line width 100, single quotes, semicolons always, trailing commas (es5).
- Naming: camelCase/PascalCase for functions, PascalCase for classes/interfaces, CONSTANT_CASE for enum members.
- Pre-commit hook (Husky + lint-staged) runs `biome check --write` on staged files.
- **Validation**: anything entering from outside the process — console messages, stored integration
  configs, settings, a provider's token response — is parsed with a Zod schema where it enters, and
  its TypeScript type is `z.infer` of that schema, so the type and the check can't drift apart.
  Don't hand-write type guards or cast parsed JSON. Schemas for data TuringMod owns are strict
  (`z.strictObject`: an unknown key is an error) and fail rather than fall back; a field may be
  optional or have a default, but a value that is present must be valid. Schemas for a third
  party's responses use `z.object`, requiring only the fields we use. Use `.exactOptional()` for
  optional fields, to match `exactOptionalPropertyTypes`.
- **Errors**: throw only `Error`s, with a message (Biome's `useThrowOnlyError` and `useErrorMessage`
  enforce it). A caught value is still `unknown`, because dependencies can throw anything: narrow it
  where it's caught with `messageOf()` or `toError()` (`shared/src/utils/errors.ts`) rather than
  repeating `instanceof Error` checks or passing `unknown` on.

## TypeScript

- Strict mode with `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` — these are stricter than default strict. When assigning to optional properties, you must use `undefined` explicitly (not just omit the property). Indexed access returns `T | undefined`.
- Backend uses `NodeNext` module resolution; frontend uses `bundler` resolution.
- ESM throughout (`"type": "module"` in root package.json). Backend imports use `.js` extensions in source files.

## Key Conventions

- **Localhost only** — all servers bind to 127.0.0.1, never 0.0.0.0.
- **No REST API** — all frontend-backend communication is WebSocket: new requests are tRPC procedures (see Console ↔ Backend Protocol). HTTP server is only for static files and OAuth callbacks.
- **IntegrationStatus enum** — never use string literals for integration status.
- **What goes in `shared`.** Only what both packages need: values the console and the backend
  both execute (enums, Zod schemas, constants, small pure helpers) and domain types both name. A
  request's input and output belong to its tRPC procedure, never `shared`; the console infers them
  (`RouterInputs`/`RouterOutputs`). Something only one side uses stays on that side. `shared` must
  stay runtime-neutral, no Node or browser APIs, since it runs in both. The console can't take a
  value from the backend package instead: it exports types only, and importing backend code would
  pull Node-only dependencies into the browser bundle.
- **`getDependencies()` returns integration instances**, not names — return the constructor-injected
  objects so the graph can't drift. Unmet dependencies are `BLOCKED`, not `ERROR`.
- **A new integration with a dependency should consider `dependencyFailurePolicy`.** It defaults to
  `STOP`, which is the safe answer; only override to `BLOCK` if the integration holds nothing bound
  to the dependency and gates its work on the dependency's status.
- **Accessors a dependent caches against must return a stable instance** (`getAuthProvider()`,
  `getAuthClient()`) — the API layers compare the reference to decide whether to rebuild, so
  returning a fresh object per call makes them rebuild on every access.
- **Integration lifecycle** — `IntegrationManager` calls `initialize(config)` before `start()`: at load, and again only when the config is replaced. An integration with a config declares a Zod schema for it and parses it in `initialize()` with `parseConfig()`. Saving its own config (OAuth tokens) goes through `IntegrationStateRepository.saveConfig()`, which never changes `enabled`.
- **New feature services** implement `IService` and get one `services.add(...)` line in `setup.ts`, placed by what they depend on at shutdown — never start or stop them anywhere else.
- **New commands** go in `packages/backend/src/commands/implementations/` and implement `ICommand`. They're auto-discovered by `loadCommands()`.
- **New channel point reward handlers** go in `packages/backend/src/rewards/implementations/` and implement `IRewardHandler`, matched by exact `rewardTitle`. They're auto-discovered by `loadRewardHandlers()`.
- **Behaviour lives in code, not the database.** Commands and reward handlers are TypeScript classes; a table may hold a feature's own data (a banned-word list, a counter), never its logic.
- **Commands reach platforms through `StreamControlService`**, never through a platform's integrations directly, and never check auth themselves (see Platform Provider Layer). An integration that isn't a platform (Spotify, sound) is used directly, through its `request()` or the feature class over it.
- **A new platform capability** is a `PlatformCapability` value, an object type in `CapabilityApis`, its `CAPABILITY_OF_API` entry, and the façades' implementations; the compiler holds those together. Don't add a pass-through to `StreamControlService` — callers use `require()`.
- **Every outgoing chat message goes through `toSafeChatText()` and `OwnChatMessages.record()`** inside the platform façade — a new `IStreamPlatform` (or a new send method) must apply both, so the bot can never post a command or act on what it posted (see Chat Pipeline).
- **API-backed read commands need a cooldown.** `ICommand.cooldown` is per-viewer seconds; `CommandExecutor` exempts moderators and above, so a shared read/write command (`!game`, `!tags`, `!cw`) can be throttled for viewers without blocking a moderator's write.
- **New integrations** extend `BaseIntegration`, get decorated `@singleton()`, get registered with `IntegrationManager` in `setup.ts`'s `initializeComponents()`, and need a procedure in the tRPC router (`server/trpc/`) if the console controls them. An API that calls on behalf of a separate auth integration extends `AuthorizedApiIntegration` instead (a public API, or one with its token in its own config, stays on `BaseIntegration`). OAuth-capable integrations extend `OAuthIntegration` instead, and need an entry in the frontend's `oauthIntegrationRegistry.tsx` + a config in `oauthProviders.tsx`.
