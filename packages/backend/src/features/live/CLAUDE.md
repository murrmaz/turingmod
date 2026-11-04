<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Going Live

Some platforms need telling that a stream has started. YouTube chat belongs to one broadcast, and
YouTube can't notify a localhost server that one began; Twitch needs nothing, since its chat
subscription is per channel and it announces going live itself (`twitch.stream.online`). The
signal is split in two so a future per-broadcast platform reuses it. `ObsStreamState` knows
whether OBS is streaming and publishes `stream.output.changed`, with no knowledge of platforms; it
asks OBS directly whenever OBS connects, since a transition missed while disconnected (TuringMod
starting mid-stream) produces no event, and tells the streamer if connected OBS can't answer. Each platform that needs it reacts in its own service:
`YouTubeChatAutoConnect` connects chat on that event, and also when YouTube chat itself comes up
while OBS is already streaming (after a restart, or a login recovering mid-stream). OBS streaming
doesn't mean every platform is live, so a platform treats the signal as a reason to look for its
broadcast, bounded in time, not as proof of one.

**Whether a platform is live** (`PlatformLiveStatus`) is asked only on a signal, since asking YouTube
costs quota. A signal can be missed or answered too early (YouTube can go on listing a broadcast as
active after chat ends and OBS stops; EventSub's socket can be down when `stream.offline` is sent),
and a platform stuck reading live never posts "was live for" or announces the next stream. So a
platform that reads live with no sign of a stream behind it (OBS stopped or isn't streaming, or
YouTube chat went idle) is asked again after 1, 2, 4, 8, 16 and 32 minutes, until it reads offline
or OBS starts sending. After that it's logged and left: it's what the platform reports, and a
broadcast with auto-stop off really does stay live. Twitch is also asked each time EventSub's socket
opens (`twitch.eventSub.ready`), since Twitch doesn't resend what it sent while the socket was down.
A read that fails leaves the last state standing and is reported (`service.error`), once per platform
per outage.

**The Discord go-live post** (`GoLiveAnnouncer`) follows `platform.liveState`, not OBS: one post
pinging `@everyone` when the first platform goes live, edited as other platforms join and leave
and on `stream.info.changed` (a mirrored title/game write, or any change on Twitch via EventSub
`channel.update`), and rewritten as "was live for …" only on evidence that the stream is over:
every platform it covered offline for a 10-minute grace period, and each of them connected and
answering `isLive()` false. A disconnected platform (TuringMod just started, a lapsed login) is
unknown, not offline, so a crashed or restarted stream, or an auth outage, carries on in the same
post without a second ping. Going live continues the post only if the broadcast started within
the grace period of the post's last heartbeat; a later start ends the old post and announces anew.
The open post is stored (`GoLivePostRepository`) with a once-a-minute "still live" time; one that
can't be read is dropped and reported (`service.error`) rather than stopping anything, and so is a
post that can't be updated (once per outage, retried each minute while live) or marked as ended,
which leaves it saying live in Discord. A title that can't be read is asked for again each minute,
and the post is edited once it arrives. Only the
first post pings: `DiscordIntegration` allows `@everyone` and no other mention, and never on an
edit. A post someone deletes stays deleted for the rest of the stream. Twitch's `stream.offline`
and `channel.update` topics are on by default for this; YouTube Studio title changes reach the
post only on its next edit.
