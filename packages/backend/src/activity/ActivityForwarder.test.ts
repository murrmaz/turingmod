import 'reflect-metadata';
import {
  ACTIVITY_EVENT_NAMES,
  type ActivityEventName,
  type ActivityLogEntry,
  ActivityLogEntrySchema,
  IntegrationStatus,
  StreamingPlatform,
} from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { EventMap } from '../core/events.js';
import type { ActivityLogRepository } from '../database/repositories/ActivityLogRepository.js';
import { chatMessage } from '../platforms/testing.js';
import { Logger } from '../utils/Logger.js';
import { ActivityForwarder } from './ActivityForwarder.js';

const twitch = StreamingPlatform.TWITCH;
const when = new Date(0);
const viewer = { userId: '1', userName: 'ana', userDisplayName: 'Ana' };
const channel = { broadcasterId: '2', broadcasterName: 'me', broadcasterDisplayName: 'Me' };
const run = {
  command: 'so',
  username: 'ana',
  userId: '1',
  platform: twitch,
  args: [],
  message: 'ok',
  isSimulation: false,
};

/** A payload as each event's emitter sends it, so every schema is tried against its EventMap. */
const PAYLOADS: { [E in ActivityEventName]: EventMap[E] } = {
  'chat.message': chatMessage('hello'),
  'command.executed': { ...run, success: true },
  'twitch.follow': { ...viewer, followDate: when },
  'twitch.subscribe': { ...viewer, tier: '1000', isGift: false },
  'twitch.raid': {
    fromBroadcasterId: '3',
    fromBroadcasterName: 'raider',
    fromBroadcasterDisplayName: 'Raider',
    viewers: 5,
  },
  'twitch.cheer': { userId: null, userName: null, userDisplayName: null, bits: 5, message: 'hi' },
  'twitch.ad.break': { ...channel, durationSeconds: 60, startedAt: when, isAutomatic: true },
  'stream.break.started': { reason: 'ad', durationSeconds: 60 },
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
  'obs.scene.changed': { sceneName: 'Gameplay', sceneUuid: 'g' },
  'obs.stream.stateChanged': { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' },
  'obs.record.stateChanged': {
    outputActive: false,
    outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
    outputPath: '/videos/stream.mkv',
  },
  'obs.sceneItem.stateChanged': {
    sceneName: 'Gameplay',
    sceneUuid: 'g',
    sceneItemId: 3,
    sceneItemEnabled: false,
  },
  'arduino.message': { type: 'log', text: 'homed' },
  'integration.status': { name: 'obs', status: IntegrationStatus.CONNECTED },
  'platform.availability': { platform: twitch, available: false, reason: 'Not signed in' },
  'platform.liveState': { platform: twitch, live: true, startedAt: 0, cause: 'reported' },
  'integration.error': { name: 'obs', error: new Error('refused') },
};

function setup() {
  const logger = new Logger({ level: 'silent' });
  const eventBus = new EventBus(logger);
  const repo = { create: vi.fn() };
  const forwarder = new ActivityForwarder(
    eventBus,
    repo as unknown as ActivityLogRepository,
    logger
  );
  const entries: ActivityLogEntry[] = [];
  forwarder.onEntry((entry) => entries.push(entry));
  forwarder.start();
  return { eventBus, repo, entries };
}

describe('ActivityForwarder', () => {
  it("makes every event an entry that still fits its schema once it's been through JSON", async () => {
    const { eventBus, entries } = setup();
    const emit = <E extends ActivityEventName>(event: E) =>
      eventBus.emit(event, PAYLOADS[event] as EventMap[E]);

    for (const event of ACTIVITY_EVENT_NAMES) {
      await emit(event);
    }

    expect(entries.map((entry) => entry.event)).toEqual(ACTIVITY_EVENT_NAMES);
    for (const entry of entries) {
      expect(ActivityLogEntrySchema.parse(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
    }
  });

  it('sends chat to the live feed without storing it', async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('chat.message', chatMessage('hello'));

    expect(entries.map((entry) => entry.event)).toEqual(['chat.message']);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("sends a break's scene item changes to the live feed without storing them", async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('obs.sceneItem.stateChanged', PAYLOADS['obs.sceneItem.stateChanged']);

    expect(entries.map((entry) => entry.event)).toEqual(['obs.sceneItem.stateChanged']);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('sends other activity to the live feed and stores it', async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('integration.error', { name: 'obs', error: new Error('refused') });

    expect(entries).toEqual([
      expect.objectContaining({
        event: 'integration.error',
        data: { name: 'obs', message: 'refused' },
      }),
    ]);
    expect(repo.create).toHaveBeenCalledWith(entries[0]);
  });

  it('sends a simulated command to the live feed without storing it', async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('command.executed', { ...run, isSimulation: true, success: true });

    expect(entries).toHaveLength(1);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('records a date as ISO text', async () => {
    const { eventBus, entries } = setup();

    await eventBus.emit('twitch.follow', PAYLOADS['twitch.follow']);

    expect(entries[0]?.data).toMatchObject({ followDate: '1970-01-01T00:00:00.000Z' });
  });

  it('keeps a recording that started, which OBS reports with no path', async () => {
    const { eventBus, entries } = setup();

    await eventBus.emit('obs.record.stateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
      outputPath: null as unknown as string,
    });

    expect(entries[0]?.data).toMatchObject({ outputPath: null });
  });

  it('records only the fields its schema names', async () => {
    const { eventBus, entries } = setup();

    await eventBus.emit('platform.liveState', PAYLOADS['platform.liveState']);

    expect(entries[0]?.data).toEqual({ platform: twitch, live: true, startedAt: 0 });
  });

  it("doesn't record a platform going unknown as a stream ending", async () => {
    const { eventBus, entries } = setup();

    await eventBus.emit('platform.liveState', {
      platform: twitch,
      live: false,
      startedAt: null,
      cause: 'unavailable',
    });

    expect(entries).toEqual([]);
  });

  it('drops an event whose payload does not fit its schema', async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('twitch.raid', {
      ...PAYLOADS['twitch.raid'],
      viewers: 'many' as unknown as number,
    });

    expect(entries).toEqual([]);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
