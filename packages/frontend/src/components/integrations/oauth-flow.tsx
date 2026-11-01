import type { IntegrationInfo } from '@turingmod/shared';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { OAuthFlowContext } from '@/context/oauthFlowContext';
import { reportActionError } from '@/lib/reportError';
import { OAUTH_INTEGRATION_REGISTRY } from './oauth-integration-registry';
import { OAuthModal } from './oauth-modal';
import type { OAuthProviderConfig } from './oauth-providers';
import { SetupModal } from './setup-modal';

/** Where an authorization stands: entering the app's credentials first, or signing in. */
interface Flow {
  step: 'setup' | 'authorize';
  provider: OAuthProviderConfig;
}

/** The OAuth setup and sign-in dialogs, which anything can start through useOAuthFlow(). */
export function OAuthFlowProvider({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState<Flow | null>(null);

  const authorize = useCallback((integration: IntegrationInfo) => {
    const provider = providerFor(integration);
    if (provider) {
      setFlow({ step: integration.oauth?.configured ? 'authorize' : 'setup', provider });
    }
  }, []);
  const changeCredentials = useCallback((integration: IntegrationInfo) => {
    const provider = providerFor(integration);
    if (provider) {
      setFlow({ step: 'setup', provider });
    }
  }, []);

  const close = useCallback(() => setFlow(null), []);
  const credentialsSaved = useCallback(() => {
    setFlow((current) => current && { ...current, step: 'authorize' });
  }, []);
  const editCredentials = useCallback(() => {
    setFlow((current) => current && { ...current, step: 'setup' });
  }, []);
  const authorized = useCallback(() => setFlow(null), []);

  const value = useMemo(() => ({ authorize, changeCredentials }), [authorize, changeCredentials]);

  return (
    <OAuthFlowContext.Provider value={value}>
      {children}
      {flow?.step === 'setup' && (
        <SetupModal provider={flow.provider} onDismiss={close} onSaved={credentialsSaved} />
      )}
      {flow?.step === 'authorize' && (
        <OAuthModal
          key={flow.provider.integrationName}
          provider={flow.provider}
          onDismiss={close}
          onSuccess={authorized}
          onChangeCredentials={editCredentials}
        />
      )}
    </OAuthFlowContext.Provider>
  );
}

/** The console's sign-in flow for an integration; reported as an error if it has none. */
function providerFor(integration: IntegrationInfo): OAuthProviderConfig | undefined {
  const provider = OAUTH_INTEGRATION_REGISTRY[integration.name];
  if (!provider) {
    reportActionError(
      `Can't authorize ${integration.name}`,
      new Error('The console has no sign-in flow for it')
    );
  }
  return provider;
}
