# Tech Debt & Code Quality Findings

Tracking document from a full-repo assessment (2026-07-20). Each item is meant to be
scoped and addressed independently, likely across several separate sessions. Update
the status inline as items are picked up.

Status legend: `TODO` / `IN PROGRESS` / `DONE` / `WON'T FIX`

---

## Priority 1

### 1. Revisit unit test coverage
**Status:** IN PROGRESS

Vitest is now wired up in all three workspaces (`npm run test` at the root, or
per-workspace) with seed tests proving the framework works end-to-end:
`packages/shared/src/protocol/messages.test.ts` (message creator functions) and
`packages/backend/src/utils/Encryption.test.ts` (encrypt/decrypt round-trip,
tamper detection, key derivation). Frontend has a config but no tests yet —
component tests will need `jsdom` + `@testing-library/react` added when the first
one is written. Explicitly not gated on CI or pre-commit (no CI in this repo; see
item #16).

Remaining, to be picked up incrementally over time: database repository layer
(needs an in-memory sql.js fixture), `DatabaseManager` save/dirty-flag behavior
(ties into item #5), `IntegrationManager`'s topological dependency sort and OAuth
state lifecycle (would have caught item #3).

### 2. `HealthMonitor` doesn't measure real health
**Status:** DONE

Decided the "System Status: Healthy/Degraded" indicator wasn't worth fixing — it
never carried more information than the per-integration status lights already show
(a red light is more visually distinct than a generic "Degraded" anyway), and any
real rollup would have meant reviving the still-unused `HealthUpdatePayload`/
`HEALTH_UPDATE` protocol type (item #7) for a single dashboard field. Removed it
instead: `isHealthy` is gone from `AppStateContext.tsx`, and `HealthMonitor.tsx` now
only renders the integration light row.

The real gap this surfaced was that losing the WebSocket connection was easy to
miss — just the word "Disconnected" in the header's top-right corner, not visually
distinct. Added a full-width red banner (`Header.tsx`) shown only while
disconnected, with its own plain CSS (no dependency on Cloudscape's internal scoped
class names, which are version-hashed and would've silently broken on a Cloudscape
upgrade). Since the banner now makes the disconnected state unmissable, also
simplified the header's connection indicator: it shows only a small "Connected"
pill when connected, and only the "Reconnect" button (no redundant "Disconnected"
text) when not — the old always-visible Connected/Disconnected label was
restating what the banner already says.

Verified in a real browser via Playwright: banner absent + "Connected" pill shown
when genuinely connected; banner present + "Reconnect" button (no "Disconnected"
text) shown when the socket is down.

### 3. Broken OAuth path in `TwitchAuthIntegration`
**Status:** DONE

Investigation found the literal bug as described — the unregistered `state` in
`start()`'s no-token branch — is currently **unreachable**: the frontend never shows a
plain "Start" button for OAuth integrations (only "Authorize", which goes through the
working `getOAuthAuthorizationUrl` path), and every code path that flips an integration
to `enabled` in the DB (`saveTokens` inside `exchangeCode`/`onRefresh`) does so in the
same write that persists a real access token. So `start()` never actually runs with a
missing token today. Left the dead branch as-is rather than deleting it, since it's
harmless and low-priority cleanup on its own.

Digging into *why* this ticket felt plausible surfaced a real, related bug instead:
`TwitchAuthIntegration.start()` called `authProvider.addUserForToken()` **before**
subscribing to Twurple's `onRefresh` event. Twurple's `addUserForToken` refreshes an
expired token synchronously inside that same call and fires `onRefresh` internally —
so a stale-but-refreshable token (the expected case once integrations start
auto-starting on boot per item #1's future work) would get refreshed in memory but
never persisted back to the DB, since our listener wasn't registered yet to catch it.
Fixed by moving the `onRefresh`/`onRefreshFailure` registration above the
`addUserForToken()` call. Confirmed via reading Twurple's source
(`node_modules/@twurple/auth/lib/providers/RefreshingAuthProvider.js`) that this race
is specific to Twitch/Twurple — `SpotifyAuthIntegration` never refreshes eagerly in
`start()`, and `YouTubeAuthIntegration`'s `oauth2Client.on('tokens', ...)` listener is
already registered before any refresh could occur.

Also fixed as a related polish item: a genuinely dead refresh token (revoked/expired)
now sets `IntegrationStatus.NEEDS_REAUTH` instead of a generic `ERROR`, distinguished
via Twurple's `InvalidTokenError`/`InvalidTokenTypeError` or an HTTP 400 from the token
endpoint (`HttpStatusCodeError`, added as an explicit `@twurple/api-call` dependency
rather than relying on it as a phantom transitive one).

Covered by `TwitchAuthIntegration.test.ts` (new): asserts a stale-token boot persists
the refreshed token, and that a dead refresh token lands on `NEEDS_REAUTH` rather than
`ERROR`.

---

## Priority 2

### 4. Hung requests on WebSocket disconnect
**Status:** DONE

`packages/frontend/src/services/WebSocketClient.ts:139-164` — `sendAndWaitForResponse`
registered a response handler keyed by message id but never cleaned it up on
`disconnect()`/socket close. If the connection dropped mid-request, callers (OAuth
modal, setup modal, live log, history page, and others) would hang for the full 30s
timeout instead of failing fast with a visible error. The socket only ever connects to
`localhost`, so the realistic trigger isn't network flakiness but a backend
restart/crash or the user hitting "Reconnect" — and since there's no reconnect/backoff
logic anywhere in the app, the same `WebSocketClient` instance (and its
`messageHandlers` map) persists across a manual disconnect→reconnect cycle, so stale
handlers could otherwise survive it.

Fixed with a new private `handleConnectionLoss()`, called from both `ws.onclose` and
`disconnect()`: it rejects every pending `messageHandlers` entry with a synthetic
`'Connection closed'` error message (via the existing `createErrorMessage` helper —
routing through the handler that `sendAndWaitForResponse` already installs also
cancels its timeout, so no changes were needed inside that method) and drops anything
left in `messageQueue`, so a message queued during a dead connection doesn't get
silently resent to the next reconnect on behalf of a caller who already gave up.

This is also the first test in the frontend package: `WebSocketClient.test.ts` (new),
covering disconnect-while-pending, server-initiated close, queued-message drop, and
that a later request on the same instance still resolves normally. `vitest` for
frontend runs under `environment: 'node'` with no DOM dependency needed here.

### 5. Database auto-save data-loss window
**Status:** TODO

`packages/backend/src/database/DatabaseManager.ts` (sql.js, in-memory WASM SQLite)
only persists to disk every 5s or on clean `close()`. An unclean process exit
(SIGKILL, crash, power loss) between saves can lose recent writes, including
freshly-issued OAuth tokens. Needs confirmation that shutdown signals (SIGINT/SIGTERM)
reliably reach `Application.stop()` → forced final save; if not, that's the fix.

### 6. Stub integrations silently report as connected
**Status:** TODO

`packages/backend/src/integrations/implementations/DiscordIntegration.ts` and
`ArduinoIntegration.ts` are unimplemented placeholders (`TODO` comments in both) that
still call `setStatus(IntegrationStatus.CONNECTED)` in `start()` with no real
connection behind it. Either implement them, or make their status honestly reflect
"not implemented" so the UI doesn't show a working integration that does nothing.

### 7. Dead / inconsistently-used protocol surface
**Status:** TODO

`packages/shared/src/protocol/messages.ts` exports creator functions
(`createIntegrationStartMessage`, `createIntegrationStopMessage`,
`createHealthUpdateMessage`, `createPingMessage`) that are never called anywhere —
call sites instead build raw message literals (e.g.
`packages/frontend/src/hooks/useIntegrations.ts:22,47`). `HEALTH_UPDATE`/`PING`
payload types exist but neither side ever emits them. This weakens the whole point of
the creator-function pattern (compile-time safety on payload shape changes). Worth
tying into item #2 above if `HEALTH_UPDATE` gets wired up for real health reporting.

### 8. Docs drift — CLAUDE.md and README out of date
**Status:** TODO

- `CLAUDE.md` references `packages/frontend/src/components/dashboard/IntegrationStatus.tsx`
  as the table-view UI; that file no longer exists (consolidated into
  `HealthMonitor.tsx` in commit `121bbf1`).
- `README.md` describes a per-command "Test" button that was removed in commit
  `cb94622`.
- `README.md`'s "Currently Supported / Planned" integrations list is stale — Spotify,
  Discord (stub), Sound, and OBS already exist under
  `packages/backend/src/integrations/implementations/`.

### 9. OAuth modal state leak
**Status:** TODO

`packages/frontend/src/hooks/useIntegrationActions.ts` (`closeOAuthModal`/
`closeSetupModal`, around lines 86-99) never resets `activeOAuthIntegration` back to
`null`. `IntegrationOAuthModals.tsx` keeps the bound `OAuthModal`/`SetupModal`
rendered (just `visible=false`) for the rest of the session, so the
`OAUTH_CODE_RECEIVED` subscription and popup-monitoring interval in `OAuthModal.tsx`
stay live indefinitely after first use. Low-grade leak, not a crash.

---

## Priority 3 (low severity / polish)

### 10. Magic platform strings bypass shared enum
**Status:** DONE
`packages/backend/src/integrations/implementations/TwitchEventSubIntegration.ts:322,342,347`
hardcode `'twitch'` instead of using the `Platform` enum from `@turingmod/shared`,
inconsistent with the enum discipline used elsewhere (e.g. `server/validation.ts`).

### 11. `EventBus` bypasses injected Logger
**Status:** DONE
`packages/backend/src/core/EventBus.ts:82,104` use raw `console.error` instead of the
DI-provided `Logger`, inconsistent with logging conventions elsewhere.

### 12. Dead hook: `useWebSocketMessage`
`packages/frontend/src/hooks/useWebSocket.ts:16-31` — zero call sites in the current
tree. Either remove or confirm it's intentionally kept for external/future use.

### 13. Hardcoded WebSocket URL, no env override
`packages/frontend/src/context/WebSocketContext.tsx:48` hardcodes
`ws://localhost:8080/ws`. No `import.meta.env` override, so a non-default backend
port/host requires a source edit.

### 14. Accessibility gap on integration status lights
`packages/frontend/src/components/dashboard/HealthMonitor.tsx:18-37` —
`IntegrationLight` relies on a native `title` attribute (tooltip) as the only
explanation of state, which is invisible to keyboard/screen-reader users since the
badge isn't focusable. Documented as a deliberate simplification in the code comment,
but worth a real a11y pass.

### 15. Duplicated OAuth token decrypt on startup
`packages/backend/src/integrations/IntegrationManager.ts` (`loadIntegrations` ~83-107,
then `startEnabledIntegrations`/`startIntegration` ~198-204) re-fetches and
re-decrypts each integration's config twice during startup. Not incorrect, just
wasteful and a minor risk of the two phases drifting out of sync.

### 16. No type-check gate on commit
Pre-commit hook (Husky + lint-staged) only runs `biome check --write`; no
`type-check` or build step runs until CI (which doesn't exist) or a manual
`npm run check`/`npm run build`. Worth deciding if this is intentional
(speed of commit) or should be tightened.

### 17. Leftover Biome version pin
**Status:** DONE

Root `package.json`'s `allowScripts` allowlist pinned `@biomejs/biome@1.9.4` while
the devDependency is `^2.0.0` (leftover from the 2.5 upgrade in `009239b`). Updated
the pin to `@biomejs/biome@2.5.4` to match the actually-installed version.

---

## Explicitly not tracked (reviewed and dismissed)

- **Raw error details forwarded to WebSocket client** (`CommandExecutor.ts:165` →
  `CommandHandler.handleExecute`) — not a real concern since the only client is the
  user's own browser on localhost, a trusted entity.
