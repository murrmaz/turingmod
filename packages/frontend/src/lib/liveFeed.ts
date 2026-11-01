import type { PlatformLiveState } from '@turingmod/shared';
import type { FeedCategory, FeedRow } from './activityFormat';

/** A tab of the live feed: one category, or All. */
export type FeedTab = FeedCategory | 'all';

/** Whether a row shows under a tab. All leaves chat out: it would bury everything else mid-stream. */
export function showsUnder(row: FeedRow, tab: FeedTab): boolean {
  return tab === 'all' ? row.category !== 'chat' : row.category === tab;
}

/** When the stream began: when the first of the live platforms went live; null while none is. */
export function streamStartedAt(platforms: readonly PlatformLiveState[]): number | null {
  const starts = platforms.flatMap((platform) =>
    platform.live && platform.startedAt !== null ? [platform.startedAt] : []
  );
  return starts.length === 0 ? null : Math.min(...starts);
}

/** How many events (chat aside) there are, made since `since`, or in all when it's null. */
export function countEvents(rows: readonly FeedRow[], since: number | null): number {
  return rows.filter((row) => row.category !== 'chat' && (since === null || row.timestamp >= since))
    .length;
}
