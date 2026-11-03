import 'reflect-metadata';
import { IntegrationStatus, PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../core/EventBus.js';
import type { ChatMessageEvent } from '../core/events.js';
import type { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import type { YouTubeApiIntegration } from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import type { YouTubeAuthIntegration } from '../integrations/implementations/youtube/YouTubeAuthIntegration.js';
import type { YouTubeChatIntegration } from '../integrations/implementations/youtube/YouTubeChatIntegration.js';
import { Logger } from '../utils/Logger.js';
import { CAPABILITY_OF_API } from './capabilities.js';
import type { CapabilityApiName, IStreamPlatform } from './interfaces/IStreamPlatform.js';
import { OwnChatMessages } from './OwnChatMessages.js';
import { TwitchPlatform } from './TwitchPlatform.js';
import { chatMessage } from './testing.js';
import { YouTubePlatform } from './YouTubePlatform.js';

/** One way a façade posts to chat. */
interface ChatSend {
  send(message: string): Promise<void>;
  /** The most this send may post, in characters. */
  maxLength: number;
  /** The id the message comes back through ingest with. */
  echoId: string;
}

/** A façade over fake providers, with the real OwnChatMessages behind it. */
interface Harness {
  platform: IStreamPlatform;
  /** Named as `sendMethodsOf()` names them. */
  sends: Record<string, ChatSend>;
  /** The text of each message that reached the provider. */
  posted: string[];
}

function twitchHarness(ownMessages: OwnChatMessages): Harness {
  const posted: string[] = [];
  const client = {
    chat: {
      sendChatMessage: (_user: string, text: string) => {
        posted.push(text);
        return Promise.resolve({ id: 'twitch-message', isSent: true });
      },
      sendAnnouncement: (_user: string, { message }: { message: string }) => {
        posted.push(message);
        return Promise.resolve();
      },
    },
  };
  const auth = {
    getStatus: () => IntegrationStatus.CONNECTED,
    getErrorMessage: () => undefined,
    getAuthenticatedUserId: () => 'broadcaster-id',
  };
  const api = {
    request: (call: (c: typeof client) => Promise<unknown>) => call(client),
    getStoppedReason: () => null,
  };
  const platform = new TwitchPlatform(
    auth as unknown as TwitchAuthIntegration,
    api as unknown as TwitchApiIntegration,
    ownMessages
  );
  return {
    platform,
    posted,
    sends: {
      sendChatMessage: {
        send: (message) => platform.sendChatMessage(message),
        maxLength: 500,
        echoId: 'twitch-message',
      },
      // Twitch gives no id for an announcement, so the echo's is one TuringMod has never seen.
      'announcements.sendAnnouncement': {
        send: (message) => platform.announcements.sendAnnouncement(message),
        maxLength: 500,
        echoId: 'announcement-echo',
      },
    },
  };
}

function youtubeHarness(ownMessages: OwnChatMessages): Harness {
  const posted: string[] = [];
  const client = {
    liveChatMessages: {
      insert: (params: {
        requestBody: { snippet: { textMessageDetails: { messageText: string } } };
      }) => {
        posted.push(params.requestBody.snippet.textMessageDetails.messageText);
        return Promise.resolve({ data: { id: 'youtube-message' } });
      },
    },
  };
  const auth = { getStatus: () => IntegrationStatus.CONNECTED, getErrorMessage: () => undefined };
  const api = {
    request: (call: (c: typeof client) => Promise<unknown>) => call(client),
    getStoppedReason: () => null,
  };
  const chat = { getBroadcast: () => ({ id: 'broadcast', liveChatId: 'chat' }) };
  const platform = new YouTubePlatform(
    auth as unknown as YouTubeAuthIntegration,
    api as unknown as YouTubeApiIntegration,
    ownMessages,
    chat as unknown as YouTubeChatIntegration
  );
  return {
    platform,
    posted,
    sends: {
      sendChatMessage: {
        send: (message) => platform.sendChatMessage(message),
        maxLength: 200,
        echoId: 'youtube-message',
      },
    },
  };
}

/** A new platform doesn't compile until it has a harness here, and so passes these tests. */
const HARNESSES: Record<StreamingPlatform, (ownMessages: OwnChatMessages) => Harness> = {
  [StreamingPlatform.TWITCH]: twitchHarness,
  [StreamingPlatform.YOUTUBE]: youtubeHarness,
};

/** Every send a façade offers, on itself or on a capability object, going by its name. */
function sendMethodsOf(platform: IStreamPlatform): string[] {
  const isSend = (name: string) => name.startsWith('send');
  const own = Object.getOwnPropertyNames(Object.getPrototypeOf(platform)).filter(isSend);
  const onCapabilities = (Object.keys(CAPABILITY_OF_API) as CapabilityApiName[]).flatMap((name) =>
    Object.keys(platform[name] ?? {})
      .filter(isSend)
      .map((method) => `${name}.${method}`)
  );
  return [...own, ...onCapabilities];
}

/**
 * Nothing but this stops a new send method skipping `toSafeChatText()` or `OwnChatMessages`. Skipping
 * either lets the bot run a command with the broadcaster's permission, so this holds each façade to
 * what matters, whichever calls it makes: what reaches chat, and what TuringMod does when it returns.
 */
describe.each(Object.values(StreamingPlatform))('chat sends on %s', (platformName) => {
  const sendNames = Object.keys(HARNESSES[platformName](stubOwnMessages()).sends);
  let eventBus: EventBus;
  let ownMessages: OwnChatMessages;
  let harness: Harness;
  /** What reached the rest of TuringMod after OwnChatMessages' gate. */
  let delivered: ChatMessageEvent[];

  beforeEach(() => {
    const logger = new Logger({ level: 'silent' });
    eventBus = new EventBus(logger);
    ownMessages = new OwnChatMessages(eventBus, logger);
    ownMessages.start();
    harness = HARNESSES[platformName](ownMessages);
    delivered = [];
    eventBus.on('chat.message', (event) => {
      delivered.push(event);
    });
  });

  /** A message as ingest reports it: from the broadcaster, which is who TuringMod posts as. */
  const fromBroadcaster = (message: string, messageId: string) =>
    chatMessage(message, {
      platform: platformName,
      permissionLevel: PermissionLevel.BROADCASTER,
      messageId,
    });

  it('has every send covered here', () => {
    expect(sendMethodsOf(harness.platform).sort()).toEqual(Object.keys(harness.sends).sort());
  });

  it.each(sendNames)('%s can never post a command', async (name) => {
    await sendOf(harness, name).send('!delvod 123');

    expect(harness.posted).toEqual(['delvod 123']);
  });

  it.each(sendNames)('%s fits its platform limit', async (name) => {
    const send = sendOf(harness, name);

    await send.send('x'.repeat(1000));

    expect(Array.from(harness.posted[0] ?? '')).toHaveLength(send.maxLength);
  });

  it.each(sendNames)('%s is not acted on when it comes back', async (name) => {
    const send = sendOf(harness, name);
    await send.send('hello chat');

    await eventBus.emit('chat.received', fromBroadcaster('hello chat', send.echoId));
    expect(delivered).toEqual([]);

    // The gate is still letting the streamer's own words through.
    await eventBus.emit('chat.received', fromBroadcaster('typed by hand', 'streamer-message'));
    expect(delivered.map(({ message }) => message)).toEqual(['typed by hand']);
  });
});

function sendOf(harness: Harness, name: string): ChatSend {
  const send = harness.sends[name];
  if (!send) {
    throw new Error(`No send named ${name}`);
  }
  return send;
}

/** For listing a harness's sends while tests are collected; nothing is sent through it. */
function stubOwnMessages(): OwnChatMessages {
  return {} as OwnChatMessages;
}
