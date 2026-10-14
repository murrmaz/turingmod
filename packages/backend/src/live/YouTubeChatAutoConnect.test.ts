import 'reflect-metadata';
import { IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { Logger } from '../utils/Logger.js';
import type { ObsStreamState } from './ObsStreamState.js';
import { YouTubeChatAutoConnect } from './YouTubeChatAutoConnect.js';

describe('YouTubeChatAutoConnect', () => {
  let eventBus: EventBus;
  let chat: {
    name: string;
    getStatus: ReturnType<typeof vi.fn<() => IntegrationStatus>>;
    connectChat: ReturnType<typeof vi.fn>;
    disconnectChat: ReturnType<typeof vi.fn>;
  };
  let obsStreaming: boolean;
  let service: YouTubeChatAutoConnect;

  const streamOutput = (streaming: boolean) =>
    eventBus.emit('stream.output.changed', { streaming });
  const chatStatus = (status: IntegrationStatus) => {
    chat.getStatus.mockReturnValue(status);
    return eventBus.emit('integration.status', { name: 'youtube-chat', status });
  };

  beforeEach(() => {
    eventBus = new EventBus(new Logger({ level: 'silent' }));
    chat = {
      name: 'youtube-chat',
      getStatus: vi.fn(() => IntegrationStatus.CONNECTED),
      connectChat: vi.fn(),
      disconnectChat: vi.fn(),
    };
    obsStreaming = false;
    const obsStream = { isStreaming: () => obsStreaming };
    service = new YouTubeChatAutoConnect(
      eventBus,
      chat as unknown as YouTubeChatIntegration,
      obsStream as unknown as ObsStreamState
    );
    service.start();
  });

  it('connects chat when OBS starts streaming and disconnects when it stops', async () => {
    await streamOutput(true);
    expect(chat.connectChat).toHaveBeenCalledWith('OBS');

    await streamOutput(false);
    expect(chat.disconnectChat).toHaveBeenCalledWith('OBS');
  });

  it('leaves chat alone while YouTube chat is not running', async () => {
    chat.getStatus.mockReturnValue(IntegrationStatus.BLOCKED);

    await streamOutput(true);

    expect(chat.connectChat).not.toHaveBeenCalled();
  });

  it('connects chat that comes up while OBS is already streaming', async () => {
    obsStreaming = true;

    await chatStatus(IntegrationStatus.CONNECTED);

    expect(chat.connectChat).toHaveBeenCalledWith('OBS');
  });

  it('leaves chat idle when it comes up while OBS is not streaming', async () => {
    await chatStatus(IntegrationStatus.CONNECTED);

    expect(chat.connectChat).not.toHaveBeenCalled();
  });

  it('ignores other integrations connecting', async () => {
    obsStreaming = true;

    await eventBus.emit('integration.status', {
      name: 'obs',
      status: IntegrationStatus.CONNECTED,
    });

    expect(chat.connectChat).not.toHaveBeenCalled();
  });

  it('stops listening on stop()', async () => {
    service.stop();

    await streamOutput(true);

    expect(chat.connectChat).not.toHaveBeenCalled();
  });
});
