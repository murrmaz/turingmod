import type { IntegrationInfo } from '@turingmod/shared';
import { createContext, useContext } from 'react';

/**
 * Starting the console's OAuth dialogs from anywhere. OAuthFlowProvider
 * (`components/integrations/oauth-flow.tsx`) provides it and renders the dialogs.
 */
export interface OAuthFlow {
  /**
   * Authorize an OAuth integration. Without client credentials there's nothing to sign in with
   * yet, so it starts at setup, which hands off to signing in once they're saved.
   */
  authorize: (integration: IntegrationInfo) => void;
  /**
   * Replace an OAuth integration's saved client credentials, e.g. ones the provider rejects, then
   * authorize with the new ones.
   */
  changeCredentials: (integration: IntegrationInfo) => void;
}

export const OAuthFlowContext = createContext<OAuthFlow | null>(null);

/** The console's OAuth dialogs; see OAuthFlow. */
export function useOAuthFlow(): OAuthFlow {
  const context = useContext(OAuthFlowContext);
  if (!context) {
    throw new Error('useOAuthFlow must be used within OAuthFlowProvider');
  }
  return context;
}
