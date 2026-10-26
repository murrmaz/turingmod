import 'reflect-metadata';
import type { ActivityLogEntry } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ActivityLogRepository } from '../database/repositories/ActivityLogRepository.js';
import { chatMessage } from '../platforms/testing.js';
import { Logger } from '../utils/Logger.js';
import { ActivityForwarder } from './ActivityForwarder.js';

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
  it('sends chat to the live feed without storing it', async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('chat.message', chatMessage('hello'));

    expect(entries.map((entry) => entry.event)).toEqual(['chat.message']);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("sends a break's scene item changes to the live feed without storing them", async () => {
    const { eventBus, repo, entries } = setup();

    await eventBus.emit('obs.sceneItem.stateChanged', {
      sceneName: 'Gameplay',
      sceneUuid: 'g',
      sceneItemId: 3,
      sceneItemEnabled: false,
    });

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
});
