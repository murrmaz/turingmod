/**
 * The accent colours, named for what they mean: an activity category's (the `--cat-*` tokens in
 * index.css), or a state's (`--status-*`). Some share a colour, as `ok` does with `viewer`, but
 * pick the one that says why. Logic picks a tone; `components/status.tsx` draws it.
 */
export type Tone =
  | 'command'
  | 'reward'
  | 'viewer'
  | 'chat'
  | 'system'
  | 'ok'
  | 'pending'
  | 'error'
  | 'live'
  | 'idle';
