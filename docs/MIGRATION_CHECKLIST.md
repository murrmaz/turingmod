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

- [x] Add a root `LICENSE` (MIT, matching `package.json`) that also credits the original author
      (© 2021 meant-ion) alongside the new copyright holder
- [x] README: add an acknowledgement section crediting and linking the original TuringMod
- [x] Decided: `LICENSE` carries both copyright lines above a single MIT text

## 1. Event reactions (P0)

The EventBus is the dispatcher. `TwitchEventSubIntegration` already turns EventSub messages into
bus events (`twitch.raid`, `twitch.channelpoint.redemption`, ...), and `ChatRouter` shows the pattern
for consuming one. Both subscriptions are now on unless disabled in the EventSub config.

- [x] Redemption router (`rewards/RewardRouter.ts`): subscribe to `twitch.channelpoint.redemption` (as `ChatRouter` does for
      `chat.command`), find the handler for the reward, run it, and log failures without breaking the loop
- [x] Reward handler interface (`IRewardHandler`: `rewardTitle`, `handle(redemption)`) with one
      class per reward in `rewards/implementations/`, auto-discovered by a loader modelled on
      `loadCommands.ts`, so adding a reward is dropping in one file
- [x] Decided: handlers match on the reward title, declared statically in the handler class like a
      command's `name`. Titles are unique per channel and rewards are rarely renamed, so no stored
      reward ids are needed
- [x] Redemption `status` needs no filtering: the `.add` event fires once per new redemption, and
      handlers act immediately whether or not the reward uses the request queue, as the original did
- [x] Mark queued redemptions fulfilled when the handler succeeds, or cancel them (refunding the
      viewer) when it fails. Only for rewards TuringMod created (see section 2)
- [x] Raid handler (`raids/RaidShoutout.ts`): posts the original's shoutout message and sends
      Twitch's native shoutout (cooldown handling included)
- [x] Expose shoutout through the platform façade as an optional capability so a future `!so` can use it

## 2. Channel point reward lifecycle (P0)

The original recreated its rewards on every boot. `RewardSync` now does the same from each
handler's definition, through a new `CHANNEL_POINTS` platform capability.

- [x] Each reward handler (section 1) declares its reward definition (`reward`: cost, prompt, input,
      cooldown/limits, queue behaviour, pause-during-breaks), so definition and logic share a file
- [x] Reward sync when the Twitch API connects (startup and after re-auth): look up each handler's
      reward by title; create it if missing, correct drifted settings, never duplicate. Never
      re-enables a reward the streamer switched off in the dashboard (original rewards: Screen Saver Camera, Barrel Roll,
      Australia, Wide Pope, Long Pope, Bonk, Ban A Word, Jumpscare, American Jumpscare)
- [x] Twitch only lets the client that created a reward edit it, so rewards created by the original
      bot's client ID can't be managed by this app. Sync warns about each such reward (once) and
      leaves it alone; its handler still runs, but redemptions aren't resolved or paused. At cutover the sync will create new rewards
      under the same titles; he must delete or rename the old ones first (title uniqueness would
      otherwise block creation). Add this to the cutover steps in section 8
- [x] Pause rewards marked `pauseDuringBreaks` while a stream break runs (ad or `!break`), and unpause
      after. The original disabled (hid) them instead; pausing keeps them visible but unredeemable.
      A reward left paused by a crash is unpaused by the next sync
- [x] Facecam reward definitions carried into their handlers (section 3): Australia, Barrel Roll,
      Wide Pope, Long Pope, Bonk (500 each); Screen Saver Camera (1000, "Turn my face cam into a DVD
      screen saver"), all paused during breaks
- [ ] Remaining original reward definitions (sections 4, 6): Jumpscare (5000, "Just be funny when you hit this please"); Ban A Word
      (100000, "Bans a SINGLE word for a single month", input required). American Jumpscare has a
      handler in the original but no definition; get its cost from his dashboard

## 3. OBS effects engine (P0)

Done: `effects/` holds a `FacecamEffectRunner` and the effects, and `rewards/implementations/` has
handlers for the six facecam rewards, with the original costs and prompts.

- [x] Primitives: get/set a scene item's transform by scene UUID (the existing ones only reached the
      main canvas's program scene), the program scene's UUID, and the canvas size
- [x] Effect runner: plays effects one at a time; each starts from a fresh read of the facecam and
      restores it afterwards (on success, error, or shutdown via `Application.stop()`), removing any
      filter it added. A failure rejects, so the reward is refunded
- [x] Source name comes from the `effects` setting (`facecamSource`, default `Facecam`). Targets: the
      program scene on the main canvas, plus the first scene containing the facecam on every other
      canvas (obs-websocket can't report another canvas's live scene; the original guessed too)
- [x] Effects: Barrel Roll (2s turn), Australia (upside down 10s), Wide/Long Pope (×4 stretch 10s),
      Bonk (sound, then alternating flat/thin squash 10s), Screen Saver Camera (30s bounce, main
      canvas only, re-tint on each bounce)
- [x] Ad-warning overlay: already covered by `ObsBreakOverlay` (hides Facecam, shows Ads Text, mutes
      Mic/Aux in every scene), so nothing to port
- [x] Stream timestamp: `ObsIntegration.getStreamStatus().outputTimecode` already provides it
- [ ] Tune in the dress rehearsal (section 8). The effects reproduce the gags, not the original's
      exact numbers, which were tuned to his canvas: Wide/Long Pope stretch ×4 about the center
      instead of the original's crop-and-×8; speeds and durations are constants in
      `effects/facecam/facecamEffects.ts`. Effects assume the facecam is unrotated and has no
      bounding box (true of the original's setup, which reset bounds before every transform)

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
- [ ] Re-run Twitch OAuth in the new console (also required on existing dev setups: the
      `moderator:manage:shoutouts` scope was added for shoutouts, and the auth integration asks
      for re-authorization when a stored grant is missing a scope) (old tokens are in the original's database and are not reused)
- [ ] Never run both bots against the same channel at once; the original would answer every command twice
- [ ] Delete or rename the original bot's rewards in the Twitch dashboard before the first run, so the
      new bot can create its own with the same titles (section 2)
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
