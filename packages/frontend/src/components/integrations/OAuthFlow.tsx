import type { IntegrationInfo } from '@turingmod/shared';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useAppState } from '@/context/AppStateContext';
import { reportActionError } from '@/lib/reportError';
import { OAuthModal } from './OAuthModal';
import { OAUTH_INTEGRATION_REGISTRY } from './oauthIntegrationRegistry';
import type { OAuthProviderConfig } from './oauthProviders';
import { SetupModal } from './SetupModal';

/** Where an authorization stands: entering the app's credentials first, or signing in. */
interface Flow {
  step: 'setup' | 'authorize';
  provider: OAuthProviderConfig;
}

interface OAuthFlowContextValue {
  /**
   * Authorize an OAuth integration. Without client credentials there's nothing to sign in with
   * yet, so it starts at setup, which hands off to signing in once they're saved.
   */
  authorize: (integration: IntegrationInfo) => void;
}

const OAuthFlowContext = createContext<OAuthFlowContextValue | null>(null);

export function useOAuthFlow(): OAuthFlowContextValue {
  const context = useContext(OAuthFlowContext);
  if (!context) {
    throw new Error('useOAuthFlow must be used within OAuthFlowProvider');
  }
  return context;
}

/** The OAuth setup and sign-in dialogs, which any page can start through useOAuthFlow(). */
export function OAuthFlowProvider({ children }: { children: ReactNode }) {
  const { refreshIntegrations } = useAppState();
  const [flow, setFlow] = useState<Flow | null>(null);

  const authorize = useCallback((integration: IntegrationInfo) => {
    const provider = OAUTH_INTEGRATION_REGISTRY[integration.name];
    if (!provider) {
      reportActionError(
        `Can't authorize ${integration.name}`,
        new Error('The console has no sign-in flow for it')
      );
      return;
    }
    setFlow({ step: integration.oauth?.configured ? 'authorize' : 'setup', provider });
  }, []);

  const close = useCallback(() => setFlow(null), []);
  // Refreshed so the integration reports itself configured, then connected.
  const credentialsSaved = useCallback(() => {
    setFlow((current) => current && { ...current, step: 'authorize' });
    void refreshIntegrations();
  }, [refreshIntegrations]);
  const authorized = useCallback(() => {
    setFlow(null);
    void refreshIntegrations();
  }, [refreshIntegrations]);

  const value = useMemo(() => ({ authorize }), [authorize]);

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
        />
      )}
    </OAuthFlowContext.Provider>
  );
}
