import { type IntegrationInfo, IntegrationStatus } from '@turingmod/shared';
import { isBroken } from './integrationStatus';

const { CONNECTED, NEEDS_REAUTH } = IntegrationStatus;

/**
 * Something the console can do with an integration: sign in through the OAuth flow, start it, or
 * stop it. `target` is what it acts on, which for reconnecting an API integration is the auth
 * integration it signs in through.
 */
export interface IntegrationAction {
  kind: 'authorize' | 'start' | 'stop';
  /** The button's text, the same wherever the action is offered. */
  label: string;
  target: IntegrationInfo;
}

/**
 * Everything the console offers for an integration, in order: what would get it running or fix
 * it (repairAction), then Stop. The Integrations page offers them all; the dashboard's Needs
 * attention card offers only the repair.
 */
export function integrationActions(
  integration: IntegrationInfo,
  all: IntegrationInfo[]
): IntegrationAction[] {
  const repair = repairAction(integration, all);
  const actions = repair ? [repair] : [];
  // Stop applies to anything running or waiting to run, such as one blocked on a dependency.
  if (integration.status === CONNECTED || integration.enabled) {
    actions.push({ kind: 'stop', label: 'Stop', target: integration });
  }
  return actions;
}

/**
 * What gets an integration running, or running again: signing in, for an OAuth integration;
 * signing in again through the auth integration it depends on, for an API integration that lost
 * its grant; otherwise starting it (Retry, after a failure). Null while it runs or waits on a
 * dependency, when only Stop applies.
 */
export function repairAction(
  integration: IntegrationInfo,
  all: IntegrationInfo[]
): IntegrationAction | null {
  const { status } = integration;
  if (integration.oauth) {
    return status === CONNECTED
      ? null
      : {
          kind: 'authorize',
          label: status === NEEDS_REAUTH ? 'Reconnect' : 'Authorize',
          target: integration,
        };
  }
  if (status === NEEDS_REAUTH) {
    const auth = signsInThrough(integration, all);
    if (auth) {
      return { kind: 'authorize', label: `Reconnect ${auth.name}`, target: auth };
    }
  }
  if (!integration.enabled && status !== CONNECTED) {
    return { kind: 'start', label: 'Start', target: integration };
  }
  if (isBroken(status)) {
    return { kind: 'start', label: 'Retry', target: integration };
  }
  return null;
}

/** The dependencies of an integration that aren't connected yet, which it's waiting for. */
export function missingDependencies(
  integration: IntegrationInfo,
  all: IntegrationInfo[]
): string[] {
  return (integration.metadata?.dependencies ?? []).filter(
    (name) => all.find((candidate) => candidate.name === name)?.status !== CONNECTED
  );
}

/** The nearest OAuth integration among an integration's dependencies, direct or not. */
function signsInThrough(
  integration: IntegrationInfo,
  all: IntegrationInfo[]
): IntegrationInfo | null {
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
  return null;
}
