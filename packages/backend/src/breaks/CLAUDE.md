<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Stream Breaks

A break takes the streamer off camera and mic in OBS. That's one output, so every platform sees it;
only the chat wording differs per platform (`PerPlatformMessage`). Twitch ad breaks
(`channel.ad_break.begin` → `twitch.ad.break`) start one automatically, and `!break` starts one by
hand. A trigger during a running break extends it rather than starting another, so the OBS snapshot
is always of the pre-break state. `ObsBreakOverlay` sets absolute states from that snapshot (never
`ToggleInputMute`-style toggles) and covers every scene on every canvas, including items inside
groups, which keeps the Aitum Vertical canvas in step and makes a mid-break scene switch harmless.
A canvas or group that can't be read is skipped and logged, so the rest is still covered. `AdWarningScheduler` warns chat
ahead of Twitch's scheduled ads, re-reading the schedule before each warning because snoozes and
manual ads move it. Shutdown ends a running break before stopping integrations, so OBS is still
connected to restore it, and `BreakService` refuses new breaks once stopped.
What a break changed in OBS is stored (`ObsBreakRestoreRepository`) until it has been put back,
and whenever OBS connects `BreakService` brings OBS in line: the overlay applied again if a break
is running, the stored state restored if not. That covers a break that ends while OBS is down and
one cut short by TuringMod crashing (a break doesn't survive a restart; what it owes OBS does).
A stored state that can't be read is dropped and reported (`service.error`), since OBS may still
show the break.
A new break started while a restore is still owed builds on that state, so its "before" is never
the hidden facecam. `ObsIntegration` reconnects on its own while it is started, backing off to
30s; only a failure the streamer must fix (wrong password, old obs-websocket) is an ERROR. Chat fan-out goes through `StreamControlService.announce()`, which
shares the live-platform/auth-skip loop with the mirrored writes.
