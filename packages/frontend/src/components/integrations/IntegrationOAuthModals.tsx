import { OAUTH_INTEGRATION_REGISTRY } from './oauthIntegrationRegistry';

export interface IntegrationOAuthModalsProps {
  /** Name of the OAuth-capable integration currently being set up/authorized, or null if none. */
  activeIntegration: string | null;
  oauthModalVisible: boolean;
  setupModalVisible: boolean;
  onOAuthDismiss: () => void;
  onSetupDismiss: () => void;
  /** SetupModal saved credentials — hand off to the authorize flow. */
  onSetupSuccess: () => void;
  /** OAuthModal completed the authorization code exchange. */
  onOAuthSuccess: () => void;
  /** OAuthModal discovered credentials aren't configured yet — hand off to setup. */
  onNeedsSetup: () => void;
}

/**
 * Wires up the SetupModal/OAuthModal pair for whichever OAuth-capable
 * integration is currently active, looked up from OAUTH_INTEGRATION_REGISTRY.
 * Shared by every view that lets a user start an integration (dashboard table,
 * integrations card grid, ...) so the setup <-> authorize handoff is defined once.
 */
export function IntegrationOAuthModals({
  activeIntegration,
  oauthModalVisible,
  setupModalVisible,
  onOAuthDismiss,
  onSetupDismiss,
  onSetupSuccess,
  onOAuthSuccess,
  onNeedsSetup,
}: IntegrationOAuthModalsProps) {
  if (!activeIntegration) {
    return null;
  }

  const entry = OAUTH_INTEGRATION_REGISTRY[activeIntegration];
  if (!entry) {
    return null;
  }

  const { oauthModal: OAuthModal, setupModal: SetupModal } = entry;

  return (
    <>
      <SetupModal
        visible={setupModalVisible}
        onDismiss={onSetupDismiss}
        onSuccess={onSetupSuccess}
      />

      <OAuthModal
        visible={oauthModalVisible}
        onDismiss={onOAuthDismiss}
        onSuccess={onOAuthSuccess}
        onNeedsSetup={onNeedsSetup}
      />
    </>
  );
}
