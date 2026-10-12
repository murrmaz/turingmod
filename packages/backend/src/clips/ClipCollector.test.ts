import 'reflect-metadata';
import { readFile, rm } from 'node:fs/promises';
import { StreamingPlatform } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ClipInfo } from '../platforms/interfaces/IStreamPlatform.js';
import type { StreamControlService } from '../platforms/StreamControlService.js';
import { chatMessage } from '../platforms/testing.js';
import { Logger } from '../utils/Logger.js';
import { ClipCollector, clipIdsIn, renderClipPage } from './ClipCollector.js';

const clip = (id: string): ClipInfo => ({
  id,
  url: `https://clips.twitch.tv/${id}`,
  title: `Clip <${id}>`,
  creatorName: 'clipper',
  broadcasterName: 'pope_pontius',
  views: 3,
  createdAt: new Date(0),
});

describe('clipIdsIn', () => {
  it('finds clip links in both URL forms', () => {
    expect(
      clipIdsIn(
        'look https://clips.twitch.tv/FunnyClip-abc123 and twitch.tv/pope_pontius/clip/Other-x_9 lol'
      )
    ).toEqual(['FunnyClip-abc123', 'Other-x_9']);
    expect(clipIdsIn('https://www.twitch.tv/pope_pontius is live')).toEqual([]);
  });
});

describe('ClipCollector', () => {
  let eventBus: EventBus;
  let getClip: ReturnType<typeof vi.fn>;
  let collector: ClipCollector;
  let written: string[];

  beforeEach(() => {
    const logger = new Logger({ level: 'silent' });
    eventBus = new EventBus(logger);
    getClip = vi.fn((_platform: StreamingPlatform, id: string) =>
      Promise.resolve(id.startsWith('Fake') ? null : clip(id))
    );
    collector = new ClipCollector(eventBus, { getClip } as unknown as StreamControlService, logger);
    collector.start();
    written = [];
  });

  afterEach(async () => {
    for (const path of written) await rm(path, { force: true });
  });

  it('ignores clip links until collection is switched on', async () => {
    await eventBus.emit('chat.message', chatMessage('https://clips.twitch.tv/Early'));

    expect(getClip).not.toHaveBeenCalled();
    expect(collector.isCollecting()).toBe(false);
  });

  it('keeps each real clip once and writes them to a page when collection ends', async () => {
    expect(collector.begin()).toBe(true);
    expect(collector.begin()).toBe(false);

    await eventBus.emit('chat.message', chatMessage('https://clips.twitch.tv/First'));
    await eventBus.emit('chat.message', chatMessage('again https://clips.twitch.tv/First'));
    await eventBus.emit('chat.message', chatMessage('https://clips.twitch.tv/FakeOne'));
    await eventBus.emit('chat.message', chatMessage('twitch.tv/someone/clip/Second'));

    const result = await collector.end(new Date('2026-10-30T20:00:00Z'));
    if (!result) throw new Error('collection should have been on');
    written.push(result.path);

    expect(result.count).toBe(2);
    expect(getClip).toHaveBeenCalledTimes(3);
    const page = await readFile(result.path, 'utf8');
    expect(page).toContain('Clip &lt;First&gt;');
    expect(page.indexOf('First')).toBeLessThan(page.indexOf('Second'));
    expect(collector.isCollecting()).toBe(false);
    expect(await collector.end()).toBeNull();
  });

  it('only collects from Twitch chat', async () => {
    collector.begin();

    await eventBus.emit(
      'chat.message',
      chatMessage('https://clips.twitch.tv/First', { platform: StreamingPlatform.YOUTUBE })
    );

    expect(getClip).not.toHaveBeenCalled();
    const result = await collector.end();
    if (result) written.push(result.path);
  });

  it('renders an empty collection as such', () => {
    expect(renderClipPage([], new Date(0))).toContain('No clips were linked.');
  });
});
