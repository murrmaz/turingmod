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
npm run coverage           # Tests with coverage: totals in the terminal, and an HTML report in each workspace's coverage/ (settings: vitest.coverage.ts)
```

Vitest is configured in all three workspaces; tests live beside their subjects as `*.test.ts`. In the frontend, a test that renders (a component or a hook) is `*.test.tsx` and runs in jsdom with Testing Library; it renders inside `renderConsole()`/`consoleWrapper()` (`src/testing/render-console.tsx`, the app's providers over a fake backend) and gives the procedures it uses as fakes (`src/testing/fakeTrpc.ts`: `FakeSubscription` for a `watch` or a feed, plain functions for `mutate`/`query`, typed from the router, so a fake that stops matching its procedure doesn't compile), so no test needs a backend or mocks a hook; `CurrentLocation` beside the component shows where a link or navigation led. On a fresh checkout, run `npm run build:backend` (which builds shared too) before `type-check` or the frontend/backend tests: both import `@turingmod/shared` from its `dist/`, and the frontend type-checks its tRPC client against the backend's router type in `packages/backend/dist/` (`@turingmod/backend/trpc`), so a backend change to a procedure reaches the console's types only once the backend is rebuilt (if `dist/` was deleted but `tsconfig.build.tsbuildinfo` wasn't, `tsc --build` thinks it's up to date and does nothing: `npm run clean` first). `tsc --build` also never deletes the output of a renamed or deleted source, and commands, reward handlers and integrations are discovered by loading every module in their `dist/` folders, so after renaming or deleting one of those files, `npm run clean` and rebuild (restarting `npm run dev` if it was running). `build` and `dev` compile `tsconfig.build.json`, which leaves tests and their helpers (`testing.ts`, `testDatabase.ts`) out of `dist/`; `type-check` uses `tsconfig.json`, which includes them. The backend's `boot.smoke.test.ts` builds it and starts `dist/index.js` on an empty scratch database, since Vitest's esbuild emits no decorator metadata and so can't show a class tsyringe won't construct. There is no CI: run `check`, `type-check` and `test` before considering work done.

## Core Infrastructure

- **DI**: [tsyringe](https://github.com/microsoft/tsyringe) — `@singleton()` on app-lifetime classes, `@injectable()` on commands and reward handlers; `registerRootFactories()` in `setup.ts` for the handful of classes tsyringe can't auto-construct
- **EventBus**: `packages/backend/src/core/EventBus.ts`; every event name and payload type in `core/events.ts` (`EventMap`)
- **Application**: `packages/backend/src/core/Application.ts`
- **Feature service lifecycle**: `packages/backend/src/core/ServiceLifecycle.ts` (`IService`, `Subscriptions`); the ordered service list is in `setup.ts`
- **Setup/Bootstrap**: `packages/backend/src/setup.ts`
- **Entry Point**: `packages/backend/src/index.ts`
- **Environment**: `packages/backend/src/utils/loadEnv.ts` loads the repository-root `.env` (template: `.env.example`); it's the first import of the entry point (`index.ts`). Shell variables win over the file. `TuringModConfig` (`utils/Config.ts`) is what reads them, through one Zod schema (`parseEnvironment()`): a blank variable gets its default, an invalid one stops startup with a `ConfigurationError` naming it, and only `MASTER_PASSWORD` is required. The file's location is `ENV_FILE` (`utils/paths.ts`).

## Architecture

npm workspaces monorepo with three packages:

- **`packages/shared`** (`@turingmod/shared`) — what the backend and the console both run or both name: enums (`IntegrationStatus`, `PermissionLevel`, `StreamingPlatform`), Zod schemas both sides validate with (setup-dialog configs, `ActivityLogEntrySchema`), constants and small helpers (`TRPC_PATH`, `platformDisplayName()`, `messageOf()`), and the domain types procedures return (`IntegrationInfo`, `DataTableInfo`). Not the protocol: request and response shapes are tRPC procedures in the backend. Must be built first since both other packages depend on it.
- **`packages/backend`** (`@turingmod/backend`) — Node.js server with WebSocket + HTTP. Its package exports only the tRPC router's type (`@turingmod/backend/trpc`), so the console never bundles backend code. Dev mode runs `tsc --build --watch` and `node --watch dist/index.js` concurrently (not `tsx`: esbuild's TS transform — what `tsx` uses — doesn't emit `emitDecoratorMetadata`, which tsyringe's constructor injection needs).
- **`packages/frontend`** (`@turingmod/frontend`) — React 19 + React Router 7 + Vite 8 + shadcn/ui on Tailwind CSS v4 + TanStack Table. Dev server proxies `/trpc` to backend.

### Backend Layout

`packages/backend/src/` is layered, and Biome rejects an import that goes the wrong way
(`noRestrictedImports` overrides in `biome.json`):

- **Foundation:** `core/`, `database/`, `utils/`, `integrations/` (connections to the outside world)
  and `platforms/` (the façades over them). None of it imports `features/`. What a feature and the
  foundation both need moves down: a repository defines the shape it stores, and the feature imports
  that from it, even for a repository only one feature uses.
- **`features/`:** one folder per feature (`activity/`, `breaks/`, `chat/`, `commands/`, `effects/`,
  `live/`, `raids/`, `rewards/`, `sounds/`, `suggestions/`). Features may import each other, since
  some are real pipelines (`chat/` runs `commands/`, rewards play `effects/`).
- **`server/`** (the console's API) sits above features and may import them; a feature never imports
  it. `setup.ts` and `index.ts` sit above everything.

Tests and `testing.ts` helpers are exempt, as in the console.

### Backend Core Flow

Entry point: `packages/backend/src/index.ts` → calls `registerRootFactories()`, `initializeDatabase()` (open, migrate, validate every settings group) and `initializeComponents()` from `setup.ts` → resolves `Application` → `app.initialize()` (apply stored integration configs) → `app.start()`.

**Dependency injection** uses [tsyringe](https://github.com/microsoft/tsyringe), Microsoft's lightweight constructor-injection container. App-lifetime classes (integrations, services, façades, handlers — effectively everything) are decorated `@singleton()` alone, which makes a class injectable and registers it as a singleton, so adding `@injectable()` beside it is redundant; commands and reward handlers, which their loaders resolve once each, are `@injectable()`; tsyringe resolves a class's dependencies by reading its constructor's typed parameters via `reflect-metadata` — no string tokens, and a typo'd dependency is a compile error, not a runtime "Service not registered" failure. This reflection-based inference requires TypeScript's real compiler (`emitDecoratorMetadata`) to emit `design:paramtypes` — esbuild does not support this, which is why dev mode runs through `tsc --watch` rather than `tsx` (see above).

A handful of classes take primitives or derived values rather than other injectable classes (e.g. `Logger`'s log level, `DatabaseManager`'s file path, `Encryption`'s master password + DB-stored salt, `HttpServer`'s port/host and `TrpcServer`'s router/allowed-origins) — these can't be auto-constructed from decorated parameters, so they're registered via `container.register(Token, { useFactory: instanceCachingFactory(...) })` in `registerRootFactories()` (`setup.ts`) instead. `instanceCachingFactory` makes each factory lazy and run-once, like a singleton, which matters for `Encryption`: its factory reads a salt from the database and must not run before `initializeDatabase()` has created the schema.

Commands are auto-discovered by directory scan (`loadCommands.ts`): each file's default-exported class is `@injectable()`, and the loader calls `container.resolve(mod.default)` instead of registering it anywhere — tsyringe can construct any `@injectable()` class on demand, so dropping a new command file in `features/commands/implementations/` requires no other wiring. Reward handlers are loaded the same way (`loadRewardHandlers.ts`). Integrations are discovered too (`discoverIntegrations.ts`), by what they are rather than how they're exported: every class a module under `integrations/implementations/` exports that extends `BaseIntegration` (checked with `instanceof` on its prototype, without constructing it), so helper modules can sit beside them. They're found in file order, which doesn't matter: `IntegrationManager` orders startup and shutdown from the dependency graph.

**Feature services** (chat routing, rewards, breaks, effects, announcers — anything that isn't an
integration but subscribes to the bus or holds timers) implement `IService` and are added, in
order, to `ServiceLifecycle` in `setup.ts`. `Application` starts them before integrations, so a
subscriber sees the `platform.availability` changes that connecting causes, and stops them in
reverse before integrations, so a service can still reach OBS or Twitch to undo what it did.
Triggers (chat, redemptions, raids) go last in the list so they stop first: nothing new can start a
break or an effect while those are being restored. Each service keeps its bus subscriptions in a
`Subscriptions` and clears them in `stop()`. A failure a service carries on from but the streamer
must know about goes through its `failureReporter()` (`core/ServiceLifecycle.ts`), which logs it and
publishes `service.error`, putting it in the activity log and live feed; a log line alone reaches
only the terminal. A failure that recurs for as long as its cause lasts (one per chat message, or
per poll) goes through `RepeatingFailures`, which reports the first of a run. `announce()` lists a
platform that fails rather than throwing, so its caller passes the result to `reportAnnouncement()`.

**Console requests**: the console calls procedures on the tRPC router (`server/trpc/appRouter.ts`), served at `TRPC_PATH` by `TrpcServer`; each procedure's Zod input schema is checked before it runs, so procedures never check input shape themselves, and a malformed input is a `BAD_REQUEST` naming the bad fields. See Console ↔ Backend Protocol below.

**EventBus.** Integrations, services and the server communicate through `EventBus` (`core/EventBus.ts`) — a simple pub/sub with sync and async emit.
`emit()` calls handlers in subscription order but runs async ones concurrently, and resolves once
all have settled; a failing handler is logged, never propagated. No handler may depend on another
having run first.
It is typed against `EventMap` (`core/events.ts`), which declares every event name and its payload
type once, so an emitter and its subscribers can't drift apart. A new event is a new `EventMap` entry;
don't declare a payload type beside its emitter or consumer. Names are dot-separated camelCase
segments, most general first (`twitch.channelPoint.redemption`, `integration.status`).

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
- **Queries** (the command table, History, the data inspector) are read with `useServerQuery()`: on every
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
lists the capabilities it uses in `requiredCapabilities`, never platforms, and is offered wherever
they are all present: `CommandAvailability` applies that rule for chat, the simulator and
`commands.list` (each command's `availableOn`), and a command a platform doesn't offer is
`COMMAND_NOT_FOUND` there, like an unknown one. Every endpoint and platform rule lives in the façade
(`TwitchPlatform`, `YouTubePlatform`), never in a command or in an API integration. How the façades
and their capability sets are built, and how to add a capability, is in
[`packages/backend/src/platforms/CLAUDE.md`](packages/backend/src/platforms/CLAUDE.md).

**Commands never check authentication.** The façade decides, and only reports a problem once nothing
can recover it automatically — an expired access token is refreshed transparently by the provider, so
`NotAuthenticatedError` means a human must redo OAuth. Two paths handle it differently:
`requireUserId()` throws `NotAuthenticatedError`, which `CommandExecutor` maps, with
`toCommandError()` (`features/commands/utils/commandErrors.ts`), to a `NOT_AUTHENTICATED` result; mirrored *writes* instead
call `getUnavailableReason()` and list the platform as `skipped`, because a mirror replies in public
chat where the broadcaster's token state doesn't belong: chat hears the write failed, and the reason
goes to the activity log.

**Features react to a platform recovering through `platform.availability`, not `integration.status`.**
`PlatformAvailability` re-checks every façade's `getUnavailableReason()` on each integration status
change and publishes only transitions, so a feature like `RewardSync` ("Twitch is back, sync
rewards") never needs to know which integration name decides a platform's availability.

Deep dives into these subsystems live in `CLAUDE.md` files beside their code and load when you work there: under `features/`, `live/` (going live, Discord post), `breaks/`, `rewards/` (channel points, raids), `effects/` (facecam), `sounds/`, `chat/` (pipeline, own-message gate, moderation) and `activity/` (the activity log); and `database/` (data inspector), `integrations/` and `platforms/`.

### Frontend State

React Context for state management: `TrpcContext` (the tRPC client and its connection) and `AppStateProvider` (the integrations, read with `useIntegrationState()`, and the command table, with `useCommandList()`, as separate contexts so what reads one doesn't render for the other). State the backend keeps current through a tRPC `watch` subscription is read with `useSubscription()` (`hooks/useSubscription.ts`); anything read with a tRPC query, with `useServerQuery()` (`hooks/useServerQuery.ts`): read whenever the connection comes up and whenever its input changes, a superseded read aborted. Don't hand-write either in a new hook. Never write a ref during render: a callback an effect or its subscription needs the latest of goes through `useEffectEvent`, and one something else calls later (a click, a toast) is a plain dependency or, failing that, a ref written in an effect. Dialogs are rendered only while open, so each opening starts fresh rather than resetting its fields. Custom hooks: `useCommands()`, `useIntegrations()`, `useIntegrationActions()`, `useLiveLog()`, `useLiveFeed()`, `useActivityHistory()`, `useHistoryView()`, `useClientTable()`, `usePagedView()`, `useStateFor()`, `useInspectedTable()`, `useTableExport()`, `useFocusShortcut()`, `useYouTubeChat()`, `usePlatformLiveState()`, `useDataRows()`, `useSuggestions()`. Pages (code under `src/features/<page>/`) are listed once, in `PAGES` (`constants/pages.ts`), from which the routes in `app.tsx`, the sidebar, the ⌘K palette and the header's title are all made; a new page is a `PAGES` entry plus its component in `app.tsx`'s `PAGE_COMPONENTS`, which the compiler asks for, and a sidebar count beside it is one entry in the sidebar's `badges`. No route is written out anywhere else: a link into a page's state is built with `links` (`links.historyOf(user)`, `links.integration(name)`, `links.dataTable(table)`), and the URL parameters a page keeps its state in are named in `URL_PARAMS`, which the page reads them by. The pages: Dashboard, Commands (command table; the simulator is a sheet any page or the ⌘K palette opens with `useSimulator()`, `components/simulator.tsx`), Integrations, Suggestions, History, Data.

### Console UI

The console is dark-only and runs on the streamer's second monitor, so the live feed is the most
prominent thing on the Dashboard and integration health stays quiet until something breaks.
Components are [shadcn/ui](https://ui.shadcn.com) (new-york, zinc), vendored in
`src/components/ui/` from the shadcn repository; edit them there like any other source. Theme
tokens, including the accents for activity categories (`--cat-*`) and states (`--status-*`), are
CSS variables in `src/index.css`; a `Tone` (`lib/tone.ts`) names one for logic to pick, by what it
means: `ok` for something working, not `viewer`, though they're the same green. Use the tokens, not hex values or Tailwind's fixed palette (`red-900`). Text sizes are Tailwind's
plus the console's dense ones in `index.css` (`text-caption`, `text-data`, `text-body`), not pixel
values (`text-[13px]`); a size added there also goes in `lib/utils.ts`, or `cn()` mistakes it for a
colour and drops a class. `@/` is `src/`, and imports from outside a file's own folder use it: lint rejects `../`. Every table is `components/data-table/data-table.tsx`
over a TanStack table instance the page owns (sorting, filters and paging stay the page's, so the
same component serves client-side lists and server-paged queries), with optional row
virtualization for the live feed. A list held entirely in the console (Commands, Suggestions) gets
its table from `useClientTable()`. History (`activity.history`) and the Data page (the read-only
data inspector, below) are paged and filtered on the server, and keep their page and selected row
in `usePagedView()`. Either way a page and selection belong to what's being read, through
`useStateFor()`: they reset because that changed, however it changed, not because a setter
remembered to. New rows arriving don't reset a client table's page.

**Console layout.** `src/` is layered, and Biome rejects an import from a higher layer
(`noRestrictedImports` overrides in `biome.json`): `lib/`, `constants/` and `services/` hold logic
only; `context/` and `hooks/` hold state and draw nothing; `components/` is UI shared by pages;
`features/<page>/` is one page, which never imports another page. Something two pages share goes
down a layer, never sideways. An app-wide flow that is both state and UI (the OAuth dialogs, the
simulator) is split: its context and hook in `context/`, the provider that renders it in
`components/`. A hook that belongs to one page sits in that page's folder; one that two places use,
or that's generic (`useDebounced()`), goes in `hooks/`. File names are enforced too: `.tsx` files (UI) are
kebab-case, like the shadcn components, and `.ts` files (logic, hooks) camelCase; a test is named
after its subject. `testing/`, `app.tsx` and `index.tsx` sit above the layers. Only tests and
`testing/` itself may import `@/testing`, and lint applies no layer rules to them.

**Shared console pieces.** A page sits in a `PageLayout` (its padding, and `panel` for a
`DetailPanel`; the Dashboard's two-column grid is the exception), starts with `PageHeader` (title and what it's for; the Data page heads itself with its table's name instead), filters a
table with `SearchInput`, shows what's selected in a `DetailPanel` at its right edge, and builds a
form from `FormField`s, which tie each label and hint to the control they're for (all in
`components/`). The activity tables share `components/activity/`: their columns, the category
tabs (`FeedCategoryTabs`) and the entry sheet (`EventSheet`), which takes the rows the table
shows and steps the selection through them with ↑/↓ itself.

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
  optional or have a default, but a value that is present must be valid. (Activity log payloads
  are the one exception, since the capped log ages old rows out: see
  `packages/backend/src/features/activity/CLAUDE.md`.) Schemas for a third
  party's responses use `z.object`, requiring only the fields we use. Use `.exactOptional()` for
  optional fields, to match `exactOptionalPropertyTypes`.
- **Errors**: throw only `Error`s, with a message (Biome's `useThrowOnlyError` and `useErrorMessage`
  enforce it). A caught value is still `unknown`, because dependencies can throw anything: narrow it
  where it's caught with `messageOf()` or `toError()` (`shared/src/utils/errors.ts`) rather than
  repeating `instanceof Error` checks or passing `unknown` on. A log call takes the caught value
  itself (`logger.error(message, error)`, or `logger.warn(message, { platform, error })`), never
  `messageOf(error)`: `Logger` writes an Error with its stack and `cause`, which the message alone
  loses. `messageOf()` is for text a person reads, such as a chat reply.

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
- **New feature services** implement `IService` and get one `services.add(...)` line in `setup.ts`, placed by what they depend on at shutdown — never start or stop them anywhere else. `setup.test.ts` fails on a class that implements `IService` without that line.
- **New commands** go in `packages/backend/src/features/commands/implementations/` and implement `ICommand`. They're auto-discovered by `loadCommands()`. A command that calls something outside itself doesn't catch the failure: it names what chat hears in `failureMessage` and lets the call throw, and `CommandExecutor` logs and reports it (lint rejects `toCommandError` in a command).
- **New channel point reward handlers** go in `packages/backend/src/features/rewards/implementations/` and implement `IRewardHandler`, matched by exact `rewardTitle`. They're auto-discovered by `loadRewardHandlers()`.
- **Behaviour lives in code, not the database.** Commands and reward handlers are TypeScript classes; a table may hold a feature's own data (a banned-word list, a counter), never its logic.
- **Commands reach platforms through `StreamControlService`**, never through a platform's integrations directly, and never check auth themselves (see Platform Provider Layer). An integration that isn't a platform (Spotify, sound) is used directly, through its `request()` or the feature class over it.
- **A new platform capability** is a `PlatformCapability` value, an object type in `CapabilityApis`, its `CAPABILITY_OF_API` entry, and the façades' implementations; the compiler holds those together. Don't add a pass-through to `StreamControlService` — callers use `require()`.
- **Every outgoing chat message goes through `toSafeChatText()` and `OwnChatMessages.record()`** (`recordText()` for a platform call that returns no id) inside the platform façade — a new `IStreamPlatform` (or a new send method) must apply both, so the bot can never post a command or act on what it posted (see Chat Pipeline). `platforms/chatSends.test.ts` holds every send to that, and fails on a `send*` method it doesn't cover.
- **API-backed read commands need a cooldown.** `ICommand.cooldown` is per-viewer seconds; `CommandExecutor` exempts moderators and above, so a shared read/write command (`!game`, `!tags`, `!cw`) can be throttled for viewers without blocking a moderator's write. `commandCooldowns.test.ts` fails on a command a viewer can run that has a `failureMessage` and no cooldown.
- **New integrations** extend `BaseIntegration`, get decorated `@singleton()`, go in a folder under `integrations/implementations/` (auto-discovered by `discoverIntegrations()`: no registration line; abstract base classes stay in `integrations/`, since `abstract` is erased and one found there stops startup), return their group's object from `getGroup()` if they belong to one (see `integrations/CLAUDE.md`), and need a procedure in the tRPC router (`server/trpc/`) if the console controls them. An API that calls on behalf of a separate auth integration extends `AuthorizedApiIntegration` instead (a public API, or one with its token in its own config, stays on `BaseIntegration`). OAuth-capable integrations extend `OAuthIntegration` instead, and need an entry in the frontend's `oauth-integration-registry.tsx` + a config in `oauth-providers.tsx`.
