<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Chat Pipeline

Each chat integration emits one `chat.received` (`ChatMessageEvent`) per message and nothing else;
commands are not parsed at the source. `OwnChatMessages` (`platforms/OwnChatMessages.ts`, since the façades record into it) drops TuringMod's own messages and
republishes the rest as `chat.message`, which is what every consumer listens to. `ChatRouter` takes
it from there: `ChatModerator.review()`
first, and only a message it allows is parsed with `parseCommand()` and executed. That order is the
point — a command can't carry a banned word past the filter. Moderation acts only on platforms
with the `MODERATION` capability and always exempts the broadcaster. Banned words are data
(`banned_words`, see Banned words below) and lapse 30 days after being banned. Other
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
error codes are the `CommandErrorCode` and `ExecutorErrorCode` unions (`shared/src/types/command.ts`),
not free strings.

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
characters and `!`/`/` prefixes. It also cuts text to the limit the façade passes (500 characters on
Twitch, 200 on YouTube), so a long reply is shortened rather than refused. A message Twitch accepts
but doesn't post (`isSent` false: AutoMod held it, say) rejects like any other failed send. There is deliberately no `!echo`-style command that repeats
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
chat wouldn't run is answered as not a command. It runs as whichever user the console names, so it
can run a command as anyone at any permission level, which is why it's reachable only from the
localhost console.

## Interval messages

The streamer manages them on the console's Interval Messages page (`intervalMessages.*` procedures),
and every change goes through `IntervalMessages`, which publishes `intervalMessages.changed`.
`IntervalAnnouncer` posts one every `ANNOUNCEMENT_INTERVAL_MS` to every live platform. **What's next
is worked out from what's stored, never kept in memory**: `nextInRotation()` takes the enabled message
after the one with the latest `last_posted_at`, wrapping around. So the rotation survives a restart,
and adding, moving, pausing or deleting a message can't make it skip one. A message is stamped only
once a platform accepted it, so nothing advances while no platform is live.
`IntervalMessageTextSchema` (`shared`), checked by both the dialog and the procedures, refuses text
that `toSafeChatText()` would change at the start (a leading `!` or `/`), a line break, or anything
past the longest platform limit, so what's saved is what's posted. Text past a shorter limit is
allowed, with a warning in the dialog: only that platform cuts it off.

## Banned words

Viewers add them with the Ban A Word reward, and the streamer manages them on the console's Banned
Words page (`bannedWords.*` procedures). Every change goes through `BannedWordList`, which publishes
`bannedWords.changed`; `ChatModerator` only reads, straight from the repository. Every ban lasts
`BAN_DURATION_MS`, whoever made it. A row outlives its ban, so the page lists lapsed words too, and
works out which have lapsed from `expiresAt` and the clock, since a ban lapsing publishes nothing.
A null `banned_by` is the streamer. `BannedWordSchema` and `normalizeBannedWord()` (`shared`) parse
a word to the form `wordsIn()` makes of chat (`Don't!` is `dont`), since any other form could never
match. The dialog and the procedures both use the schema. Correcting a word's spelling keeps who
banned it and when, and renewing restarts the month, keeping who banned it.
