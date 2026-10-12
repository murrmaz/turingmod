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
- [x] Jumpscare (5000, "Just be funny when you hit this please") and American Jumpscare (section 4)
- [ ] Remaining original reward definition (section 6): Ban A Word
      (100000, "Bans a SINGLE word for a single month", input required)

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

Done: `sounds/SoundLibrary.ts` plays clips by name, and the two jumpscare rewards exist.

- [x] Sound library: clips are looked up by name in a directory (the `sounds` setting: `directory`,
      default `packages/backend/data`, and `volume`, default 0.5). Every clip name the code uses is
      listed in `sounds/clips.ts`. Personal clips in `packages/backend/data` are gitignored
- [ ] Copy the original's clips into the library directory, or point `sounds.directory` at them. They
      are **not in the original repository** (its `.gitignore` excludes `*.mp3`/`*.wav`), so they
      have to come from his machine: `jumpscare_1.mp3`–`jumpscare_5.mp3`, `gunshot.mp3`,
      `ad warn.wav`, `ad done.wav`. `bonk.mp3` ships with the repo (the original used `bonk.wav`)
- [x] Stop / cut short: `SoundLibrary.stopAll()` (for a future `!skip`), and `maxDurationMs` per clip
      (jumpscares play two seconds, as in the original)
- [x] Random pick for the jumpscare variants
- [x] Ad warning / ad done sounds: the break already plays `breaks.sounds.breakStarted`/`breakEnded`;
      these now resolve through the library. Set them to `ad warn.wav` / `ad done.wav` (section 8)
- [x] Jumpscare (5000, original prompt) and American Jumpscare reward handlers. Neither pauses during
      breaks, as in the original. A missing clip or stopped sound refunds the redemption; Bonk only
      logs it, since its squash still plays
- [ ] American Jumpscare's cost is a placeholder (5000, same as Jumpscare): the original never
      defined it. Set the real one in `AmericanJumpscareReward.ts` from his dashboard before he
      deletes the old reward

## 5. Persistence (P0)

Done: migration `002_feature_data` adds the feature tables, and `npm run import:original -w
@turingmod/backend` copies the original's data in.

- [x] Original schema, inferred from its `sqlite_db.js` (the database itself, `G:/sqlite3/test.db`,
      isn't in the repo): `stdcommands` and `intervalcommands` (name, user, msg), single-row
      `death_count(deaths)` and `voicecracks(num)`, plus `twitch_auth` and `api_keys`, which aren't
      migrated. Banned words were `data/banned_words.json` (word → date); suggestions were
      `data/suggestions.txt`
- [x] Banned words: `banned_words` table (`BannedWordRepository`), stored lowercased with who banned
      each and when. The chat filter (section 6) reads it
- [x] Counters (deaths, voice cracks): `counters` table keyed by name (`CounterRepository`, names in
      `COUNTERS`), with an atomic increment
- [x] Interval messages: `interval_messages` table (`IntervalMessageRepository`), rotated in the order
      added
- [x] Import tool (`tools/importOriginal.ts`): reads the original database and `banned_words.json`
      into the app's database (`DB_PATH`, or `turingmod.db` where it runs). Idempotent: nothing
      existing is overwritten, so a counter kept since an earlier import stays put. `--dry-run`
      reports without writing. Lists the original's chat-defined commands for porting to code
- [ ] Run it against his real database in the dress rehearsal. The schema is inferred, so check the
      report against what he expects (e.g. his death count)
- [x] Lurk list and bonk counts stay in memory: both were per-session in the original too
- [x] Ban expiry: decided — bans lapse after 30 days, as the reward promises (the original never
      unbanned anything). Imported words keep their original dates, so ones he banned over a month
      ago are no longer enforced
- [ ] Suggestions (`data/suggestions.txt`): not imported yet; belongs with `!sg` / `!suggestionlist`
      (section 9), which will need a table of its own

## 6. Chat services (P1)

Done. Chat now flows through one pipeline: both chat integrations emit only `chat.message`, and
`ChatRouter` screens each message with `ChatModerator` before parsing and running any command, so a
banned word can't ride in on a command.

- [x] Interval announcer (`announcements/IntervalAnnouncer.ts`): every 30 minutes, the next interval
      message in order, to every live platform via `StreamControlService.announce()`. While nothing
      is live the rotation doesn't advance. Posted as a normal chat message (the original used a
      Twitch announcement, which is highlighted)
- [x] Moderation (`moderation/ChatModerator.ts`), on platforms with the new `MODERATION` capability
      (Twitch; YouTube chat isn't moderated yet):
      - banned words: a viewer saying one gets the original's "penal colony" reply and a 10-second
        timeout, and the message (and any command in it) goes no further. Whole words only,
        punctuation and case ignored
      - quiet mode: while on, non-command messages @-mentioning the streamer are deleted (the
        original timed the viewer out for a second, which also deleted the message). Off at
        startup, like the original; `setQuietMode()` is ready for `!quiet`
      - the broadcaster is exempt from both, as in the original (moderators aren't, though Twitch
        won't time a moderator out)
- [x] Moderation capability on the façade: `timeoutUser`, `deleteChatMessage`
- [x] Ban A Word reward (100000, input required): bans exactly one word for **30 days**, then it
      lapses and can be banned again. Anything else, or an already-banned word, is refused with a
      chat reply and refunded (the original asked the viewer to find a mod for a refund)
- [x] Clip collection (`clips/ClipCollector.ts`): while on, Twitch clip links in chat are checked
      with Twitch (new `CLIPS` capability) and kept once each; turning it off writes an HTML list
      to `packages/backend/data/clips/`. `begin()`/`end()` are ready for `!startcollect`/`!endcollect`

## 7. Platform façade additions (P1, enables the mechanical command work)

Done. Each is an optional `IStreamPlatform` method behind a capability, implemented on Twitch and
reached through `StreamControlService`.

- [x] Snooze next ad (`snoozeNextAd`, ADS): checks the snooze count first, so "none left" is an
      answer rather than a Twitch error
- [x] Follow age (`getFollowDate`, FOLLOW_INFO) and account age (`getAccountCreatedAt`, new
      ACCOUNT_AGE): dates only; commands format them
- [x] Stream marker (`createStreamMarker`, new MARKERS): refuses clearly while offline
- [x] Delete last VOD (`deleteLatestVod`, new VODS): deletes the most recent past broadcast (the
      current one while live) and says which. The original's `!delvod` looked up *uploads* for a
      mistyped user id (`7163229`, not `71631229`), so it likely never deleted a broadcast
- [x] Announcements (`sendAnnouncement`, new ANNOUNCEMENTS): `announce()` takes `{ highlight: true }`
      to use them where available; the interval messages now do, as the original's were
- [x] Fixed a pre-existing gap: TuringMod never requested `channel:manage:broadcast`, which Twitch
      requires to change the title, category, tags or content labels, so `!title`/`!game`/`!tags`
      writes and `!cw` changes would have been refused. Requested now, along with
      `channel:manage:videos` (VODs) and `moderator:manage:announcements`

## 8. Configuration and cutover (P0)

- [ ] Replace hard-coded values from the original: channel name, bot account name, OBS
      host/port/password (it used port 4444), audio paths, Windows-only launch of Firefox/VLC
- [ ] A way to edit settings. `breaks`, `effects` and `sounds` live in the `settings` table, but
      nothing in the console or chat writes them, so today they can only be changed with a SQLite
      client. At minimum he needs `breaks.sounds` set to `ad warn.wav` / `ad done.wav`, and possibly
      `effects.facecamSource` and `sounds.directory`
- [ ] Confirm chat send identity: the original spoke as a separate bot account via `tmi.js`.
      Decide whether the new bot should send as that account or the broadcaster
- [ ] Re-run Twitch OAuth in the new console (also required on existing dev setups: scopes were
      added for shoutouts, channel changes, VODs and announcements, and the auth integration asks
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
