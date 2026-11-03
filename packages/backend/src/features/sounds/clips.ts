/**
 * Every clip TuringMod plays by name, looked up in the sound library directory (see
 * SoundLibrary). `bonk.mp3` ships in `packages/backend/data`; the rest are the original bot's
 * clips, which aren't in its repository and have to be copied in from the streamer's machine.
 */
export const CLIPS = {
  bonk: 'bonk.mp3',
  jumpscares: [
    'jumpscare_1.mp3',
    'jumpscare_2.mp3',
    'jumpscare_3.mp3',
    'jumpscare_4.mp3',
    'jumpscare_5.mp3',
  ],
  gunshot: 'gunshot.mp3',
} as const;
