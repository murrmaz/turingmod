<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Chat Pipeline

Each chat integration emits one `chat.received` (`ChatMessageEvent`) per message and nothing else;
commands are not parsed at the source. `OwnChatMessages` (`platforms/OwnChatMessages.ts`, since the façades record into it) drops TuringMod's own messages and
republishes the rest as `chat.message`, which is what every consumer listens to. `ChatRouter` takes
it from there: `ChatModerator.review()`
first, and only a message it allows is parsed with `parseCommand()` and executed. That order is the
point — a command can't carry a banned word past the filter. Moderation acts only on platforms
with the `MODERATION` capability and always exempts the broadcaster. Banned words are data
(`banned_words`, written by the Ban A Word reward) and lapse 30 days after being banned. Other
listeners on `chat.message` (activity log, `ClipCollector`) see every message but TuringMod's own,
moderated or not.

Failures `CommandExecutor` produces itself (`EXECUTOR_ERROR_CODES`: unknown command, permissions,
cooldown, crashed) get **no reply in chat** — an unknown `!word` is often meant for
another bot — and are recorded in the activity log instead (unknown commands are also logged at
debug). A reply that can't be posted is reported (`service.error`), like a moderation action that
fails or banned words that can't be read, once per run of failures since these happen per message
(`RepeatingFailures`). Failures a command reports itself (usage, "game not found", a viewer trying a
moderator-only branch) are still replied to. The two sets of codes are separate unions in
`shared/src/types/command.ts`: `ICommand.execute()` returns a `CommandResult`, which admits only
`CommandErrorCode`, so a command can't report an executor code and have its reply silenced.
`CommandResult` is a union: a failure always carries a code and a `reason`, a success carries
neither. Commands build results with `ok()`/`fail()` (`features/commands/utils/results.ts`), never by hand;
`message` is the reply for chat, and `reason` is for the streamer, recorded with
`command.executed` in the activity log (a crashed command's reason is the error it threw). Protocol
error messages likewise use the `ErrorCode` union in `messages.ts`, not free strings.

**TuringMod never acts on its own chat messages.** It posts with the broadcaster's login — one
identity per platform, deliberately, rather than a separate bot account that would split actions
between two sets of credentials — so its messages come back through ingest as the broadcaster's.
Unchecked, an echoed `!delvod` would run with broadcaster permission (a confused deputy), and a
reaction to its own message could feed a message storm. Sender identity can't tell them apart, so
the message id does: every façade sends through `OwnChatMessages.record()`, which remembers the id
the platform returns, and the gate drops those messages before anything sees them. Ingest can
deliver a message before the send call returns, so a broadcaster message arriving mid-send waits
for in-flight sends to settle before it is judged; other people's messages pass straight through.
Twitch returns no id for an announcement, so `recordText()` remembers its wording and the gate drops
the first broadcaster message with exactly those words.

**Outgoing chat can never start with a command**, a second layer that also protects other bots in
the channel. Every `IStreamPlatform` passes outgoing chat and announcements through
`toSafeChatText()` (`platforms/safeChatText.ts`), which strips leading whitespace, invisible format
characters and `!`/`/` prefixes. There is deliberately no `!echo`-style command that repeats
viewer input.

**Commands receive their arguments already parsed.** `parseCommand()` (`features/commands/parseCommand.ts`)
lowercases the name, so `!Lurk` runs `lurk` (command names are registered lowercase, which
`CommandRegistry` enforces), and gives the command two views of what follows it: `args`, the words
split on any whitespace with no empty entries, for a command that takes a word (`!so <channel>`),
and `argText`, the trimmed text with its spacing kept, for one that takes free text (`!title`,
`!tags`). A command with a read and a write mode writes only when `argText` isn't empty, so a stray
trailing space reads rather than clearing anything. Commands never re-split or re-join arguments
themselves.

The command simulator deliberately runs commands for real, side effects included: it lets the
streamer act as a viewer to integration-test a command without asking someone to type it. It parses
its text with the same `parseCommand()` as chat, so a command behaves identically in both, and text
chat wouldn't run is answered as not a command. It is only reachable from the localhost console;
there is no message for running a command as an arbitrary user.
