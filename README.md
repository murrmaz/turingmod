# TuringMod

The Swiss Army knife of stream automation — chat commands, channel point rewards, OBS effects, ad
breaks, music, and more, all wired into one local control panel.

## Features

- 🎮 **Chat Commands**: `!commands` in Twitch and YouTube chat, with permission levels and per-viewer
  cooldowns; title changes mirror to every platform you're live on
- 🎁 **Channel Point Rewards**: Twitch rewards that TuringMod creates, keeps in sync, and fulfils or
  refunds, including facecam effects and sounds
- ☕ **Stream Breaks**: Twitch ad breaks (or `!break`) take you off camera and mic in OBS and tell
  chat, with warnings before scheduled ads
- 🛡️ **Moderation**: banned words (viewers can ban one with channel points) and quiet mode
- 🌐 **Web UI**: Monitor and control integrations, see a live activity feed and history
- 🧪 **Command Simulator**: Run a command as if a viewer typed it in chat, to test it without asking anyone
- 🔒 **Local**: Localhost-only access, with integration credentials stored encrypted

## Tech Stack

- **Backend**: Node.js + TypeScript + WebSocket
- **Frontend**: React + shadcn/ui (Tailwind CSS) + TanStack Table + Vite
- **Database**: SQLite via Node's built-in `node:sqlite` (no native compilation)
- **Architecture**: SOLID principles with dependency injection

## Prerequisites

- Node.js 22.5+ (required for `node:sqlite`)
- npm 9+

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

Then set `MASTER_PASSWORD` in it. TuringMod won't start without one (see
[Configuration](#configuration)).

### 3. Start Development Server

```bash
npm run dev
```

This starts:
- Backend (HTTP + WebSocket + OAuth callbacks): http://127.0.0.1:8080 (`SERVER_PORT`)
- Frontend (Vite): http://127.0.0.1:3000, proxying the WebSocket to the backend

Open http://127.0.0.1:3000 in your browser to access the UI. (The backend only accepts WebSocket
connections from that exact origin, so `localhost:3000` won't connect.)

## Development Workflow

### Development Mode (frontend hot reload, backend restarts on change)

```bash
npm run dev              # Start both backend and frontend
npm run dev:backend      # Start backend only
npm run dev:frontend     # Start frontend only
```

### Production Build

```bash
npm run build           # Build all packages
npm start               # Start production server on :8080 (SERVER_PORT)
```

### Other Commands

```bash
npm run check           # Biome lint + format check (check:fix to apply fixes)
npm run type-check      # TypeScript type checking (run build:backend first on a fresh checkout)
npm test                # Vitest in every workspace
npm run clean           # Clean build outputs
```

## Project Structure

```
TuringMod/
├── packages/
│   ├── shared/          # Shared types and WebSocket protocol
│   ├── backend/         # Node.js WebSocket server
│   └── frontend/        # React web UI
├── package.json         # Root workspace config
└── tsconfig.base.json   # Shared TypeScript config
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` in the project root and fill it in:

```bash
cp .env.example .env
```

The backend and the Vite dev server both load it at startup. Variables already set in your shell
take precedence over the file. Only `MASTER_PASSWORD` is required; everything else has a default.
`.env.example` documents each variable; the main ones:

```env
SERVER_PORT=8080                 # console, WebSocket and OAuth redirect URIs
MASTER_PASSWORD=your-password    # encrypts stored credentials; set it before configuring anything
```

TuringMod refuses to start without `MASTER_PASSWORD` and says what's missing: there's no default
password, since one written in the source would protect the stored credentials no better than plain
text.

OAuth client credentials aren't environment variables: the console asks for them the first time
an integration is connected.

Changing `MASTER_PASSWORD` after integrations are configured makes their stored credentials
unreadable, so they'd need setting up again.

### Twitch Setup

1. Create a Twitch application at https://dev.twitch.tv/console
2. Set the redirect URI to `http://localhost:8080/callback/twitch` (the setup dialog shows the
   exact URI to register; it follows `SERVER_PORT`)
3. In the console, connect Twitch and paste the Client ID and Client Secret into the setup dialog
4. Authorize TuringMod in the Twitch window that opens

Spotify and YouTube are set up the same way: on the **Integrations** page, start the integration
and the setup dialog walks through registering an application and shows the redirect URI to use
(on `127.0.0.1`, which those providers require, rather than `localhost`).

## Architecture

### Backend
- **Dependency Injection**: constructor injection with [tsyringe](https://github.com/microsoft/tsyringe)
- **Integrations**: one class per connection (Twitch auth/API/EventSub, YouTube, Spotify, OBS, …),
  started in dependency order by an integration manager that recovers dependents when a dependency
  comes back
- **Platform façades**: commands talk to a platform-agnostic layer, so one command works on Twitch
  and YouTube alike where the platform supports it
- **Commands and rewards**: one class per file, discovered automatically
- **Repositories**: synchronous data access over `node:sqlite`

### Frontend
- **Context API + hooks**: WebSocket connection and app state
- **shadcn/ui** components on Tailwind CSS v4, dark-only, with TanStack Table for every table

### Communication
- **WebSocket only**: no REST API; the HTTP server serves the console and OAuth callbacks
- **Type-safe protocol**: shared message types, with every incoming payload checked against a Zod schema

See [CLAUDE.md](CLAUDE.md) for the detailed architecture.

## Available Commands

Commands start with `!`. The **Commands** page lists every command with its usage, permission
level, and the platforms it works on (some need Twitch-only features). Highlights:

- **Viewers**: `!uptime`, `!game`, `!tags`, `!schedule`, `!ad`, `!followage`, `!accountage`,
  `!song`, `!lurk`, `!roll 2d6`, `!flip`, `!bonk @user`, `!sg <suggestion>`
- **Moderators**: `!title <title>`, `!game <name>`, `!so <channel>`, `!break [minutes | end]`,
  `!snooze`, `!quiet`, `!startcollect`/`!endcollect` (clip links), `!delvod`

New commands are TypeScript classes in `packages/backend/src/commands/implementations/`, picked up
automatically.

## Command Simulator

Run a command as if one of your viewers had typed it in chat, at any permission level. It runs for
real, side effects included (a title change, a break, a shoutout), so it doubles as an integration
test for new commands. Only the streamer's localhost console can reach it.

1. Navigate to the **Commands** page
2. In the **Command Simulator** below the command list, enter the command text, a username and a
   permission level
3. Click **Execute Simulation** and see the result

`!delvod` is the one command the simulator refuses to run, since deleting a VOD can't be undone.

## Security

- ✅ **Localhost Only**: All servers bind to 127.0.0.1, and the WebSocket only accepts the console's own origin
- ✅ **Encrypted Storage**: integration credentials encrypted with AES-256-GCM, keyed from `MASTER_PASSWORD`
- ✅ **Permission Checks**: Commands enforce permission levels
- ✅ **Input Validation**: Console messages, stored configs and settings are checked against schemas
- ✅ **No self-triggering**: TuringMod ignores its own chat messages and never posts text that starts with a command

## Integrations

### Currently Supported
- **Twitch**: chat commands, EventSub events (chat, follows, subs, raids, ad breaks, redemptions),
  channel point rewards, Helix API
- **YouTube**: live chat commands and replies, title and uptime; chat connects automatically while
  OBS is streaming
- **OBS**: stream breaks and facecam effects (via obs-websocket)
- **Spotify**: the currently playing song (`!song`)
- **Sound**: plays clips for commands, rewards and breaks

### Planned
- **Discord**: Webhook notifications
- **Arduino**: Serial communication for physical integrations

Discord and Arduino appear in the console already, but starting them does nothing yet.

## Contributing

This is a personal project, but suggestions and improvements are welcome.

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
