# TuringMod Rewrite: Progress Tracker

Comparison of the [original TuringMod](https://github.com/meant-ion/TuringMod) against this rewrite.
Check items off as they are implemented.

---

## Architecture (Complete)

These foundational improvements are done and represent major wins over the original:

- [x] TypeScript with strict types (original is JavaScript)
- [x] Monorepo structure (shared/backend/frontend)
- [x] Dependency injection container
- [x] Repository pattern for database access
- [x] EventBus for cross-component communication
- [x] Typed WebSocket protocol (original has no UI at all)
- [x] AES-256-GCM encrypted token storage (original stores plaintext)
- [x] sql.js WASM database (no native compilation needed)
- [x] Modern libraries: Twurple (original uses deprecated tmi.js + Twocket)
- [x] sound-play for audio (original requires VLC installed)
- [x] Web UI with React + Cloudscape Design System
- [x] Command simulator for testing without going live

---

## Twitch Auth Integration

- [x] OAuth 2.0 authorization flow
- [x] Token storage (encrypted)
- [x] Automatic token refresh
- [x] Frontend OAuth popup flow

## Twitch API Integration

- [x] Get channel info
- [x] Get user by name
- [x] Send chat message
- [x] Send announcement
- [x] Delete message
- [x] Ban / unban user
- [x] Timeout user
- [x] Warn user (new - not in original)
- [x] Create clip
- [x] Edit stream title
- [x] Edit stream game/category
- [x] Edit stream tags
- [x] Get follow age (paginated)
- [x] Get stream uptime
- [x] Create stream markers
- [x] Send shoutout (with queue/cooldown)
- [x] Channel point reward management (create/toggle)
- [x] Get stream schedule
- [x] Ad management (snooze, timing)
- [x] Delete VODs
- [x] Content classification labels

## Twitch EventSub

- [x] Chat messages
- [x] Channel raids
- [x] Channel follows (new - not in original)
- [x] Channel subscriptions (new - not in original)
- [x] Channel cheers (new - not in original)
- [x] Stream online/offline (new - not in original)
- [x] Ad break begin
- [x] Channel point redemptions

---

## Chat Commands

The original has ~40 commands. The command framework is in place; adding commands is mechanical.

### Implemented
- [x] !bonk - Bonk a user (with sound effect)

### Stream Info Commands
- [ ] !title - Show/edit stream title
- [ ] !game - Show/edit stream game
- [ ] !uptime - Show stream uptime
- [ ] !tags - Show/edit stream tags
- [ ] !who - Show streamer bio
- [ ] !schedule - Show upcoming schedule
- [ ] !cw - Show content classification labels
- [ ] !ad - Show time until next ad

### User & Community Commands
- [ ] !followage - Show how long user has followed
- [ ] !accountage - Show when user's account was created
- [ ] !lurk / !unlurk - Lurker tracking with timestamps
- [ ] !leave - Announce departure
- [ ] !voice - Voice crack counter

### Entertainment Commands
- [ ] !roll - Dice roller (NdSrM format)
- [ ] !flip - Coin flip
- [ ] !wave - Trigger robot arm wave (needs Arduino)
- [ ] !echo - Repeat message (restricted user)

### External API Commands
- [ ] !song - Show current Spotify track (needs Spotify)
- [ ] !skipsong - Vote to skip song (needs Spotify)
- [ ] !addsong - Add song to queue (needs Spotify)
- [ ] !wikirand - Random Wikipedia article
- [ ] !spacepic - NASA Astronomy Picture of the Day
- [ ] !freegame - Free Epic Games Store games
- [ ] !gitchanges - Git commit statistics

### Moderator Commands
- [ ] !so - Twitch shoutout with cooldown
- [ ] !quiet - Toggle quiet mode
- [ ] !died / !rdeaths - Death counter
- [ ] !delvod - Delete most recent VOD
- [ ] !startcollect / !endcollect - Clip collection system
- [ ] !skip - Stop/clear audio
- [ ] !snooze - Snooze next ad break
- [ ] !shutdown - Graceful bot shutdown
- [ ] !sg / !suggestionlist - Suggestion system

### Custom Command System
- [ ] !addcommand - Create custom command (standard or interval)
- [ ] !removecommand - Delete custom command
- [ ] !editcommand - Modify custom command response
- [ ] !customlist - List all custom commands
- [ ] Database tables for custom commands (stdcommands, intervalcommands)
- [ ] Fallback lookup: if command not found in registry, check database
- [ ] Interval command auto-posting (30-minute rotation)

---

## Channel Point Redemptions (0/9)

Requires: EventSub channel point subscription + OBS animations

- [ ] Screen Saver Camera (1,000 pts) - DVD screensaver bouncing facecam
- [ ] Bonk visual (500 pts) - Squish animation on facecam
- [ ] Australia (500 pts) - Flip facecam upside down
- [ ] Wide Pope (500 pts) - Stretch facecam horizontally
- [ ] Long Pope (500 pts) - Stretch facecam vertically
- [ ] Barrel Roll (500 pts) - Spin facecam 360 degrees
- [ ] Ban A Word (100,000 pts) - Ban a word from chat for a month
- [ ] Jumpscare (5,000 pts) - Random jumpscare audio
- [ ] American Jumpscare - Gunshot sound effect

---

## OBS Integration

- [x] WebSocket connection (v5, port 4455)
- [x] Event subscriptions (scene, stream, record state)
- [x] OBS client exposed for direct use
- [x] Scene item transform primitives (get/set position, rotation, scale)
- [x] Scene item visibility primitives (get/set)
- [x] Scene item ID lookup by source name
- [x] Scene switching (get/set current scene)
- [x] Filter management (add/remove/toggle/update settings)
- [x] Stream status retrieval

---

## Spotify Integration

- [x] OAuth 2.0 flow (per-platform callback: /callback/spotify)
- [x] Token storage and refresh (on-demand refresh on 401)
- [x] Get currently playing track
- [x] Frontend OAuth popup flow + setup modal
- [ ] Search for songs
- [ ] Add song to queue
- [ ] Skip playback
- [ ] Explicit content filtering

## Discord Integration

Both original and rewrite are stubs. Original just logs in with no handlers.

- [ ] Bot connection with intents
- [ ] Message handling (TBD - original had none)

## Arduino / Hardware Integration

- [ ] Serial port connection (COM7, 9600 baud)
- [ ] Clipping button (physical button triggers stream marker)
- [ ] Robot arm "GUPPY" wave command
- [ ] Nerf turret (planned in original, not implemented)

---

## Sound System

- [x] Play audio files
- [x] Configurable volume
- [x] bonk.mp3 sound effect
- [ ] Stop/clear playback
- [ ] Ad warning sound (ad warn.wav)
- [ ] Ad done sound (ad done.wav)
- [ ] Jumpscare audio files (5 files)
- [ ] Gunshot sound effect

---

## Moderation

- [ ] Banned word system (word list with expiration dates)
- [ ] Chat message filtering against banned words
- [ ] Auto-timeout for banned word violators
- [ ] Quiet mode (prevent @-mentioning streamer)
- [ ] Auto-timeout for quiet mode violators

---

## Other Systems

- [ ] Lurker tracking (in-memory list with timestamps)
- [ ] Clip collection and HTML export
- [ ] Suggestion system (file-based)
- [ ] Interval announcement rotation (30-minute cycle)
- [ ] Ad break automation (mute, hide cam, disable rewards, restore after)

---

## External APIs

- [ ] NASA Astronomy Picture of the Day (with 24-hour cache)
- [ ] Epic Games Store free games
- [ ] Wikipedia random article
- [ ] GitHub commit statistics

---

## Frontend (New - No Original Equivalent)

- [x] Dashboard with health monitor
- [x] Integration status panel with start/stop controls
- [x] Commands page with table view
- [x] Command simulator with permission level selection
- [x] Twitch OAuth modal with popup flow
- [x] Dependency visualization for integrations
- [ ] Command history display
- [ ] Custom command management UI (create/edit/delete)
- [ ] Integration configuration UI
- [ ] Real-time chat viewer
- [ ] Event log / notification feed
