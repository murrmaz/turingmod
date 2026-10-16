import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';

/**
 * What "Reconnect" acts on for a broken integration: itself if it signs in with OAuth or simply
 * failed, otherwise the OAuth integration it depends on (an API integration needing
 * reauthorization is fixed by authorizing its auth integration again).
 */
export function reconnectTarget(
  integration: IntegrationInfo,
  all: IntegrationInfo[]
): IntegrationInfo {
  if (integration.oauth || integration.status !== IntegrationStatus.NEEDS_REAUTH) {
    return integration;
  }
  const seen = new Set<string>();
  const queue = [...(integration.metadata?.dependencies ?? [])];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const dependency = all.find((candidate) => candidate.name === name);
    if (dependency?.oauth) {
      return dependency;
    }
    queue.push(...(dependency?.metadata?.dependencies ?? []));
  }
  return integration;
}
