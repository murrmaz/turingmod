<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Sound

Everything that makes a sound goes through `SoundLibrary`, which resolves a clip name against the
library directory (the `sounds` setting, defaulting to `packages/backend/data`) and hands the path
to `SoundIntegration`. `play()` checks first that sound is running and the clip exists and rejects
otherwise, so a sound-only reward is refunded; `tryPlay()` logs instead, for callers where the sound
is incidental (`!bonk`, the Bonk reward, break sounds). Neither waits for the clip to end.
`SoundIntegration` tracks its player processes, so a clip can be cut off after `maxDurationMs` and
`stopAll()` silences everything; an intentional kill counts as a normal end, not an error.
