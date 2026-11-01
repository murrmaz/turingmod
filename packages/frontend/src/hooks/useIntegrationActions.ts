import type { IntegrationInfo } from '@turingmod/shared';
import { useCallback, useState } from 'react';
import { useOAuthFlow } from '@/context/oauthFlowContext';
import type { IntegrationAction } from '@/lib/integrationActions';
import { reportActionError } from '@/lib/reportError';
import { useIntegrations } from './useIntegrations';

/**
 * Carries out the actions `integrationActions()` offers, for the Integrations page and the
 * dashboard's Needs attention cards: authorizing opens the app-wide OAuth dialogs
 * (OAuthFlowProvider); starting and stopping report a failure, and mark the integration busy
 * until the state they left is showing.
 */
export function useIntegrationActions() {
  const { startIntegration, stopIntegration } = useIntegrations();
  const { authorize, changeCredentials } = useOAuthFlow();
  const [busyNames, setBusyNames] = useState<ReadonlySet<string>>(new Set());

  const send = useCallback(
    async (name: string, verb: string, request: (name: string) => Promise<void>) => {
      setBusyNames((names) => new Set(names).add(name));
      try {
        await request(name);
      } catch (error) {
        reportActionError(`Couldn't ${verb} ${name}`, error);
      } finally {
        setBusyNames((names) => new Set([...names].filter((other) => other !== name)));
      }
    },
    []
  );

  const start = useCallback(
    (integration: IntegrationInfo) => void send(integration.name, 'start', startIntegration),
    [send, startIntegration]
  );

  const run = useCallback(
    (action: IntegrationAction) => {
      switch (action.kind) {
        case 'authorize':
          authorize(action.target);
          return;
        case 'start':
          start(action.target);
          return;
        case 'stop':
          void send(action.target.name, 'stop', stopIntegration);
          return;
      }
    },
    [authorize, start, send, stopIntegration]
  );

  /** Whether a start or stop of this integration is still waiting for its answer. */
  const isBusy = useCallback(
    (integration: IntegrationInfo) => busyNames.has(integration.name),
    [busyNames]
  );

  return { run, start, isBusy, changeCredentials };
}
