import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseManager } from '../../database/DatabaseManager.js';
import { SuggestionRepository } from '../../database/repositories/SuggestionRepository.js';
import { createTestDatabase } from '../../database/repositories/testDatabase.js';
import { SuggestionBox } from '../../suggestions/SuggestionBox.js';
import { createSuggestionsRouter } from './suggestionsRouter.js';
import { createCallerFactory } from './trpc.js';

let db: DatabaseManager;
let cleanup: () => Promise<void>;
let box: SuggestionBox;
let controller: AbortController;

const caller = () =>
  createCallerFactory(createSuggestionsRouter(box))(
    { consoleOrigin: null },
    { signal: controller.signal }
  );

beforeEach(async () => {
  ({ db, cleanup } = await createTestDatabase());
  box = new SuggestionBox(new SuggestionRepository(db));
  controller = new AbortController();
});

afterEach(async () => {
  controller.abort();
  await cleanup();
});

describe('suggestions router', () => {
  it('sends every suggestion on subscribing and again when one is added', async () => {
    box.add('a quote command', 'viewer1');
    const updates = (await caller().watch())[Symbol.asyncIterator]();
    expect((await updates.next()).value).toMatchObject([{ suggestion: 'a quote command' }]);

    const next = updates.next();
    box.add('more bonk', 'viewer2');

    expect((await next).value).toMatchObject([
      { suggestion: 'more bonk' },
      { suggestion: 'a quote command' },
    ]);
  });

  it('deletes suggestions and answers with the list it left', async () => {
    box.add('keep', 'a');
    box.add('troll', 'b');
    const troll = box.list()[0]?.id ?? 0;

    const left = await caller().delete({ ids: [troll] });

    expect(left).toMatchObject([{ suggestion: 'keep' }]);
  });

  it('rejects a delete of no suggestions', async () => {
    await expect(caller().delete({ ids: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
