<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Facecam Effects

Reward handlers play visual gags on the facecam through `FacecamEffectRunner`. An effect
(`FacecamEffect`) only describes motion against an `EffectContext`; the runner does the rest. It
plays effects one at a time — two effects on one source would each capture the other's
mid-animation state as the "original" — finds the facecam afresh for each one, and restores it in a
`finally`, so an effect that throws, or is cut short at shutdown, still leaves the
facecam where it was. Filters an effect adds are removed the same way. A run rejects when it can't
play (OBS down, no facecam), which makes `RewardRouter` refund the redemption.

A restore can fail too. What fails because OBS has gone is kept and put back when OBS next connects,
queued like an effect, so a later effect never reads the displaced facecam as its "original". What
OBS refuses while connected won't go better later, so it's reported (`service.error`) instead. Only
that much is in memory: a stop before OBS returns is reported, and a crash loses it, unlike a break's
stored restore, since an effect lasts seconds. `ObsIntegration` fails requests in flight when the
connection closes, because obs-websocket-js never settles them, and without that the effect, the
queue and shutdown would all wait forever.

The facecam is found by source name (the `effects` setting), placed directly or inside a group, in
the main canvas's program scene and, on every other canvas, in the first scene that contains it:
obs-websocket reports no program scene for a non-main canvas. An item inside a group is addressed
through the group's UUID, and its position is relative to the group, so an effect that moves it in
canvas coordinates (`usesCanvasSize`, the screensaver) plays on the main canvas only and refuses a
grouped facecam. Effects animate on elapsed time, not frame counts, so a slow OBS drops frames
rather than slowing down, and they assume the facecam is unrotated and has no bounding box.
