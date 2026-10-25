import 'reflect-metadata';
import { createMessage, MessageType } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { YouTubeChatIntegration } from '../../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { Logger } from '../../utils/Logger.js';
import { YouTubeHandler } from './YouTubeHandler.js';

const chat = (running: boolean) => {
  const connectChat = vi.fn();
  const integration = {
    isRunning: () => running,
    connectChat,
    getState: () => (running ? 'resolving' : 'idle'),
  } as unknown as YouTubeChatIntegration;
  return { integration, connectChat };
};

describe('YouTubeHandler.handleGoLive', () => {
  const logger = new Logger({ level: 'silent' });
  const request = () => createMessage(MessageType.YOUTUBE_GO_LIVE, {});

  it('connects chat and answers with the new state when the integration is running', async () => {
    const { integration, connectChat } = chat(true);

    const response = await new YouTubeHandler(integration, logger).handleGoLive(request());

    expect(connectChat).toHaveBeenCalledWith('console');
    expect(response.payload).toEqual({ state: 'resolving' });
  });

  it("refuses when the integration isn't running, rather than answering that it worked", async () => {
    const { integration, connectChat } = chat(false);

    await expect(new YouTubeHandler(integration, logger).handleGoLive(request())).rejects.toThrow(
      "youtube-chat isn't running"
    );
    expect(connectChat).not.toHaveBeenCalled();
  });
});
