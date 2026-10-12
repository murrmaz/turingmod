# Migration checklist: original TuringMod → this rewrite

Tracks feature parity with [meant-ion/TuringMod](https://github.com/meant-ion/TuringMod) ahead of
moving its streaming setup over. Compiled by reading both codebases, not by running them.

**Design rule:** behaviour lives in TypeScript, not in the database. Every command and every
reward handler is a class in the codebase; a table may hold that feature's own data (e.g. the banned
word list), never the logic. There is no runtime-defined command system.

**Strategy:** infrastructure first. Once the integrations and shared services below exist, porting
individual commands is mostly mechanical, so commands sit at the end.

**Out of scope for now**

- Arduino / robot arm (`!wave`, the clip button, serial link). The project is shelved;
  `ArduinoIntegration` stays a stub until there is a use case.
- `!wikirand`, `!spacepic`, `!freegame`. Not used; add later if wanted.
- The original's removed AI features (ChatGPT chat mimic, Uberduck voice).

**Legend:** P0 = blocks cutover · P1 = needed for the same stream experience · P2 = nice to have.
Platform notes: rewards, raids and ad events are Twitch-only; keep new code behind the platform
abstraction (`IStreamPlatform` / `PlatformCapability`) where a YouTube equivalent could exist.

---

## 0. Attribution and licensing (P0, small)

- [ ] Add a root `LICENSE` (MIT, matching `package.json`) that also credits the original author
      (© 2021 meant-ion) alongside the new copyright holder
- [ ] README: add an acknowledgement section crediting and linking the original TuringMod
- [ ] Decide whether the `LICENSE` should carry the original MIT notice verbatim as a second block

## 1. Event reactions (P0)

The EventBus is the dispatcher. `TwitchEventSubIntegration` already turns EventSub messages into
bus events (`twitch.raid`, `twitch.channelpoint.redemption`, ...), and `ChatRouter` shows the pattern
for consuming one. Today the only subscriber to those two events is `ActivityForwarder` (logging).

- [ ] Redemption router: subscribe to `twitch.channelpoint.redemption` (as `ChatRouter` does for
      `chat.command`), find the handler for the reward, run it, and log failures without breaking the loop
- [ ] Reward handler interface (e.g. `IRewardHandler`: reward title/key, `handle(event)`) with one
      class per reward in `rewards/implementations/`, auto-discovered by a loader modelled on
      `loadCommands.ts`, so adding a reward is dropping in one file
- [ ] Decide how a handler matches a redemption: by reward title (what the original did) or by
      stored reward id (survives renames; needs the id recorded when the reward is created in section 2)
- [ ] Handle redemption `status` (only act on unfulfilled/new redemptions) and consider marking
      redemptions fulfilled or cancelled through Helix when a handler fails
- [ ] Raid handler: a small subscriber on `twitch.raid` that posts the shoutout message and calls
      `shoutoutUser()` (exists on `TwitchApiIntegration`, cooldown handling included)
- [ ] Expose shoutout through the platform façade as an optional capability so a future `!so` can use it

## 2. Channel point reward lifecycle (P0)

The original recreated its rewards on every boot. The new Twitch API wrapper has
create/update/delete/get reward calls, but nothing uses them.

- [ ] Each reward handler (section 1) declares its reward definition (title, cost, prompt, cooldown),
      so the definition and the logic live in the same file
- [ ] Reward sync on Twitch connect: ensure each handler's reward exists and matches its definition
      without duplicating ones already present (original rewards: Screen Saver Camera, Barrel Roll,
      Australia, Wide Pope, Long Pope, Bonk, Ban A Word, Jumpscare, American Jumpscare)
- [ ] Pause/unpause the facecam rewards around ad breaks (the original disabled them while an ad
      warning ran and re-enabled them after); hook into the existing break/ad flow

## 3. OBS effects engine (P0)

`ObsIntegration` covers scenes, scene items, filters, mutes, canvases and stream status. It has no
transform primitives, which every facecam effect needs.

- [ ] Primitives: get/set scene item transform (position, scale, rotation, crop), with the current
      transform captured so effects can restore it
- [ ] Effect runner: serialize effects so two redemptions can't fight over the same source, and
      always restore the original transform (including on error or OBS disconnect)
- [ ] Resolve the target source by configured name rather than hard-coded; cover the Aitum Vertical
      canvas the same way `ObsBreakOverlay` does
- [ ] Port effects: DVD Screen Saver, Barrel Roll, Australia (flip), Wide/Long Pope (warp), Bonk (squish)
- [ ] Ad-warning on-screen text/animation (the original's `ads_warning`): check what
      `ObsBreakOverlay` already covers before porting
- [ ] Stream timestamp helper (original `getStreamTimestamp`), useful for markers and VOD notes

## 4. Sound (P1)

`SoundIntegration` plays a file at a volume on `sound.play`. The original used VLC and a folder of
clips with a few behaviours the new one lacks.

- [ ] Sound library: configurable directory of assets; copy the original's clips across
      (ad warning, ad done, bonk, jumpscares 1–5, gunshot). Only `bonk.mp3` ships today
- [ ] Stop / clear queue (original `!skip`, `kill_audio`, `empty_playlist`)
- [ ] Random-pick helper for the jumpscare variants
- [ ] Ad warning / ad done sounds wired to the ad flow (section 2)

## 5. Persistence (P0)

Only one migration exists (users, command history, integration state, settings, encryption keys,
activity log). Per the design rule, each feature adds only the tables it needs for its own data.

- [ ] Inspect the original's SQLite schema and data files (`data/`) to confirm what exists
      (custom commands, interval commands, death/voice counters, banned words, suggestions)
- [ ] Banned words: table owned by the Ban A Word reward handler; the chat filter (section 6) reads it
- [ ] Counters (deaths, voice cracks): a table keyed by counter name, used by those commands
- [ ] Interval messages: table of announcements read by the interval announcer (section 6)
- [ ] One-off import script from the original's database/files into the new tables (idempotent,
      dry-run option) so existing counts, banned words and interval messages carry over
- [ ] Decide on persistence of the lurk list (original is in-memory) and bonk counts (in-memory in `BonkCommand`)

## 6. Chat services (P1)

- [ ] Interval announcer: scheduled rotation through interval messages (original: every 30 min)
      via `StreamControlService.announce()`; skip when offline
- [ ] Message filter stage before command dispatch: banned words → timeout + reply, quiet mode
      (remove `@streamer` mentions), with a toggle in settings
- [ ] Moderation capability on the façade: timeout, delete message (Helix wrappers exist)
- [ ] Ban-a-word reward handler (depends on sections 1 and 5)
- [ ] Clip collection state and HTML export (original `!startcollect` / `!endcollect`);
      `createClip` exists on the Twitch API wrapper

## 7. Platform façade additions (P1, enables the mechanical command work)

These are Helix calls that exist on `TwitchApiIntegration` but are not exposed through
`IStreamPlatform`, so commands cannot use them yet.

- [ ] Snooze next ad
- [ ] Follow age / account age lookups
- [ ] Create stream marker
- [ ] Delete last VOD
- [ ] Send announcement (already used by `announce()` internally; confirm it is exposed)

## 8. Configuration and cutover (P0)

- [ ] Replace hard-coded values from the original: channel name, bot account name, OBS
      host/port/password (it used port 4444), audio paths, Windows-only launch of Firefox/VLC
- [ ] Confirm chat send identity: the original spoke as a separate bot account via `tmi.js`.
      Decide whether the new bot should send as that account or the broadcaster
- [ ] Re-run Twitch OAuth in the new console (old tokens are in the original's database and are not reused)
- [ ] Never run both bots against the same channel at once; the original would answer every command twice
- [ ] Dress rehearsal on an offline stream: every reward, a raid (use Twitch's test events), an
      ad break, a break (`!break`), and a restart mid-effect
- [ ] Rollback plan: keep the original runnable and its database untouched until a few streams in

## 9. Commands (P2, mechanical once the above exists)

Already ported: `!title`, `!game`, `!tags`, `!cw`, `!ad`, `!schedule`, `!uptime`, `!who`, `!bonk`
(partial), `!break` (new).

**Needs a section above first**

- [ ] `!so` (section 1/7)
- [ ] `!died`, `!rdeaths`, `!voice` (section 5, counters table)
- [ ] `!quiet` (section 6)
- [ ] `!startcollect`, `!endcollect` (section 6)
- [ ] `!snooze`, `!followage`, `!accountage`, `!delvod` (section 7)
- [ ] `!skip` (section 4)

**Standalone**

- [ ] Convert his existing chat-defined custom commands (the original's `!addcommand` entries) into
      code. List what's in his database, then port the ones he actually uses, e.g. as simple
      static-response command files. The runtime `!addcommand` / `!editcommand` / `!removecommand` /
      `!customlist` commands are not migrating, because commands are code in this design

- [ ] `!lurk`, `!unlurk`, `!leave`
- [ ] `!roll`, `!flip`, `!time`
- [ ] `!sg`, `!suggestionlist`
- [ ] `!bonk`: restore the 1-in-10 "the bot revolts" gag; persist counts if wanted
- [ ] `!gitchanges`, `!echo` (the original's `@desabotage`-only command): low value, decide
      whether to keep

**Not migrating:** `!addcommand` / `!editcommand` / `!removecommand` / `!customlist` (see above), `!wave` (Arduino), `!wikirand`, `!spacepic`, `!freegame`, `!test`, `!shutdown`
(the console already controls the lifecycle).
