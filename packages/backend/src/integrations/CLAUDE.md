# Integrations

How the integration layer works: `BaseIntegration`/`OAuthIntegration`, `IntegrationManager`, and the implementations under `implementations/`. Claude Code loads this file when you work in this directory; repository-wide guidance (commands, file map, conventions) is in the root `CLAUDE.md`. How an API integration's `request()` is used by the platform façades is in `../platforms/CLAUDE.md`.

## Integrations and their config

All integrations extend `BaseIntegration` (`integrations/BaseIntegration.ts`), which implements the `IIntegration` interface (`integrations/interfaces/IIntegration.ts`) and provides shared status/error/event-emitter plumbing. Concrete integrations implement `start()` → `stop()` and call `setStatus()` to report lifecycle transitions; `getStatus()` returns `IntegrationStatus` enum values.

**An integration's stored config is parsed against its own Zod schema.** `initialize(stored)` receives the decrypted value as read, and an integration with a config overrides it to call `parseConfig(schema, stored)`, which throws naming every field that was wrong; its config type is `z.infer` of that schema (OAuth providers declare `configSchema`, extending `OAuthConfigBaseSchema`). An integration without a config keeps the base `initialize()`, which rejects anything stored for it. A stored config is applied once, at load (`loadIntegrations()`); after that the integration holds it. `IntegrationManager.configureIntegration()` applies a new config before storing it, so a bad one is never saved, and restarts the integration on it if it is enabled. One that fails at load is shown as the integration's ERROR status, and the integration refuses to start until it is given a config that fits, rather than running on its defaults. The console only sends `integration.configure` from the OAuth setup dialog (client id and secret); other configs, such as OBS's URL and password or the EventSub topics, have no UI yet.

**`enabled` is what the streamer wants running, and only the streamer changes it.** Starting an integration from the console (`enableIntegration()`) or completing its OAuth sets it; stopping it from the console (`disableIntegration()`) clears it (`IntegrationStateRepository.setEnabled()`, which creates the row for an integration with no config). Cascades, `BLOCKED` and shutdown never touch it. Boot starts every enabled integration, and `reconcile()` brings an enabled one back when its dependency recovers, so enabling one whose dependency is down isn't an error: it reports `BLOCKED` and starts once the dependency connects. `IntegrationInfo.enabled` tells the console which to offer, Start or Stop.

## Dependencies

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
    nothing bound to the grant, so stopping them would tear down nothing; `BLOCKED` also says more
    plainly than `DISCONNECTED` that they are waiting on something else.
  - A `BLOCK`-policy integration **must refuse to act while its dependency isn't CONNECTED**, which
    their `request()` gates on. Resolving a client on access protects against holding the *wrong*
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

**Integrations own their status**; `startIntegration`/`stopIntegration` never set it, except
`reportError()` for a `start()` that threw before setting ERROR itself. Status isn't stored: the
console gets it live, and boot starts what is `enabled`, whatever it last reported.

Startup and shutdown both work in dependency *levels* (`DependencyGraph.levels()`), concurrent within
a level and reversed for shutdown, with a per-integration start timeout
(`IntegrationManager.START_TIMEOUT_MS`) so one integration that never settles can't hang boot.

**API-layer integrations resolve their dependency's client on access, not at `start()`.**
`TwitchApiIntegration` and `YouTubeApiIntegration` compare the auth integration's current
provider/client against the one their cached client was built on and rebuild when it changed, so a
stale reference can't exist in the first place. `SpotifyApiIntegration` needs no rebuild: its SDK
asks `SpotifyAuthIntegration.getAccessToken()` for the token on every call. This makes the
auth accessors (`getAuthProvider()`, `getAuthClient()`) contractually obliged to return a *stable*
instance rather than a new object per call. The cascade above still matters for the long-lived
listeners — `TwitchEventSubIntegration`'s EventSub WebSocket and `YouTubeChatIntegration`'s stream
own their provider for their lifetime and cannot be re-pointed.

## Platform groups

**Twitch** is split into three integrations following SRP: `TwitchAuthIntegration` (OAuth) → `TwitchApiIntegration` (Helix API) → `TwitchEventSubIntegration` (real-time events). **YouTube** follows the same three-part shape: `YouTubeAuthIntegration` → `YouTubeApiIntegration` → `YouTubeChatIntegration`. Spotify has an auth/api split only: `SpotifyAuthIntegration` → `SpotifyApiIntegration`. OBS and Sound are single-file integrations with no auth/api split; Discord and Arduino are single-file placeholders, not yet implemented.

## YouTube chat

**YouTube chat streams over the official client, via a method that is easy to miss.** The server-streaming live chat RPC is exposed by `googleapis` as `client.youtube.v3.liveChat.messages.stream()` — note that it is named `stream`, not `streamList` (its gRPC name), and that it hangs off a separate nested resource rather than the top-level `client.liveChatMessages` that holds `list`/`insert`/`delete`. Searching for `streamList`, or looking only at `liveChatMessages`, finds nothing and produces the false conclusion that the method is gRPC-only and needs a hand-rolled client (a vendored proto and `@grpc/proto-loader`). It does not; don't add one.

`YouTubeChatStream` requests it with `responseType: 'stream'` and `timeout: 0`, then splits the body with `JsonFrameParser` (`parseJsonFrames.ts`). Both details are load-bearing. Awaiting the ordinary overload buffers the whole response, so messages would only arrive once the broadcast ended; any timeout would cut a multi-hour stream short. Discovery types the response as a single `LiveChatMessageListResponse` — a code-generator artifact, since the generator emits `response.$ref` identically for unary and streaming methods — so that type describes **one frame** and says nothing about how frames are delimited. `JsonFrameParser` therefore scans for balanced top-level objects instead of assuming a delimiter, which decodes a chunked JSON array, newline-delimited JSON, and bare concatenated objects alike.

`YouTubeChatIntegration` has no periodic timers and doesn't decide when the broadcaster is live. It idles until `connectChat()` is called — by `YouTubeChatAutoConnect` (see Going Live), or by a `youtube.goLive` message from the console — then resolves the broadcast's `liveChatId` with a bounded retry (a broadcast doesn't expose one until YouTube transitions it to `live`) and opens the stream. Its `idle → resolving → streaming` transitions are broadcast to the frontend as `YOUTUBE_CHAT_STATE`. While streaming, `getBroadcast()` hands `YouTubePlatform` the broadcast it resolved, holding only the fields that can't change during a broadcast (`BroadcastIdentity`: no title), so replies, announcements, `!uptime` and title writes need no lookup of their own; reading the title always asks YouTube.

## OAuth

OAuth-capable integrations (`TwitchAuthIntegration`, `SpotifyAuthIntegration`, `YouTubeAuthIntegration`) extend `OAuthIntegration<TConfig>` (`integrations/OAuthIntegration.ts`), which implements `IOAuthIntegration` (`integrations/interfaces/IOAuthIntegration.ts`) and returns itself from the `get oauth()` getter (`null` on `BaseIntegration` by default). That getter is the single source of truth for OAuth capability — `OAuthFlowService` derives callback routing and the frontend's OAuth affordance from it instead of checking integration names.

`OAuthIntegration` owns what doesn't vary by provider. A subclass declares `requiredScopes`, `callbackPath`, `redirectHost` and `configSchema`, and implements `getAuthorizationUrl()`, `exchangeCode()`, `hasTokens()` and `connect()` (build its client); the base's `start()` runs the shared checks first — no token yet stays DISCONNECTED, and a stored `grantedScopes` missing a required scope is NEEDS_REAUTH rather than a failure on the first call that needs it. Refresh is deliberately left to each subclass, because each SDK does it differently (Twurple refreshes proactively, the googleapis client on demand). Spotify's SDK can't be trusted
with it — its own refresh omits the client secret this grant needs — so `SpotifyAuthIntegration`
refreshes before expiry in `getAccessToken()`, sharing one refresh between concurrent callers, and
the SDK is never given the refresh token. A refresh listener that nothing awaits saves through `saveRefreshedTokens()`, which logs a failed write instead of leaving an unhandled rejection.

## Integration events

**Status changes are the integration→UI channel, not per-provider events.** `setStatus()` → the
`'status'` listener in `IntegrationManager.register()` → `integration.status` on the bus →
`Application.setupEventHandlers()` broadcasts `INTEGRATION_STATUS` → `AppStateContext`. A new status
(like `BLOCKED`) reaches the console through that path with no extra wiring, carrying its reason in
`errorMessage`. Don't add per-provider `*.ready` events for this: they duplicate the status path,
and publishing a live auth provider or API client on the bus reintroduces the stale-reference trap
that resolving on access avoids.

A token refresh is the one thing status *can't* express (the integration stays CONNECTED through
it), so it has its own forward: `BaseIntegration.reportTokenRefreshed(expiresAt?)` →
`'tokenRefreshed'` → logged and republished as `integration.tokenRefreshed` with
`{ name, expiresAt? }`. It carries no credentials by design — anything needing the token asks the
integration on access.

An integration's own events (`status`, `tokenRefreshed`, `failure`) are typed by
`IntegrationEvents` in `interfaces/IIntegration.ts`, the same way the bus is typed by `EventMap`;
`IntegrationManager.register()` is their one listener. `failure` (via `reportFailure()`) is for
something that went wrong without changing status, and is republished as `integration.error`; it
carries an `Error`, since `reportFailure()` converts whatever was caught. It is deliberately not
named `'error'`, which Node's `EventEmitter` throws on when nothing is listening.
