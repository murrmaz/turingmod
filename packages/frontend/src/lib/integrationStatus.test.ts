import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import {
  dependentsOf,
  describeEnabled,
  hasProblem,
  inDisplayOrder,
  integrationChains,
} from './integrationStatus';

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

describe('hasProblem', () => {
  const failing = (status: IntegrationStatus, errorMessage?: string): IntegrationInfo => ({
    ...integration('obs'),
    status,
    ...(errorMessage === undefined ? {} : { errorMessage }),
  });

  it('counts a message as a problem only while the integration is failing', () => {
    expect(hasProblem(failing(IntegrationStatus.ERROR, 'Refused'))).toBe(true);
    expect(hasProblem(failing(IntegrationStatus.NEEDS_REAUTH, 'Expired'))).toBe(true);
    expect(hasProblem(failing(IntegrationStatus.BLOCKED, 'Waiting for twitch-auth'))).toBe(false);
    expect(hasProblem(failing(IntegrationStatus.ERROR))).toBe(false);
  });
});

describe('dependentsOf', () => {
  it('names the integrations that list this one as a dependency', () => {
    const auth = integration('twitch-auth');
    const api = integration('twitch-api', undefined, ['twitch-auth']);
    const obs = integration('obs');

    expect(dependentsOf(auth, [auth, api, obs])).toEqual(['twitch-api']);
    expect(dependentsOf(obs, [auth, api, obs])).toEqual([]);
  });
});

describe('describeEnabled', () => {
  it('says when an enabled integration runs, and no for one that is not', () => {
    const api = { ...integration('twitch-api', undefined, ['twitch-auth']), enabled: true };

    expect(describeEnabled({ ...api, enabled: false })).toBe('no');
    expect(describeEnabled(api)).toBe('yes — comes back when twitch-auth recovers');
    expect(describeEnabled({ ...integration('obs'), enabled: true })).toBe(
      'yes — starts with TuringMod'
    );
  });
});

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
