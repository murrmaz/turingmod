/**
 * Where something the console reads by itself stands, so that a view never shows a failure, or data
 * that hasn't arrived, as if there were nothing to show. `loading` is until the first value; `failed`
 * is until a retry delivers one, and whatever value there was stays, though it may be out of date. A
 * lost connection doesn't count as failing, since the connection banner reports that.
 */
export type LoadStatus =
  | { state: 'loading' | 'live' }
  | { state: 'failed'; title: string; message: string };

export const LOADING: LoadStatus = { state: 'loading' };
export const LIVE: LoadStatus = { state: 'live' };
