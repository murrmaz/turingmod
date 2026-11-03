import { describe, expect, it } from 'vitest';
import { type DataInspector, DataRefusedError } from '../../database/DataInspector.js';
import { createDataRouter } from './dataRouter.js';
import { createCallerFactory } from './trpc.js';

const caller = (inspector: Partial<DataInspector>) =>
  createCallerFactory(createDataRouter(inspector as DataInspector))({ consoleOrigin: null });

describe('data router', () => {
  it('answers with the page the inspector read', async () => {
    const page = { rows: [{ name: 'obs' }], total: 1 };

    await expect(
      caller({ queryRows: () => page }).queryRows({ table: 'settings', page: 0, pageSize: 25 })
    ).resolves.toEqual(page);
  });

  it("reports what the inspector refuses as the console's bad request, with its reason", async () => {
    const refusing = caller({
      queryRows: () => {
        throw new DataRefusedError('Unknown table: secrets');
      },
    });

    await expect(
      refusing.queryRows({ table: 'secrets', page: 0, pageSize: 25 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Unknown table: secrets' });
  });

  it('reports a read that failed as a failure, not as the console asking wrongly', async () => {
    const failing = caller({
      queryRows: () => {
        throw new Error('database disk image is malformed');
      },
    });

    await expect(
      failing.queryRows({ table: 'settings', page: 0, pageSize: 25 })
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'database disk image is malformed',
    });
  });

  it('rejects a page larger than the most one page may hold', async () => {
    await expect(
      caller({}).queryRows({ table: 'settings', page: 0, pageSize: 10_000 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
