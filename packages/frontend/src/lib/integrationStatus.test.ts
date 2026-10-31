import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { inDisplayOrder, integrationChains } from './integrationStatus';

const twitch = { id: 'twitch', label: 'Twitch' };
const spotify = { id: 'spotify', label: 'Spotify' };

function integration(
  name: string,
  group?: IntegrationInfo['group'],
  dependencies: string[] = []
): IntegrationInfo {
  return {
    name,
    status: IntegrationStatus.DISCONNECTED,
    enabled: false,
    metadata: { dependencies },
    ...(group ? { group } : {}),
  };
}

const integrations = [
  integration('twitch-eventsub', twitch, ['twitch-auth', 'twitch-api']),
  integration('obs'),
  integration('twitch-api', twitch, ['twitch-auth']),
  integration('spotify-api', spotify, ['spotify-auth']),
  integration('discord'),
  integration('twitch-auth', twitch),
  integration('spotify-auth', spotify),
];

const names = (list: IntegrationInfo[]) => list.map((i) => i.name);

describe('integrationChains', () => {
  it('makes a chain of each group the integrations name, by label, in dependency order', () => {
    const chains = integrationChains(integrations);

    expect(chains.map((chain) => chain.group.label)).toEqual(['Spotify', 'Twitch']);
    expect(chains.map((chain) => names(chain.items))).toEqual([
      ['spotify-auth', 'spotify-api'],
      ['twitch-auth', 'twitch-api', 'twitch-eventsub'],
    ]);
  });
});

describe('inDisplayOrder', () => {
  it('puts the chains first, then the standalone integrations by name', () => {
    expect(names(inDisplayOrder(integrations))).toEqual([
      'spotify-auth',
      'spotify-api',
      'twitch-auth',
      'twitch-api',
      'twitch-eventsub',
      'discord',
      'obs',
    ]);
  });
});
