# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: Keep this file updated when adding new major systems or changing module organization. Focus on stable structural information, not implementation details.

## Commands

```bash
# Development (starts both backend + frontend via concurrently)
npm run dev                # Backend on :8080 (SERVER_PORT), Frontend on :3000 (proxies /ws)
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
- **OAuth flow**: `packages/backend/src/integrations/OAuthFlowService.ts` — authorization URL, single-use `state`, callback routes, code exchange. Client credentials come only from the console's setup dialog (stored encrypted), never from `.env`; `IntegrationInfo.oauth.configured` tells the console whether to open setup or authorization
- **Dependency graph**: `packages/backend/src/integrations/DependencyGraph.ts` — pure sort/levels/dependents/validate queries over the registered integrations
- **Base Class**: `packages/backend/src/integrations/BaseIntegration.ts` — shared status/error/event-emitter plumbing; all integrations extend this
- **OAuth base class**: `packages/backend/src/integrations/OAuthIntegration.ts` — `OAuthIntegration<TConfig>` (extends `BaseIntegration`): credentials, redirect URI, token persistence, and the no-token / missing-scope checks before connecting
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
- **Interface**: `packages/backend/src/platforms/interfaces/IStreamPlatform.ts` — platform-agnostic façade; per-capability objects (`CapabilityApis`) are optional
- **Capability sets**: `packages/backend/src/platforms/capabilities.ts` — `capabilitiesOf()`, derived from the objects a façade has
- **Implementations**: `packages/backend/src/platforms/TwitchPlatform.ts`, `YouTubePlatform.ts`
- **Registry**: `packages/backend/src/platforms/PlatformRegistry.ts` (Platform → façade)
- **Mirroring/reads**: `packages/backend/src/platforms/StreamControlService.ts` — the seam commands depend on
- **Auth reporting**: `packages/backend/src/platforms/availability.ts` (`unavailableReason`) + `errors.ts` (`NotAuthenticatedError`)
- **Availability events**: `packages/backend/src/platforms/PlatformAvailability.ts` — publishes `platform.availability` when a façade becomes usable or stops being usable
- **Display names**: `packages/backend/src/platforms/platformNames.ts`

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
- **Message shape**: `chat/chatMessage.ts` — `ChatMessageEvent`, `parseCommand`, and `toSafeChatText` (applied by every façade to outgoing chat)
- **Own-message gate**: `chat/OwnChatMessages.ts` — records sent message ids; republishes `chat.received` as `chat.message` minus TuringMod's own
- **Chat routing**: `chat/ChatRouter.ts` (moderate → parse → execute → reply)
- **Moderation**: `chat/moderation/ChatModerator.ts` (banned words, quiet mode) + `bannedWords.ts` (matching, 30-day expiry)
- **Interval messages**: `chat/announcements/IntervalAnnouncer.ts`
- **Clip collection**: `chat/clips/ClipCollector.ts`
- **Lurk list**: `chat/lurk/LurkTracker.ts` (in memory; welcomes lurkers back when they chat)

### Stream Breaks
- **Lifecycle**: `packages/backend/src/breaks/BreakService.ts` — starts/extends/ends breaks; listens for `twitch.ad.break`; emits `stream.break.started`/`.ended`
- **OBS overlay**: `packages/backend/src/breaks/ObsBreakOverlay.ts` — snapshot/apply/restore across all canvases and scenes
- **Ad pre-warnings**: `packages/backend/src/breaks/AdWarningScheduler.ts`
- **Settings**: `packages/backend/src/breaks/breakSettings.ts` (types, defaults, parsing), stored under the `breaks` key via `database/repositories/SettingsRepository.ts`
- **Manual trigger**: `packages/backend/src/commands/implementations/BreakCommand.ts` (`!break`)

### WebSocket Protocol
- **Server**: `packages/backend/src/server/WebSocketServer.ts`
- **Router**: `packages/backend/src/server/MessageRouter.ts`
- **Messages/Types**: `packages/shared/src/protocol/messages.ts`
- **Frontend Context**: `packages/frontend/src/context/WebSocketContext.tsx`
- **Frontend Hooks**: `packages/frontend/src/hooks/useWebSocket.ts`

### Database
- **Manager**: `packages/backend/src/database/DatabaseManager.ts`
- **Repositories**: `packages/backend/src/database/repositories/*.ts`
- **Migrations**: `packages/backend/src/database/migrations/*.ts`, listed in `migrations/index.ts` (`ALL_MIGRATIONS`), run automatically on startup
- **Import from the original bot**: `packages/backend/src/tools/importOriginal.ts` (`npm run import:original -w @turingmod/backend`) + `originalData.ts`

### Core Infrastructure
- **DI**: [tsyringe](https://github.com/microsoft/tsyringe) — `@injectable()`/`@singleton()` on class definitions; `registerRootFactories()` in `setup.ts` for the handful of classes tsyringe can't auto-construct
- **EventBus**: `packages/backend/src/core/EventBus.ts`; every event name and payload type in `core/events.ts` (`EventMap`)
- **Application**: `packages/backend/src/core/Application.ts`
- **Feature service lifecycle**: `packages/backend/src/core/ServiceLifecycle.ts` (`IService`, `Subscriptions`); the ordered service list is in `setup.ts`
- **Setup/Bootstrap**: `packages/backend/src/setup.ts`
- **Entry Point**: `packages/backend/src/index.ts`
- **Environment**: `packages/backend/src/utils/loadEnv.ts` loads the repository-root `.env` (template: `.env.example`); it's the first import of each entry point (`index.ts`, `tools/importOriginal.ts`). Shell variables win over the file. `TuringModConfig` (`utils/Config.ts`) is what reads them.

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

**Feature services** (chat routing, rewards, breaks, effects, announcers — anything that isn't an
integration but subscribes to the bus or holds timers) implement `IService` and are added, in
order, to `ServiceLifecycle` in `setup.ts`. `Application` starts them before integrations, so a
subscriber sees the `platform.availability` changes that connecting causes, and stops them in
reverse before integrations, so a service can still reach OBS or Twitch to undo what it did.
Triggers (chat, redemptions, raids) go last in the list so they stop first: nothing new can start a
break or an effect while those are being restored. Each service keeps its bus subscriptions in a
`Subscriptions` and clears them in `stop()`.

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
  `await` don't hold across it. A start from outside the queue (the console, an OAuth exchange) is
  kept apart from it by a per-integration lifecycle lock: every `startIntegration()` and
  `stopIntegration()` of one integration runs after the previous one has settled. A start that hits
  `START_TIMEOUT_MS` releases the lock even though its `start()` may still be running.
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

OAuth-capable integrations (`TwitchAuthIntegration`, `SpotifyAuthIntegration`, `YouTubeAuthIntegration`) extend `OAuthIntegration<TConfig>` (`integrations/OAuthIntegration.ts`), which implements `IOAuthIntegration` (`integrations/interfaces/IOAuthIntegration.ts`) and returns itself from the `get oauth()` getter (`null` on `BaseIntegration` by default). That getter is the single source of truth for OAuth capability — `OAuthFlowService` derives callback routing and the frontend's OAuth affordance from it instead of checking integration names.

`OAuthIntegration` owns what doesn't vary by provider. A subclass declares `requiredScopes`, `callbackPath` and `redirectHost`, and implements `getAuthorizationUrl()`, `exchangeCode()`, `hasTokens()` and `connect()` (build its client); the base's `start()` runs the shared checks first — no token yet stays DISCONNECTED, and a stored `grantedScopes` missing a required scope is NEEDS_REAUTH rather than a failure on the first call that needs it. Refresh is deliberately left to each subclass, because each SDK does it differently (Twurple refreshes proactively, the googleapis client on demand, Spotify by hand on a 401). A refresh listener that nothing awaits saves through `saveRefreshedTokens()`, which logs a failed write instead of leaving an unhandled rejection.

Cross-integration communication uses `EventBus` (`core/EventBus.ts`) — a simple pub/sub with sync and async emit.
It is typed against `EventMap` (`core/events.ts`), which declares every event name and its payload
type once, so an emitter and its subscribers can't drift apart. A new event is a new `EventMap` entry;
don't declare a payload type beside its emitter or consumer. Names are dot-separated camelCase
segments, most general first (`twitch.channelPoint.redemption`, `integration.tokenRefreshed`).

**Status changes are the integration→UI channel, not per-provider events.** `setStatus()` → the
`'status'` listener in `IntegrationManager.register()` → `integration.status` on the bus →
`Application.setupEventHandlers()` broadcasts `INTEGRATION_STATUS` → `AppStateContext`. A new status
(like `BLOCKED`) reaches the console through that path with no extra wiring, carrying its reason in
`errorMessage`. Don't add a per-provider `*.ready` event for this: eight such emits
(`twitch.auth.ready`, `twitch.api.ready`, the Spotify/YouTube equivalents, and two
`*.auth.token-refreshed`) were removed as redundant with it — and the `*.ready` ones published live
auth providers and API clients onto the bus, which is exactly the stale-reference trap the
resolve-on-access change above eliminates.

A token refresh is the one thing status *can't* express (the integration stays CONNECTED through
it), so it has its own forward: `BaseIntegration.reportTokenRefreshed(expiresAt?)` →
`'token-refreshed'` → logged and republished as `integration.tokenRefreshed` with
`{ name, expiresAt? }`. It carries no credentials by design — anything needing the token asks the
integration on access.

### WebSocket Protocol

All messages follow `IWebSocketMessage<T>` from `packages/shared/src/protocol/messages.ts`: `{ id, type, timestamp, payload }`. Message IDs are UUIDs used for request/response correlation. Use `createMessage()` and typed creator functions (e.g., `createCommandResultMessage()`) to construct messages.

### Database

`node:sqlite` (`DatabaseSync`, file-backed, WAL mode) — chosen over `better-sqlite3` to avoid reintroducing a native-compilation dependency. Every write commits durably as it happens; there is no in-memory buffering or periodic flush to lose writes or corrupt the file on crash. Access via repository pattern: `IntegrationStateRepository`, `SettingsRepository`, `ActivityLogRepository` (the record of everything that happened, commands included), plus repositories for data owned by single features — `BannedWordRepository`, `CounterRepository`, `IntervalMessageRepository`, `SuggestionRepository`. Repositories are synchronous, because `node:sqlite` is: they return values, not promises. `DatabaseManager.transaction()` takes a synchronous callback and rejects an async one, since an `await` inside it would let other writes on the one shared connection join the transaction. A new migration goes in `migrations/` and must be added to `ALL_MIGRATIONS`. Tests get a migrated temp database from `repositories/testDatabase.ts`. Integration configs are encrypted with AES-256-GCM before storage; app-level settings in the `settings` table (`SettingsRepository`) are plain JSON, so nothing secret belongs there.

### Platform Provider Layer

`IStreamPlatform` is a platform-agnostic façade over one platform's integration group, registered
in `PlatformRegistry` and consumed through `StreamControlService`. Commands depend on this seam, not
on integrations — a command should never resolve `TwitchApiIntegration`/`TwitchAuthIntegration` from
the container. Platform-specific logic (Twitch category name → id resolution) lives inside the
façade, and the DTOs crossing it (`StreamInfo`, `ScheduleSegment`, `AdBreakInfo`) are agnostic, so no
Twurple/googleapis types leak into the interface.

**Having a capability object is having the capability.** What only some platforms can do is
grouped into optional capability objects on `IStreamPlatform` (`ads?: AdsApi`,
`channelPoints?: ChannelPointsApi`, `moderation?: ModerationApi`, …; all listed in
`CapabilityApis`). Callers get one with `StreamControlService.require(platform, 'channelPoints')`,
which returns it typed or throws. A façade's capability set is never written out:
`capabilitiesOf()` (`platforms/capabilities.ts`) derives it from the objects it has, plus the five
capabilities no object stands for (`SEND_CHAT`, `UPTIME` and the `SET_*` fields of
`setStreamInfo()`), which the façade lists in `declaredCapabilities`. Its type admits only those
five, and `CAPABILITY_OF_API` pairs every other `PlatformCapability` with its object, so
advertising a capability without implementing it, or adding a `PlatformCapability` with no object,
is a compile error. A command declares `requiredCapabilities` and is hidden on platforms that don't
satisfy them (`CommandExecutor` treats hidden as `COMMAND_NOT_FOUND`). The console gets each
command's `availableOn` in `COMMAND_LIST` rather than keeping its own copy of each platform's set.

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

### Stream Breaks

A break takes the streamer off camera and mic in OBS. That's one output, so every platform sees it;
only the chat wording differs per platform (`PerPlatformMessage`). Twitch ad breaks
(`channel.ad_break.begin` → `twitch.ad.break`) start one automatically, and `!break` starts one by
hand. A trigger during a running break extends it rather than starting another, so the OBS snapshot
is always of the pre-break state. `ObsBreakOverlay` sets absolute states from that snapshot (never
`ToggleInputMute`-style toggles) and covers every scene on every canvas, which keeps the Aitum
Vertical canvas in step and makes a mid-break scene switch harmless. `AdWarningScheduler` warns chat
ahead of Twitch's scheduled ads, re-reading the schedule before each warning because snoozes and
manual ads move it. Shutdown ends a running break before stopping integrations, so OBS is still
connected to restore it, and `BreakService` refuses new breaks once stopped. Chat fan-out goes through `StreamControlService.announce()`, which
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

The facecam is found by source name (the `effects` setting) in the main canvas's program scene and,
on every other canvas, in the first scene that contains it: obs-websocket has no "current scene" for
a non-main canvas. Effects animate on elapsed time, not frame counts, so a slow OBS drops frames
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
debug). Failures a command reports itself (usage, "game not found") are still replied to.

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

The command simulator deliberately runs commands for real, side effects included: it lets the
streamer act as a viewer to integration-test a command without asking someone to type it. It is
only reachable from the localhost console.

### Frontend State

React Context for state management: `WebSocketContext` (connection + send/subscribe) and `AppStateContext` (commands, integrations, health). Custom hooks: `useWebSocket()`, `useWebSocketMessage()`, `useCommands()`, `useIntegrations()`.

### HTTP Server

Minimal Node.js `http` server (`server/HttpServer.ts`) on `SERVER_PORT`, which also hosts the WebSocket endpoint (`/ws`) — the backend has one port. The console connects to `/ws` on its own origin; in development Vite proxies that to the backend. Serves static frontend build in production. OAuth callback routes (`/callback/twitch`, `/callback/spotify`, `/callback/youtube`) are built from each `IOAuthIntegration.getCallbackPath()` via `OAuthFlowService.getCallbackRoutes()`, not hardcoded. Redirect URIs are derived, never stored or sent by the console: `getRedirectUri()` combines the callback path, `SERVER_PORT`, and the one loopback host each provider accepts for plain HTTP (Twitch `localhost`; Spotify and Google `127.0.0.1`). Health check at `/health`. Localhost-only binding enforced.

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
- **New feature services** implement `IService` and get one `services.add(...)` line in `setup.ts`, placed by what they depend on at shutdown — never start or stop them anywhere else.
- **New commands** go in `packages/backend/src/commands/implementations/` and implement `ICommand`. They're auto-discovered by `loadCommands()`.
- **New channel point reward handlers** go in `packages/backend/src/rewards/implementations/` and implement `IRewardHandler`, matched by exact `rewardTitle`. They're auto-discovered by `loadRewardHandlers()`.
- **Behaviour lives in code, not the database.** Commands and reward handlers are TypeScript classes; a table may hold a feature's own data (a banned-word list, a counter), never its logic.
- **Commands reach platforms through `StreamControlService`**, never through an integration directly, and never check auth themselves (see Platform Provider Layer).
- **A new platform capability** is a `PlatformCapability` value, an object type in `CapabilityApis`, its `CAPABILITY_OF_API` entry, and the façades' implementations; the compiler holds those together. Don't add a pass-through to `StreamControlService` — callers use `require()`.
- **Every outgoing chat message goes through `toSafeChatText()` and `OwnChatMessages.record()`** inside the platform façade — a new `IStreamPlatform` (or a new send method) must apply both, so the bot can never post a command or act on what it posted (see Chat Pipeline).
- **API-backed read commands need a cooldown.** `ICommand.cooldown` is per-viewer seconds; `CommandExecutor` exempts moderators and above, so a shared read/write command (`!game`, `!tags`, `!cw`) can be throttled for viewers without blocking a moderator's write.
- **New integrations** extend `BaseIntegration`, get decorated `@injectable()`/`@singleton()`, get registered with `IntegrationManager` in `setup.ts`'s `initializeComponents()`, and need a `MessageRouter` handler if they accept WebSocket messages. OAuth-capable integrations extend `OAuthIntegration` instead, and need an entry in the frontend's `oauthIntegrationRegistry.tsx` + a config in `oauthProviders.tsx`.
