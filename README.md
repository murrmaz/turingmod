# TuringMod

The Swiss Army knife of stream automation — chat commands, channel point rewards, OBS effects, ad
breaks, music, and more, all wired into one local control panel.

## Features

- 🎮 **Chat Commands**: `!commands` in Twitch and YouTube chat, with permission levels and per-viewer
  cooldowns; title, game and tag changes mirror to every platform you're live on
- 🎁 **Channel Point Rewards**: Twitch rewards that TuringMod creates, keeps in sync, and fulfils or
  refunds, including facecam effects and sounds
- ☕ **Stream Breaks**: Twitch ad breaks (or `!break`) take you off camera and mic in OBS and tell
  chat, with warnings before scheduled ads
- 🛡️ **Moderation**: banned words (viewers can ban one with channel points) and quiet mode
- 🔁 **Interval Messages**: messages posted to chat in rotation every 30 minutes while you're live
- 📣 **Go-live Post**: one Discord post when you go live, kept up to date until the stream ends
- 🖥️ **Console**: a local web page to connect integrations, watch a live activity feed, and manage
  interval messages, banned words and viewer suggestions
- 🧪 **Command Simulator**: run a command as if a viewer typed it in chat, to test it without asking anyone
- 🔒 **Local**: localhost-only access, with integration credentials stored encrypted

## Quick Start

You need **Node.js 22.5 or newer** (for its built-in SQLite) and npm 9+. Check with `node -v`.

```bash
git clone https://github.com/murrmaz/turingmod.git
cd turingmod
npm install
cp .env.example .env
```

Open `.env` and set `MASTER_PASSWORD` to a password of your choosing. TuringMod won't start without
one, and it encrypts the credentials you'll enter later (see [Configuration](#configuration)).

```bash
npm run dev
```

This builds the shared package, then starts:

- the backend (console WebSocket, OAuth callbacks): http://127.0.0.1:8080 (`SERVER_PORT`)
- the console (Vite): http://127.0.0.1:3000

Open http://127.0.0.1:3000 (or http://localhost:3000). The sidebar shows **Connected** at the
bottom once the console has reached the backend. On first start TuringMod creates its database,
`packages/backend/turingmod.db`, and no integration is running yet: start each one from the
**Integrations** page, as below. One you've started starts again by itself next time.

## Connecting Integrations

Everything is connected from the console's **Integrations** page. Click an integration to open its
panel, then:

- **Authorize** for Twitch, YouTube and Spotify (the `-auth` integrations), which signs you in
- **Set up**, then **Start**, for OBS, Discord and Arduino
- **Start** for everything else (the `-api`, `-eventsub` and `-chat` integrations, and Sound)

Each setup dialog walks through what to create on the provider's side and checks what you paste
before saving it. Credentials are stored encrypted in the database, never in `.env`.

| Integration | What you need |
|---|---|
| **Twitch** | A Twitch application (free, at https://dev.twitch.tv/console) |
| **YouTube** | A Google Cloud project with the YouTube Data API enabled |
| **Spotify** | A Spotify app (https://developer.spotify.com/dashboard) |
| **OBS** | OBS 28+, with Tools → WebSocket Server Settings enabled |
| **Discord** | A Discord bot of your own, and the ID of the channel to post in |
| **Arduino** | A Wi-Fi board running the firmware in [`firmware/`](firmware/README.md) |
| **Sound** | Nothing to set up (see [Sound](#sound)) |

### Twitch

1. On the Integrations page, click **twitch-auth**, then **Authorize**. The dialog walks through
   the rest
2. Register an application at https://dev.twitch.tv/console/apps, with the OAuth redirect URL
   `http://localhost:8080/callback/twitch` (the dialog shows the exact URL; it follows
   `SERVER_PORT`) and client type **Confidential**, the default
3. Paste its Client ID and Client Secret into the dialog and click **Save & continue**
4. Authorize TuringMod in the Twitch window that opens
5. Start **twitch-api** and **twitch-eventsub** too. Each link in a chain is started separately;
   one started before the link it depends on shows BLOCKED and connects as soon as that one does

Log in as the channel's own account: TuringMod posts in chat as the broadcaster, not as a separate
bot account.

### YouTube and Spotify

Authorized the same way as Twitch, from **youtube-auth** and **spotify-auth**, then start the rest of
each chain (youtube-api and youtube-chat; spotify-api). Their redirect URLs use
`127.0.0.1`, not `localhost`, because those providers require it; copy the one the dialog shows.
YouTube chat connects by itself once OBS starts streaming, so it needs OBS connected too.

### OBS

In OBS, open Tools → WebSocket Server Settings, enable the server, and use **Show Connect Info** to
copy the address and password into TuringMod's OBS setup dialog, then start **obs**. OBS can be
closed and reopened at any time: TuringMod reconnects on its own.

Breaks and facecam effects look for OBS sources by name. Out of the box those names are:

| Source | Default name | Used by |
|---|---|---|
| Facecam | `Facecam` | facecam effects; hidden during a break |
| Mic | `Mic/Aux` | muted during a break |
| Break text | `Ads Text` | shown during a break |

If your sources are named differently, rename them in OBS or change the
[settings](#settings).

### Discord

TuringMod posts go-live notifications through a bot you create. The setup dialog lists the steps:
create an application, copy its bot token, invite the bot with the View Channels, Send Messages,
Embed Links and Mention Everyone permissions, and copy the notification channel's ID. **The first
post each stream pings `@everyone` in that channel**, so use a test server while trying it out.

### Arduino

For a Wi-Fi board (an ESP32 or similar) running TuringMod firmware. Today TuringMod connects,
checks the firmware's protocol version and shows what the board sends in the activity feed; the
servo gestures are planned. See [`firmware/README.md`](firmware/README.md).

### Sound

Sound plays clips for `!bonk`, rewards and breaks. It has no setup dialog: start it on the
Integrations page. It needs a command-line audio player: on macOS
`afplay` and on Windows PowerShell, both built in; on Linux the first of `ffplay`, `gst-play-1.0`,
`cvlc`, `mpg123`, `paplay` or `aplay` it finds. Clips live in `packages/backend/data`. Only
`bonk.mp3` comes with the repository; the jumpscare and gunshot clips have to be copied in, and a
reward whose clip is missing is refunded and reported in the activity feed.

## What Each Feature Needs

Some features depend on what your Twitch account can do, not only on what's connected.

| Feature | Needs |
|---|---|
| Chat commands on Twitch | twitch-auth, twitch-api, twitch-eventsub connected |
| Chat commands on YouTube | YouTube connected and a live broadcast; chat connects once OBS starts streaming |
| Channel point rewards | Twitch **Affiliate or Partner** |
| Ad warnings, ad breaks, `!ad`, `!snooze` | Twitch **Affiliate or Partner** (only they run ads) |
| Breaks (camera and mic off) | OBS, with the [source names](#obs) above |
| Facecam effect rewards | Affiliate or Partner, and OBS |
| `!song` | Spotify connected |
| Go-live post | Discord connected |
| Interval messages | A platform that's live |

Without Affiliate or Partner, TuringMod still starts and everything else works. It reports once
per start, in the activity feed, that it can't read the channel's rewards; that error is expected.

Commands only appear where they can work. The **Commands** page shows each command's platforms,
and a command a platform can't run is ignored there, like an unknown one.

## Using the Console

| Page | What it's for |
|---|---|
| **Dashboard** | The live activity feed (commands, rewards, viewers, chat, errors) and integration health |
| **Commands** | Every command, its permission level, cooldown and platforms; click one to simulate it |
| **Interval Messages** | Messages posted in rotation every 30 minutes while you're live |
| **Banned Words** | Words that get a viewer timed out for 10 seconds; each ban lasts 30 days |
| **Integrations** | Set up, start and stop each connection |
| **Suggestions** | What viewers have suggested with `!sg` |
| **History** | Everything recorded, searchable; chat isn't stored, so it's only on the Dashboard |
| **Data** | A read-only view of the database (credentials are never shown) |

Press ⌘K (Ctrl+K) to jump to a page or run a command. If the backend stops, a banner says so and
the console reconnects by itself; anything you click while it's down fails at once rather than
running later.

Problems TuringMod can carry on from (a refused reward, a sound file it can't play, OBS refusing
something) show in the activity feed as **Error**, so check the Dashboard when something didn't
happen.

## Chat Commands

Commands start with `!`. The **Commands** page lists all of them with usage and platforms.

- **Everyone**: `!uptime`, `!game`, `!tags`, `!cw`, `!schedule`, `!who`, `!ad`, `!followage`,
  `!accountage`, `!song`, `!lurk [reason]`/`!unlurk`, `!leave`, `!time`, `!roll 2d6`, `!flip`,
  `!bonk @user`, `!voice`, `!sg <suggestion>`
- **Moderators and the broadcaster**: `!title <title>`, `!game <name>`, `!tags <a,b>`, `!cw <labels>`,
  `!so <channel>`, `!break [minutes | 90s | end]`, `!snooze`, `!skip`, `!quiet`, `!died`/`!rdeaths`,
  `!startcollect`/`!endcollect` (clip links), `!delvod`

Some behaviour that's deliberate rather than a bug:

- **Unknown commands, missing permissions and cooldowns get no reply in chat**, since a `!word` is
  often meant for another bot. They're recorded in the activity feed instead.
- **Cooldowns apply to viewers only**; moderators and the broadcaster are exempt.
- **The broadcaster is never timed out** for a banned word, so test moderation from a second account.
- **TuringMod ignores its own messages**, and never posts a message that starts with `!` or `/`.

## Command Simulator

Runs a command as if a viewer had typed it in chat, as any username and at any permission level.
**It runs for real**: `!title` changes your title, `!break` starts a break, `!so` sends a shoutout.

1. On the **Commands** page, click a command (or press ⌘K and pick one)
2. Edit the command text, username, platform and permission level
3. Click **Run simulation**; the result shows below, with the reply chat would have heard

The simulator differs from real chat in a few ways:

- Replies are shown in the console, **not posted to chat**
- **Cooldowns don't apply**, so test them from real chat
- **Banned words aren't checked**; moderation only runs on real chat
- **`!delvod` refuses to run**, since deleting a VOD can't be undone
- Simulated commands appear in the live feed but **not in History**

## Configuration

### Environment Variables

`.env` in the repository root is read by the backend and the Vite dev server at startup; variables
already set in your shell take precedence. `.env.example` documents each one. Only
`MASTER_PASSWORD` is required:

```env
SERVER_PORT=8080                 # console, WebSocket and OAuth redirect URIs
MASTER_PASSWORD=your-password    # encrypts stored credentials; set it before configuring anything
```

There's no default password, since one written in the source would protect the stored credentials
no better than plain text. **Changing `MASTER_PASSWORD` later makes the stored credentials
unreadable**, and every integration has to be set up again. Changing `SERVER_PORT` means
re-registering each provider's redirect URL.

### Settings

Break behaviour, sounds and the facecam's source name are settings stored in the database. **The
console has no settings page yet**, so until then they're the defaults:

| Key | What it holds | Defaults |
|---|---|---|
| `breaks` | OBS sources hidden, shown and muted; break and ad-warning messages; warning times; break sounds | hide `Facecam`, show `Ads Text`, mute `Mic/Aux`; warn 5 and 1 minutes before an ad |
| `sounds` | Clip folder and volume | `packages/backend/data`, volume 0.5 |
| `effects` | The facecam's OBS source name | `Facecam` |

To change one, stop TuringMod and write the setting into the database as JSON. Any field you leave
out keeps its default. For example, to animate a source called `Webcam`:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
new DatabaseSync('packages/backend/turingmod.db')
  .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
  .run(process.argv[1], process.argv[2], Date.now());
" effects '{"facecamSource":"Webcam"}'
```

A setting that doesn't fit stops TuringMod at startup with the bad fields named. The full schemas,
with every field, are in `packages/backend/src/features/breaks/breakSettings.ts`,
`features/sounds/soundSettings.ts` and `features/effects/effectSettings.ts`.

## Troubleshooting

- **TuringMod won't start and mentions `MASTER_PASSWORD`**: set it in `.env`.
- **"Port 8080 is in use" or similar**: another copy of TuringMod (or something else) is running.
  Stop it, or set a different `SERVER_PORT` and re-register the redirect URLs.
- **An OAuth window reports a redirect URI mismatch**: the URL registered with the provider must
  match the one the setup dialog shows exactly, including `localhost` versus `127.0.0.1`.
- **An integration shows BLOCKED**: it's waiting for the one before it in its chain (twitch-api
  waits for twitch-auth). Start or fix that one and the blocked one follows.
- **A command does nothing in Twitch chat**: check that twitch-eventsub is running, since that's
  what receives chat. Then check the activity feed: a refused or unknown command is recorded
  there, not answered in chat.
- **Integrations need setting up again after changing `.env`**: `MASTER_PASSWORD` changed, so the
  stored credentials can't be decrypted.
- **Starting over**: stop TuringMod and delete `packages/backend/turingmod.db` (and its `-wal` and
  `-shm` files). The next start creates an empty database.

## Development

```bash
npm run dev              # Backend and console, with reload on change
npm run dev:backend      # Backend only
npm run dev:frontend     # Console only
npm run build            # Production build of every package
npm start                # Production server on :8080, serving the built console
npm run check            # Biome lint + format check (check:fix to apply fixes)
npm run type-check       # TypeScript (run build:backend first on a fresh checkout)
npm test                 # Vitest in every workspace
npm run clean            # Remove build outputs
```

There is no CI: run `check`, `type-check` and `test` before considering a change done.

### Project Structure

```
turingmod/
├── packages/
│   ├── shared/      # What the backend and console both use: enums, Zod schemas, domain types
│   ├── backend/     # Node.js server: integrations, features, the tRPC API and the database
│   └── frontend/    # The React console
└── firmware/        # Arduino protocol and reference sketch
```

### Architecture

- **Backend**: constructor injection with [tsyringe](https://github.com/microsoft/tsyringe); one
  class per integration (Twitch auth/API/EventSub, YouTube, Spotify, OBS, …), started in dependency
  order by an integration manager that brings dependents back when a dependency recovers;
  platform façades so one command works on Twitch and YouTube alike; commands and rewards as one
  class per file, discovered automatically; synchronous repositories over `node:sqlite`
- **Console**: React with shadcn/ui on Tailwind CSS v4, TanStack Table, dark-only
- **Communication**: one WebSocket carrying a [tRPC](https://trpc.io) router, so the console is
  type-checked against the backend's procedures and every input is validated with Zod. There's no
  REST API; the HTTP server serves the console and OAuth callbacks.

New commands are TypeScript classes in `packages/backend/src/features/commands/implementations/`,
and new rewards in `features/rewards/implementations/`, both picked up automatically. See
[CLAUDE.md](CLAUDE.md) for the detailed architecture.

## Security

- ✅ **Localhost only**: every server binds to 127.0.0.1, and the WebSocket accepts only the console's own origin
- ✅ **Encrypted storage**: integration credentials encrypted with AES-256-GCM, keyed from `MASTER_PASSWORD`
- ✅ **Permission checks**: commands enforce permission levels
- ✅ **Input validation**: console requests, stored configs and settings are checked against schemas
- ✅ **No self-triggering**: TuringMod ignores its own chat messages and never posts text that starts with a command

## Acknowledgements

TuringMod is a ground-up rewrite of [TuringMod](https://github.com/meant-ion/TuringMod) by
[meant-ion](https://github.com/meant-ion), a Twitch chat bot and stream-automation tool. The original
supplied the idea and the feature set this project builds on: chat commands, channel point rewards
with OBS effects, ad-break warnings, and hardware integrations. This codebase is written
from scratch in TypeScript with a different architecture, but the original's behaviour is what it
aims to match. Thank you to meant-ion for the project and for the groundwork.

## License

MIT License - see [LICENSE](LICENSE) for details. The license retains the original TuringMod's
copyright notice alongside this project's.

## Support

For issues and questions, please open an issue on GitHub.
