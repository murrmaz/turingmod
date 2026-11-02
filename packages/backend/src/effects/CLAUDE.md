<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Facecam Effects

Reward handlers play visual gags on the facecam through `FacecamEffectRunner`. An effect
(`FacecamEffect`) only describes motion against an `EffectContext`; the runner does the rest. It
plays effects one at a time — two effects on one source would each capture the other's
mid-animation state as the "original" — finds the facecam afresh for each one, and restores it in a
`finally`, so an effect that throws, or is cut short at shutdown, still leaves the
facecam where it was. Filters an effect adds are removed the same way. A run rejects when it can't
play (OBS down, no facecam), which makes `RewardRouter` refund the redemption.

The facecam is found by source name (the `effects` setting), placed directly or inside a group, in
the main canvas's program scene and, on every other canvas, in the first scene that contains it:
obs-websocket reports no program scene for a non-main canvas. An item inside a group is addressed
through the group's UUID, and its position is relative to the group, so an effect that moves it in
canvas coordinates (`usesCanvasSize`, the screensaver) plays on the main canvas only and refuses a
grouped facecam. Effects animate on elapsed time, not frame counts, so a slow OBS drops frames
rather than slowing down, and they assume the facecam is unrotated and has no bounding box.
