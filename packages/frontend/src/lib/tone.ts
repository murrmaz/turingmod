import { ACTIVITY_EVENT_CATEGORIES, ActivityCategory } from '@turingmod/shared';

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

const CATEGORY_TONES = {
  [ActivityCategory.COMMAND]: 'command',
  [ActivityCategory.EVENT]: 'viewer',
  [ActivityCategory.STATUS]: 'idle',
  [ActivityCategory.ERROR]: 'error',
  [ActivityCategory.CHAT]: 'chat',
} satisfies Record<ActivityCategory, Tone>;

/**
 * The colour of an activity event's name where the stored log shows it raw (the Data page),
 * by the event's category; undefined for a value that's no recorded event.
 */
export function activityEventTone(value: string): Tone | undefined {
  const category = Object.entries(ACTIVITY_EVENT_CATEGORIES).find(
    ([event]) => event === value
  )?.[1];
  return category === undefined ? undefined : CATEGORY_TONES[category];
}
