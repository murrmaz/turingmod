import type { StreamingPlatform } from '../constants/platform.js';

/**
 * Whether one platform is broadcasting. `startedAt` (epoch ms) is null when offline, or when the
 * platform hasn't reported a start time yet.
 */
export interface PlatformLiveState {
  platform: StreamingPlatform;
  live: boolean;
  startedAt: number | null;
}

/**
 * Where the YouTube chat integration is in its lifecycle. `IntegrationStatus` only says whether the
 * integration is enabled; this says whether chat is actually connected.
 *
 * - `idle` — running, but waiting for a go-live signal
 * - `resolving` — a signal arrived; looking for an active broadcast's liveChatId
 * - `streaming` — connected to live chat and receiving messages
 */
export type YouTubeChatState = 'idle' | 'resolving' | 'streaming';
