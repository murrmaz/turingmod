# TuringMod

The Swiss Army knife of stream automation — chat commands, music, Discord, OBS, hardware gadgets, and more, all wired into one local control panel.

## Features

- 🎮 **Twitch Chat Commands**: Execute custom commands in Twitch chat with permission-based access control
- 🔌 **Platform Integrations**: Connect with Twitch, Spotify, Discord, Arduino, and more
- 🌐 **Web UI**: Monitor and control your integrations through a modern web interface
- 🧪 **Command Simulator**: Test commands offline without going live
- 🔒 **Secure**: Localhost-only access with encrypted API token storage
- 📊 **Command History**: Track all command executions with full audit trail

## Tech Stack

- **Backend**: Node.js + TypeScript + WebSocket
- **Frontend**: React + Cloudscape UI + Vite
- **Database**: SQLite3 (sql.js - pure JavaScript, no native compilation)
- **Architecture**: SOLID principles with dependency injection

## Prerequisites

- Node.js 18+
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
- Backend (HTTP + WebSocket): http://localhost:8080
- Frontend (Vite): http://localhost:3000

Open http://localhost:3000 in your browser to access the UI.

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
npm start               # Start production server on :8080
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

Create a `.env` file in the project root:

```env
# Server Configuration
WS_PORT=8080
DB_PATH=./turingmod.db
LOG_LEVEL=info

# Security
MASTER_PASSWORD=your-encryption-password-here

# Twitch Integration (from https://dev.twitch.tv)
TWITCH_CLIENT_ID=your-client-id
TWITCH_CLIENT_SECRET=your-client-secret
```

### Twitch Setup

1. Create a Twitch application at https://dev.twitch.tv/console
2. Set redirect URI to `http://localhost:8080/auth/twitch/callback`
3. Copy Client ID and Client Secret to `.env`
4. Authenticate via the UI to generate OAuth token

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

Test commands without going live:

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

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please open an issue on GitHub.
