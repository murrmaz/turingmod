import {
  type ActivityData,
  type ActivityEventName,
  type ActivityLogEntry,
  ActivityLogEntrySchema,
  IntegrationStatus,
  PermissionLevel,
  StreamingPlatform,
} from '@turingmod/shared';

const twitch = StreamingPlatform.TWITCH;
const when = '2026-01-01T00:00:00.000Z';
const viewer = { userId: '1', userName: 'ana', userDisplayName: 'Ana' };

/** A complete payload for each event, which a test overrides only where it matters. */
const PAYLOADS: { [E in ActivityEventName]: ActivityData<E> } = {
  'chat.message': {
    platform: twitch,
    platformUserId: '1',
    username: 'ana',
    message: 'hi',
    permissionLevel: PermissionLevel.VIEWER,
    badges: [],
    timestamp: 0,
    messageId: 'm',
    channelId: 'c',
  },
  'command.executed': {
    success: true,
    command: 'so',
    username: 'ana',
    userId: '1',
    platform: twitch,
    args: [],
    message: '',
    isSimulation: false,
  },
  'twitch.follow': { ...viewer, followDate: when },
  'twitch.subscribe': { ...viewer, tier: '1000', isGift: false },
  'twitch.raid': {
    fromBroadcasterId: '2',
    fromBroadcasterName: 'raider',
    fromBroadcasterDisplayName: 'Raider',
    viewers: 5,
  },
  'twitch.cheer': { ...viewer, bits: 5, message: '' },
  'twitch.ad.break': {
    durationSeconds: 60,
    startedAt: when,
    isAutomatic: true,
    broadcasterId: '3',
    broadcasterName: 'me',
    broadcasterDisplayName: 'Me',
  },
  'stream.break.started': { reason: 'manual', durationSeconds: 60 },
  'stream.break.ended': { reason: 'manual', durationSeconds: 60 },
  'twitch.channelPoint.redemption': {
    ...viewer,
    id: '4',
    rewardId: '5',
    rewardTitle: 'Bonk',
    rewardCost: 100,
    input: '',
    status: 'unfulfilled',
    redeemedAt: when,
  },
  'obs.scene.changed': { sceneName: 'Gameplay' },
  'obs.stream.stateChanged': { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' },
  'obs.record.stateChanged': {
    outputActive: true,
    outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
    outputPath: null,
  },
  'obs.sceneItem.stateChanged': { sceneName: 'Gameplay', sceneItemId: 1, sceneItemEnabled: true },
  'arduino.message': { type: 'log' },
  'integration.status': { name: 'obs', status: IntegrationStatus.CONNECTED },
  'platform.availability': { platform: twitch, available: true, reason: null },
  'platform.liveState': { platform: twitch, live: false, startedAt: null },
  'integration.error': { name: 'obs', message: 'refused' },
};

/**
 * An entry of this event as the backend sends it, complete but for what the test gives. Parsed,
 * so a test can't show the console an entry the backend never would.
 */
export function activityEntry<E extends ActivityEventName>(
  event: E,
  data?: Partial<ActivityData<E>> | Record<string, unknown>,
  { id = '1', timestamp = 0 }: { id?: string; timestamp?: number } = {}
): ActivityLogEntry {
  return ActivityLogEntrySchema.parse({
    id,
    event,
    data: { ...PAYLOADS[event], ...data },
    timestamp,
  });
}
