<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Sound

Everything that makes a sound goes through `SoundLibrary`, which resolves a clip name against the
library directory (the `sounds` setting, defaulting to `packages/backend/data`) and hands the path
to `SoundIntegration`. `play()` checks first that sound is running and the clip exists and rejects
otherwise, so a sound-only reward is refunded; `tryPlay()` doesn't throw, for callers where the
sound is incidental (`!bonk`, the Bonk reward, break sounds). It reports a clip it can't play (a
missing or misnamed file) as `service.error`, once per clip until it plays again, and only logs
while sound isn't running, which the Sound integration's status already shows. Neither waits for
the clip to end.
`SoundIntegration` tracks its player processes, so a clip can be cut off after `maxDurationMs` and
`stopAll()` silences everything; an intentional kill counts as a normal end, not an error.
