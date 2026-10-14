# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Note**: Keep this file updated when adding new major systems or changing module organization. Focus on stable structural information, not implementation details.
>
> Deep dives into single subsystems live in `CLAUDE.md` files beside their code (`packages/backend/src/integrations/`, `packages/backend/src/platforms/`), which Claude Code loads when you work in those directories. Keep them updated with their code, and keep this file to what every session needs.

## Commands

```bash
# Development (starts both backend + frontend via concurrently)
npm run dev                # Backend on :8080 (SERVER_PORT), Frontend on :3000 (proxies /ws)
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

Vitest is configured in all three workspaces; tests live beside their subjects as `*.test.ts`. On a fresh checkout, run `npm run build:shared` before `type-check` or the frontend/backend tests, since both import `@turingmod/shared` from its `dist/` (if `dist/` was deleted but `tsconfig.tsbuildinfo` wasn't, `tsc --build` thinks it's up to date and does nothing: `npm run clean` first). There is no CI: run `check`, `type-check` and `test` before considering work done.

## Quick Reference: File Locations

Use this to quickly locate files without searching. Organized by system/feature.

### Integration System
- **UI**: `packages/frontend/src/components/integrations/IntegrationPanel.tsx` (the Integrations page: cards with Start/Stop and OAuth setup) + `dashboard/HealthMonitor.tsx` (read-only status lights on the dashboard)
- **OAuth modal wiring**: `packages/frontend/src/components/integrations/IntegrationOAuthModals.tsx` — the setup → authorize handoff, looked up from the registry below
- **Setup Modal**: `packages/frontend/src/components/integrations/SetupModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Modal**: `packages/frontend/src/components/integrations/OAuthModal.tsx` — generic, parameterized by `OAuthProviderConfig`
- **OAuth Provider Configs**: `packages/frontend/src/components/integrations/oauthProviders.tsx` (per-provider content) + `oauthIntegrationRegistry.tsx` (name → modal/config lookup)
- **Backend Manager**: `packages/backend/src/integrations/IntegrationManager.ts`
- **OAuth flow**: `packages/backend/src/integrations/OAuthFlowService.ts` — authorization URL, single-use `state`, callback routes, code exchange. Client credentials come only from the console's setup dialog (stored encrypted), never from `.env`; `IntegrationInfo.oauth.configured` tells the console whether to open setup or authorization
- **Dependency graph**: `packages/backend/src/integrations/DependencyGraph.ts` — pure sort/levels/dependents/validate queries over the registered integrations
- **Base Class**: `packages/backend/src/integrations/BaseIntegration.ts` — shared status/error/event-emitter plumbing; all integrations extend this
- **OAuth base class**: `packages/backend/src/integrations/OAuthIntegration.ts` — `OAuthIntegration<TConfig>` (extends `BaseIntegration`): credentials, redirect URI, token persistence, and the no-token / missing-scope checks before connecting
- **Interfaces**: `packages/backend/src/integrations/interfaces/IIntegration.ts`, `IOAuthIntegration.ts` (extends `IIntegration` for OAuth-capable integrations)
- **Implementations**: `packages/backend/src/integrations/implementations/*/` (Twitch, YouTube, Spotify, OBS, Sound; Discord and Arduino are placeholders whose `start()` does nothing)
- **YouTube chat stream client**: `packages/backend/src/integrations/implementations/youtube/YouTubeChatStream.ts` + the response frame splitter `parseJsonFrames.ts` beside it
- **WebSocket Handlers**: `packages/backend/src/server/handlers/IntegrationHandler.ts`, `OAuthHandler.ts`, `YouTubeHandler.ts`
- **Types & Enums**: `packages/shared/src/types/integration.ts`

### Commands System
- **Interface**: `packages/backend/src/commands/interfaces/ICommand.ts`
- **Implementations**: `packages/backend/src/commands/implementations/*.ts`
- **Loader**: `packages/backend/src/commands/loadCommands.ts`
- **Results**: `packages/backend/src/commands/utils/results.ts` — `ok()`, `fail()`, and `mirrorReply()` for title/game/tags writes
- **Parser**: `packages/backend/src/commands/parseCommand.ts` — the one place command text becomes a name and arguments, for chat and the simulator alike
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

### Stream Breaks
- **Lifecycle**: `packages/backend/src/breaks/BreakService.ts` — starts/extends/ends breaks; listens for `twitch.ad.break`; emits `stream.break.started`/`.ended`
- **OBS overlay**: `packages/backend/src/breaks/ObsBreakOverlay.ts` — snapshot/apply/restore across all canvases, scenes and groups
- **OBS scene walking**: `packages/backend/src/integrations/implementations/obs/sceneGraph.ts` — every scene on every canvas, and every item in a scene including inside its groups (shared by breaks and effects)
- **Ad pre-warnings**: `packages/backend/src/breaks/AdWarningScheduler.ts`
- **Settings**: `packages/backend/src/breaks/breakSettings.ts` (schema and defaults, `BREAK_SETTINGS`), stored under the `breaks` key via `database/repositories/SettingsRepository.ts`
- **Manual trigger**: `packages/backend/src/commands/implementations/BreakCommand.ts` (`!break`)

### Activity Log
- **Forwarder**: `packages/backend/src/activity/ActivityForwarder.ts` — maps EventBus events to activity categories (`EVENT_CATEGORIES`), broadcasts each to the console's live tail and persists all but chat
- **Storage**: `packages/backend/src/database/repositories/ActivityLogRepository.ts` (capped at 5000 rows)
- **Queries**: `packages/backend/src/server/handlers/ActivityHandler.ts` (`activity.query`, for the History page)
- **Frontend**: `components/dashboard/LiveLog.tsx` + `hooks/useLiveLog.ts` (live tail), `components/history/History.tsx`

### WebSocket Protocol
- **Server**: `packages/backend/src/server/WebSocketServer.ts`
- **Router**: `packages/backend/src/server/MessageRouter.ts`
- **Messages/Types**: `packages/shared/src/protocol/messages.ts`
- **Request schemas**: `packages/shared/src/protocol/requests.ts` — Zod schema per client → server payload (`REQUEST_PAYLOAD_SCHEMAS`), types inferred from them
- **Frontend Context**: `packages/frontend/src/context/WebSocketContext.tsx`
- **Frontend Hooks**: `packages/frontend/src/hooks/useWebSocket.ts` (`useWebSocket()`, `useWebSocketMessage()`)

### Database
- **Manager**: `packages/backend/src/database/DatabaseManager.ts`
- **Repositories**: `packages/backend/src/database/repositories/*.ts`
- **Migrations**: `packages/backend/src/database/migrations/*.ts`, listed in `migrations/index.ts` (`ALL_MIGRATIONS`), run automatically on startup
- **Import from the original bot**: `packages/backend/src/tools/importOriginal.ts` (`npm run import:original -w @turingmod/backend`) + `originalData.ts`

### Core Infrastructure
- **DI**: [tsyringe](https://github.com/microsoft/tsyringe) — `@singleton()` on app-lifetime classes, `@injectable()` on commands and reward handlers; `registerRootFactories()` in `setup.ts` for the handful of classes tsyringe can't auto-construct
- **EventBus**: `packages/backend/src/core/EventBus.ts`; every event name and payload type in `core/events.ts` (`EventMap`)
- **Application**: `packages/backend/src/core/Application.ts`
- **Feature service lifecycle**: `packages/backend/src/core/ServiceLifecycle.ts` (`IService`, `Subscriptions`); the ordered service list is in `setup.ts`
- **Setup/Bootstrap**: `packages/backend/src/setup.ts`
- **Entry Point**: `packages/backend/src/index.ts`
- **Environment**: `packages/backend/src/utils/loadEnv.ts` loads the repository-root `.env` (template: `.env.example`); it's the first import of each entry point (`index.ts`, `tools/importOriginal.ts`). Shell variables win over the file. `TuringModConfig` (`utils/Config.ts`) is what reads them.

### Frontend State
- **App State Context**: `packages/frontend/src/context/AppStateContext.tsx`
- **Integration Hooks**: `packages/frontend/src/hooks/useIntegrations.ts`
- **Integration actions**: `packages/frontend/src/hooks/useIntegrationActions.ts` (Start/Stop/OAuth decisions and status colours, shared by the Integrations page and the dashboard)
- **Command Hooks**: `packages/frontend/src/hooks/useCommands.ts`
- **YouTube chat control**: `packages/frontend/src/hooks/useYouTubeChat.ts` + `components/dashboard/YouTubeChatControl.tsx`

## Architecture

npm workspaces monorepo with three packages:

- **`packages/shared`** (`@turingmod/shared`) — WebSocket protocol types, message creators, shared enums (IntegrationStatus, PermissionLevel, MessageType). Must be built first since both other packages depend on it.
- **`packages/backend`** (`@turingmod/backend`) — Node.js server with WebSocket + HTTP. Dev mode runs `tsc --build --watch` and `node --watch dist/index.js` concurrently (not `tsx`: esbuild's TS transform — what `tsx` uses — doesn't emit `emitDecoratorMetadata`, which tsyringe's constructor injection needs).
- **`packages/frontend`** (`@turingmod/frontend`) — React 19 + React Router 7 + Vite 8 + Cloudscape Design System. Dev server proxies `/ws` to backend.

### Backend Core Flow

Entry point: `packages/backend/src/index.ts` → calls `registerRootFactories()`, `initializeDatabase()` (open, migrate, validate every settings group) and `initializeComponents()` from `setup.ts` → resolves `Application` → `app.initialize()` (apply stored integration configs) → `app.start()`.

**Dependency injection** uses [tsyringe](https://github.com/microsoft/tsyringe), Microsoft's lightweight constructor-injection container. App-lifetime classes (integrations, services, façades, handlers — effectively everything) are decorated `@singleton()` alone, which makes a class injectable and registers it as a singleton, so adding `@injectable()` beside it is redundant; commands and reward handlers, which their loaders resolve once each, are `@injectable()`; tsyringe resolves a class's dependencies by reading its constructor's typed parameters via `reflect-metadata` — no string tokens, and a typo'd dependency is a compile error, not a runtime "Service not registered" failure. This reflection-based inference requires TypeScript's real compiler (`emitDecoratorMetadata`) to emit `design:paramtypes` — esbuild does not support this, which is why dev mode runs through `tsc --watch` rather than `tsx` (see above).

A handful of classes take primitives or derived values rather than other injectable classes (e.g. `Logger`'s log level, `DatabaseManager`'s file path, `Encryption`'s master password + DB-stored salt, `HttpServer`/`WebSocketServer`'s port/host/allowed-origins) — these can't be auto-constructed from decorated parameters, so they're registered via `container.register(Token, { useFactory: instanceCachingFactory(...) })` in `registerRootFactories()` (`setup.ts`) instead. `instanceCachingFactory` makes each factory lazy and run-once, like a singleton, which matters for `Encryption`: its factory reads a salt from the database and must not run before `initializeDatabase()` has created the schema.

Commands are auto-discovered by directory scan (`loadCommands.ts`): each file's default-exported class is `@injectable()`, and the loader calls `container.resolve(mod.default)` instead of registering it anywhere — tsyringe can construct any `@injectable()` class on demand, so dropping a new command file in `commands/implementations/` requires no other wiring. Reward handlers are loaded the same way (`loadRewardHandlers.ts`).

**Feature services** (chat routing, rewards, breaks, effects, announcers — anything that isn't an
integration but subscribes to the bus or holds timers) implement `IService` and are added, in
order, to `ServiceLifecycle` in `setup.ts`. `Application` starts them before integrations, so a
subscriber sees the `platform.availability` changes that connecting causes, and stops them in
reverse before integrations, so a service can still reach OBS or Twitch to undo what it did.
Triggers (chat, redemptions, raids) go last in the list so they stop first: nothing new can start a
break or an effect while those are being restored. Each service keeps its bus subscriptions in a
`Subscriptions` and clears them in `stop()`.

**Message routing**: WebSocket messages arrive at `WebSocketServer`, which checks the envelope against `WebSocketMessageSchema` → `MessageRouter` parses the payload against its type's schema in `REQUEST_PAYLOAD_SCHEMAS` and dispatches by `MessageType` → handler classes (`CommandHandler`, `IntegrationHandler`, `OAuthHandler`, `ActivityHandler`, `YouTubeHandler`, registered in `setup.ts`) receive a typed, valid payload and return response messages. A malformed payload is answered with `INVALID_PAYLOAD` naming the bad fields; handlers never check payload shape themselves.

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
OBS and Sound are single integrations, and Discord and Arduino are placeholders. The status an
integration sets is what the console shows (`integration.status` → `INTEGRATION_STATUS`).

How all of this works (stored configs and their schemas, `enabled`, dependency cascades and
`dependencyFailurePolicy`, resolving clients on access, YouTube's chat stream, OAuth and token
refresh, integration events) is in
[`packages/backend/src/integrations/CLAUDE.md`](packages/backend/src/integrations/CLAUDE.md), which
Claude Code loads when you work in that directory. Read it before changing an integration or
anything that holds one of their clients.

### WebSocket Protocol

All messages follow `IWebSocketMessage<T>` from `packages/shared/src/protocol/messages.ts`: `{ id, type, timestamp, payload }`. Message IDs are UUIDs used for request/response correlation. Use `createMessage()` and typed creator functions (e.g., `createCommandResultMessage()`) to construct messages.

### Database

`node:sqlite` (`DatabaseSync`, file-backed, WAL mode) — chosen over `better-sqlite3` to avoid reintroducing a native-compilation dependency. Every write commits durably as it happens; there is no in-memory buffering or periodic flush to lose writes or corrupt the file on crash. Access via repository pattern: `IntegrationStateRepository`, `SettingsRepository`, `ActivityLogRepository` (the record of everything that happened, commands included), plus repositories for data owned by single features — `BannedWordRepository`, `CounterRepository`, `IntervalMessageRepository`, `SuggestionRepository`. Repositories are synchronous, because `node:sqlite` is: they return values, not promises. `DatabaseManager.transaction()` takes a synchronous callback and rejects an async one, since an `await` inside it would let other writes on the one shared connection join the transaction. A new migration goes in `migrations/` and must be added to `ALL_MIGRATIONS`. Tests get a migrated temp database from `repositories/testDatabase.ts`. Integration configs are encrypted with AES-256-GCM before storage, keyed from `MASTER_PASSWORD` and a per-install salt kept in the `settings` table (without `MASTER_PASSWORD`, a fixed default password is used; it's only refused when `NODE_ENV=production`); app-level settings in the `settings` table (`SettingsRepository`) are plain JSON, so nothing secret belongs there. Each settings group is a `SettingsDefinition` (its key plus a strict Zod schema whose defaults apply when nothing is stored, e.g. `BREAK_SETTINGS`), read and written through `SettingsRepository.get()`/`set()`, which throw on a value that doesn't fit. A new group is added to `ALL_SETTINGS` in `setup.ts`, which reads every group at startup so bad settings stop TuringMod there with the fields named. The console has no settings UI yet: outside tests nothing calls `set()`, so stored settings are only ever the defaults or what was written to the database directly.

### Platform Provider Layer

`IStreamPlatform` is a platform-agnostic façade over one platform's integration group, registered
in `PlatformRegistry` and consumed through `StreamControlService`.

Commands and features reach a platform only through `StreamControlService`: its mirrored writes
(`setTitle()`, `setGame()`, `setTags()`), `announce()`, and `require(platform, 'channelPoints')`,
which returns that platform's capability object, typed, or throws. What only some platforms can do
is an optional capability object on `IStreamPlatform` (all listed in `CapabilityApis`). A command
lists the capabilities it uses in `requiredCapabilities` and is hidden on platforms without them
(`CommandExecutor` treats hidden as `COMMAND_NOT_FOUND`); the console gets each command's
`availableOn` in `COMMAND_LIST`. Every endpoint and platform rule lives in the façade
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

React Context for state management: `WebSocketContext` (connection + send/subscribe) and `AppStateContext` (commands, integrations). Custom hooks: `useWebSocket()`, `useWebSocketMessage()`, `useCommands()`, `useIntegrations()`, `useIntegrationActions()`, `useLiveLog()`, `useYouTubeChat()`. Pages (`App.tsx`): Dashboard, Commands (command table + simulator), Integrations, History.

### HTTP Server

Minimal Node.js `http` server (`server/HttpServer.ts`) on `SERVER_PORT`, which also hosts the WebSocket endpoint (`/ws`) — the backend has one port. The console connects to `/ws` on its own origin; in development Vite proxies that to the backend. Serves static frontend build in production. OAuth callback routes (`/callback/twitch`, `/callback/spotify`, `/callback/youtube`) are built from each `IOAuthIntegration.getCallbackPath()` via `OAuthFlowService.getCallbackRoutes()`, not hardcoded; it refuses two integrations claiming one path. Redirect URIs are derived, never stored or sent by the console: `getRedirectUri()` combines the callback path, `SERVER_PORT`, and the one loopback host each provider accepts for plain HTTP (Twitch `localhost`; Spotify and Google `127.0.0.1`). Health check at `/health`. Localhost-only binding enforced.

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
- **Integration lifecycle** — `IntegrationManager` calls `initialize(config)` before `start()`: at load, and again only when the config is replaced. An integration with a config declares a Zod schema for it and parses it in `initialize()` with `parseConfig()`. Saving its own config (OAuth tokens) goes through `IntegrationStateRepository.saveConfig()`, which never changes `enabled`.
- **New feature services** implement `IService` and get one `services.add(...)` line in `setup.ts`, placed by what they depend on at shutdown — never start or stop them anywhere else.
- **New commands** go in `packages/backend/src/commands/implementations/` and implement `ICommand`. They're auto-discovered by `loadCommands()`.
- **New channel point reward handlers** go in `packages/backend/src/rewards/implementations/` and implement `IRewardHandler`, matched by exact `rewardTitle`. They're auto-discovered by `loadRewardHandlers()`.
- **Behaviour lives in code, not the database.** Commands and reward handlers are TypeScript classes; a table may hold a feature's own data (a banned-word list, a counter), never its logic.
- **Commands reach platforms through `StreamControlService`**, never through a platform's integrations directly, and never check auth themselves (see Platform Provider Layer). An integration that isn't a platform (Spotify, sound) is used directly, through its `request()` or the feature class over it.
- **A new platform capability** is a `PlatformCapability` value, an object type in `CapabilityApis`, its `CAPABILITY_OF_API` entry, and the façades' implementations; the compiler holds those together. Don't add a pass-through to `StreamControlService` — callers use `require()`.
- **Every outgoing chat message goes through `toSafeChatText()` and `OwnChatMessages.record()`** inside the platform façade — a new `IStreamPlatform` (or a new send method) must apply both, so the bot can never post a command or act on what it posted (see Chat Pipeline).
- **API-backed read commands need a cooldown.** `ICommand.cooldown` is per-viewer seconds; `CommandExecutor` exempts moderators and above, so a shared read/write command (`!game`, `!tags`, `!cw`) can be throttled for viewers without blocking a moderator's write.
- **New integrations** extend `BaseIntegration`, get decorated `@singleton()`, get registered with `IntegrationManager` in `setup.ts`'s `initializeComponents()`, and need a `MessageRouter` handler if they accept WebSocket messages. OAuth-capable integrations extend `OAuthIntegration` instead, and need an entry in the frontend's `oauthIntegrationRegistry.tsx` + a config in `oauthProviders.tsx`.
