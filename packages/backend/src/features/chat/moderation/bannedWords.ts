import { BAN_DURATION_MS } from '@turingmod/shared';

/** Bans made at or after this time are still in force at `now`. */
export function banCutoff(now = Date.now()): number {
  return now - BAN_DURATION_MS;
}
