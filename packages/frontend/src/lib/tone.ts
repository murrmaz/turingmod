/**
 * The accent colours (the `--cat-*` tokens in index.css): a feed category's, or a status's
 * (viewer is also "ok", system "warn"). Logic picks a tone; `components/status.tsx` draws it.
 */
export type Tone = 'command' | 'reward' | 'viewer' | 'chat' | 'system' | 'error' | 'idle';
