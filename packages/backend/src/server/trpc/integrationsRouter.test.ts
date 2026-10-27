import 'reflect-metadata';
import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import type { IntegrationManager } from '../../integrations/IntegrationManager.js';
import { Logger } from '../../utils/Logger.js';
import { createIntegrationsRouter } from './integrationsRouter.js';
import { createCallerFactory } from './trpc.js';

const logger = new Logger({ level: 'silent' });

function info(status: IntegrationStatus, enabled = true): IntegrationInfo {
  return { name: 'obs', status, enabled, metadata: { dependencies: [] } };
}

function setup() {
  const eventBus = new EventBus(logger);
  let current = [info(IntegrationStatus.DISCONNECTED, false)];
  const manager = {
    getAllStatuses: () => current,
    enableIntegration: vi.fn(() => Promise.resolve()),
    disableIntegration: vi.fn(() => {
      // An integration that had already stopped changes only `enabled`: no status event.
      current = [info(IntegrationStatus.DISCONNECTED, false)];
      return Promise.resolve();
    }),
    configureIntegration: vi.fn(() => Promise.reject(new Error('clientId: Required'))),
  };
  const controller = new AbortController();
  // The signal ends a subscription, as the console unsubscribing does.
  const caller = createCallerFactory(
    createIntegrationsRouter(manager as unknown as IntegrationManager, eventBus, logger)
  )({ consoleOrigin: null }, { signal: controller.signal });
  return {
    controller,
    eventBus,
    manager,
    caller,
    setCurrent: (next: IntegrationInfo[]) => {
      current = next;
    },
  };
}

describe('integrations router', () => {
  it('watch sends every integration, then again on each status change', async () => {
    const { caller, controller, eventBus, setCurrent } = setup();
    const updates = (await caller.watch())[Symbol.asyncIterator]();

    expect((await updates.next()).value).toEqual([info(IntegrationStatus.DISCONNECTED, false)]);

    const next = updates.next();
    setCurrent([info(IntegrationStatus.CONNECTED)]);
    await eventBus.emit('integration.status', { name: 'obs', status: IntegrationStatus.CONNECTED });
    expect((await next).value).toEqual([info(IntegrationStatus.CONNECTED)]);
    controller.abort();
  });

  it('watch sends what a mutation changed even when no status changed', async () => {
    const { caller, controller, setCurrent } = setup();
    setCurrent([info(IntegrationStatus.DISCONNECTED, true)]);
    const updates = (await caller.watch())[Symbol.asyncIterator]();
    await updates.next();

    const next = updates.next();
    await caller.stop({ integrationName: 'obs' });

    expect((await next).value).toEqual([info(IntegrationStatus.DISCONNECTED, false)]);
    controller.abort();
  });

  it('rejects a malformed input before reaching the manager', async () => {
    const { caller, manager } = setup();

    await expect(caller.start({ integrationName: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(manager.enableIntegration).not.toHaveBeenCalled();
  });

  it("passes on the manager's error, so the console can show it", async () => {
    const { caller } = setup();

    await expect(caller.configure({ integrationName: 'twitch-auth', config: {} })).rejects.toThrow(
      'clientId: Required'
    );
  });
});

describe('integrations router state', () => {
  it('answers a mutation with every integration as it left them', async () => {
    const { caller, setCurrent } = setup();
    setCurrent([info(IntegrationStatus.DISCONNECTED, true)]);

    expect(await caller.stop({ integrationName: 'obs' })).toEqual([
      info(IntegrationStatus.DISCONNECTED, false),
    ]);
  });

  it('reads the integrations once per change, however many consoles watch', async () => {
    const { caller, controller, eventBus, manager } = setup();
    const reads = vi.spyOn(manager, 'getAllStatuses');
    const first = (await caller.watch())[Symbol.asyncIterator]();
    const second = (await caller.watch())[Symbol.asyncIterator]();
    await Promise.all([first.next(), second.next()]);

    const next = [first.next(), second.next()];
    await eventBus.emit('integration.status', { name: 'obs', status: IntegrationStatus.CONNECTED });
    await Promise.all(next);

    expect(reads).toHaveBeenCalledTimes(2);
    controller.abort();
  });
});
