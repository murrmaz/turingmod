# TuringMod

The Swiss Army knife of stream automation — chat commands, music, Discord, OBS, hardware gadgets, and more, all wired into one local control panel.

## Features

- 🎮 **Twitch Chat Commands**: Execute custom commands in Twitch chat with permission-based access control
- 🔌 **Platform Integrations**: Connect with Twitch, Spotify, Discord, Arduino, and more
- 🌐 **Web UI**: Monitor and control your integrations through a modern web interface
- 🧪 **Command Simulator**: Run a command as if a viewer typed it in chat, to test it without asking anyone
- 🔒 **Secure**: Localhost-only access with encrypted API token storage
- 📊 **Command History**: Track all command executions with full audit trail

## Tech Stack

- **Backend**: Node.js + TypeScript + WebSocket
- **Frontend**: React + Cloudscape UI + Vite
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

### 2. Start Development Server

```bash
npm run dev
```

This starts:
- Backend (HTTP + WebSocket + OAuth callbacks): http://127.0.0.1:8080 (`SERVER_PORT`)
- Frontend (Vite): http://127.0.0.1:3000, proxying the WebSocket to the backend

Open http://127.0.0.1:3000 in your browser to access the UI. (The backend only accepts WebSocket
connections from that exact origin, so `localhost:3000` won't connect.)

## Development Workflow

### Development Mode (with HMR)

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
npm run clean           # Clean all build outputs
npm run type-check      # Run TypeScript type checking
```

## Project Structure

```
TuringMod/
├── packages/
│   ├── shared/          # Shared types and WebSocket protocol
│   ├── backend/         # Node.js WebSocket server
│   └── frontend/        # React web UI
├── scripts/             # Setup and utility scripts
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
take precedence over the file, and everything is optional in development. `.env.example`
documents each variable; the main ones:

```env
SERVER_PORT=8080                 # console, WebSocket and OAuth redirect URIs
MASTER_PASSWORD=your-password    # encrypts stored credentials; set it before configuring anything
```

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

## Architecture

TuringMod follows SOLID principles with a clean architecture:

### Backend
- **Dependency Injection**: Container-based DI for loose coupling
- **Command Pattern**: Extensible command system
- **Plugin Architecture**: Integration manager for platform connections
- **Repository Pattern**: Database abstraction layer

### Frontend
- **Context API**: Global state management
- **Custom Hooks**: Reusable logic for commands and integrations
- **Cloudscape UI**: Professional AWS design system

### Communication
- **WebSocket Only**: Real-time bidirectional communication
- **Type-Safe Protocol**: Shared types between frontend and backend

## Available Commands

Commands are executed in Twitch chat with the `!` prefix:

- `!bonk @username` - Example command (default implementation)
- More commands can be added through the UI or code

## Command Simulator

Run a command as if one of your viewers had typed it in chat, at any permission level. It runs for
real, side effects included (a title change, a break, a shoutout), so it doubles as an integration
test for new commands. Only the streamer's localhost console can reach it.

1. Navigate to the **Commands** page
2. Click **Test** on any command
3. Enter command text and select permission level
4. Click **Execute Simulation**
5. View results instantly

## Security

- ✅ **Localhost Only**: All servers bind to 127.0.0.1
- ✅ **Encrypted Storage**: API tokens encrypted with AES-256-GCM
- ✅ **Permission Checks**: Commands enforce permission levels
- ✅ **Input Validation**: All user input validated and sanitized

## Integrations

### Currently Supported
- **Twitch**: Chat commands, EventSub events, Helix API

### Planned
- **Spotify**: Playback control
- **Discord**: Webhook notifications
- **Arduino**: Serial communication for physical integrations

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
