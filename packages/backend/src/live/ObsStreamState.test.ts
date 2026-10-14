import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ObsIntegration } from '../integrations/implementations/obs/ObsIntegration.js';
import { Logger } from '../utils/Logger.js';
import { ObsStreamState } from './ObsStreamState.js';

const logger = new Logger({ level: 'silent' });

describe('ObsStreamState', () => {
  let eventBus: EventBus;
  let obs: { name: string; isStreaming: ReturnType<typeof vi.fn<() => Promise<boolean>>> };
  let state: ObsStreamState;
  let published: boolean[];

  const outputState = (outputState: string) =>
    eventBus.emit('obs.stream.stateChanged', { outputActive: false, outputState });
  const obsConnected = () =>
    eventBus.emit('integration.status', { name: 'obs', status: IntegrationStatus.CONNECTED });

  beforeEach(() => {
    eventBus = new EventBus(logger);
    obs = { name: 'obs', isStreaming: vi.fn(() => Promise.resolve(false)) };
    state = new ObsStreamState(eventBus, obs as unknown as ObsIntegration, logger);
    state.start();
    published = [];
    eventBus.on('stream.output.changed', ({ streaming }) => {
      published.push(streaming);
    });
  });

  it('publishes when OBS starts and stops streaming', async () => {
    await outputState('OBS_WEBSOCKET_OUTPUT_STARTED');
    expect(state.isStreaming()).toBe(true);

    await outputState('OBS_WEBSOCKET_OUTPUT_STOPPED');

    expect(state.isStreaming()).toBe(false);
    expect(published).toEqual([true, false]);
  });

  it('treats OBS reconnecting to the ingest server as no change', async () => {
    await outputState('OBS_WEBSOCKET_OUTPUT_STARTED');

    await outputState('OBS_WEBSOCKET_OUTPUT_RECONNECTING');
    await outputState('OBS_WEBSOCKET_OUTPUT_RECONNECTED');

    expect(state.isStreaming()).toBe(true);
    expect(published).toEqual([true]);
  });

  it('asks OBS when it connects, so a stream already going out is noticed', async () => {
    obs.isStreaming.mockResolvedValue(true);

    await obsConnected();

    expect(state.isStreaming()).toBe(true);
    expect(published).toEqual([true]);
  });

  it('notices a stream that stopped while OBS was disconnected', async () => {
    await outputState('OBS_WEBSOCKET_OUTPUT_STARTED');
    await eventBus.emit('integration.status', {
      name: 'obs',
      status: IntegrationStatus.DISCONNECTED,
    });
    expect(state.isStreaming()).toBe(true);

    await obsConnected();

    expect(state.isStreaming()).toBe(false);
    expect(published).toEqual([true, false]);
  });

  it('publishes nothing when asking OBS finds no change', async () => {
    await obsConnected();

    expect(published).toEqual([]);
  });

  it('keeps the last state when OBS cannot be asked', async () => {
    await outputState('OBS_WEBSOCKET_OUTPUT_STARTED');
    obs.isStreaming.mockRejectedValue(new Error('Not connected'));

    await obsConnected();

    expect(state.isStreaming()).toBe(true);
  });

  it('ignores other integrations connecting', async () => {
    await eventBus.emit('integration.status', {
      name: 'youtube-chat',
      status: IntegrationStatus.CONNECTED,
    });

    expect(obs.isStreaming).not.toHaveBeenCalled();
  });

  it('stops listening on stop()', async () => {
    state.stop();

    await outputState('OBS_WEBSOCKET_OUTPUT_STARTED');

    expect(state.isStreaming()).toBe(false);
  });
});
