import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';
import type { Tone } from '@/components/status';

/** How an integration's state reads in the console. */
export interface IntegrationDisplay {
  label: string;
  tone: Tone;
  /** Broken in a way the streamer has to fix: shown under "Needs attention". */
  needsAttention: boolean;
}

export function describeIntegration(integration: IntegrationInfo): IntegrationDisplay {
  if (integration.placeholder) {
    return { label: 'planned', tone: 'idle', needsAttention: false };
  }
  switch (integration.status) {
    case IntegrationStatus.CONNECTED:
      return { label: 'connected', tone: 'viewer', needsAttention: false };
    case IntegrationStatus.CONNECTING:
      return { label: 'connecting', tone: 'system', needsAttention: false };
    case IntegrationStatus.ERROR:
      return { label: 'error', tone: 'error', needsAttention: true };
    case IntegrationStatus.NEEDS_REAUTH:
      return { label: 'needs reauth', tone: 'error', needsAttention: true };
    case IntegrationStatus.BLOCKED:
      return { label: 'blocked', tone: 'idle', needsAttention: false };
    default:
      return {
        label: integration.enabled ? 'disconnected' : 'disabled',
        tone: 'idle',
        needsAttention: false,
      };
  }
}

/** Display order of the dependency chains on the Integrations page, by group. */
export const INTEGRATION_CHAINS = [
  { group: 'twitch', label: 'Twitch' },
  { group: 'youtube', label: 'YouTube' },
  { group: 'spotify', label: 'Spotify' },
] as const;

/**
 * The integrations of one group in dependency order (each after the ones it depends on), so a
 * chain reads auth → api → real-time.
 */
export function orderByDependencies(integrations: IntegrationInfo[]): IntegrationInfo[] {
  const names = new Set(integrations.map((integration) => integration.name));
  const depth = (integration: IntegrationInfo, seen = new Set<string>()): number => {
    if (seen.has(integration.name)) {
      return 0;
    }
    seen.add(integration.name);
    const deps = (integration.metadata?.dependencies ?? []).filter((dep) => names.has(dep));
    return deps.length === 0
      ? 0
      : 1 +
          Math.max(
            ...deps.map((dep) => {
              const found = integrations.find((candidate) => candidate.name === dep);
              return found ? depth(found, seen) : 0;
            })
          );
  };
  return [...integrations].sort((a, b) => depth(a) - depth(b) || a.name.localeCompare(b.name));
}

/** Every integration in display order: each chain in turn, then the standalone ones. */
export function inDisplayOrder(integrations: IntegrationInfo[]): IntegrationInfo[] {
  return [
    ...INTEGRATION_CHAINS.flatMap(({ group }) =>
      orderByDependencies(integrations.filter((integration) => integration.group === group))
    ),
    ...integrations
      .filter((integration) => !integration.group)
      .sort(
        (a, b) => Number(a.placeholder) - Number(b.placeholder) || a.name.localeCompare(b.name)
      ),
  ];
}
