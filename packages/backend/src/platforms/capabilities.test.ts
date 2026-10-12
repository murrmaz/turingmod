import 'reflect-metadata';
import { PlatformCapability } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import type { TwitchApiIntegration } from '../integrations/implementations/twitch/TwitchApiIntegration.js';
import type { TwitchAuthIntegration } from '../integrations/implementations/twitch/TwitchAuthIntegration.js';
import type { YouTubeApiIntegration } from '../integrations/implementations/youtube/YouTubeApiIntegration.js';
import { capabilitiesOf } from './capabilities.js';
import type { OwnChatMessages } from './OwnChatMessages.js';
import { TwitchPlatform } from './TwitchPlatform.js';
import { YouTubePlatform } from './YouTubePlatform.js';

describe('capabilitiesOf', () => {
  it('gives Twitch every capability', () => {
    const twitch = new TwitchPlatform(
      {} as TwitchAuthIntegration,
      {} as TwitchApiIntegration,
      {} as OwnChatMessages
    );

    expect(capabilitiesOf(twitch)).toEqual(new Set(Object.values(PlatformCapability)));
  });

  it('gives YouTube only what it declares, since it has no capability objects', () => {
    const youtube = new YouTubePlatform({} as YouTubeApiIntegration, {} as OwnChatMessages);

    expect(capabilitiesOf(youtube)).toEqual(
      new Set([
        PlatformCapability.SEND_CHAT,
        PlatformCapability.SET_TITLE,
        PlatformCapability.UPTIME,
      ])
    );
  });
});
