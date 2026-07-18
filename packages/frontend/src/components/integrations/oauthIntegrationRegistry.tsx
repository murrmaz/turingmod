import type { ComponentType } from 'react';
import { OAuthModal, type OAuthModalProps } from './OAuthModal';
import {
  SPOTIFY_OAUTH_PROVIDER,
  TWITCH_OAUTH_PROVIDER,
  YOUTUBE_OAUTH_PROVIDER,
} from './oauthProviders';
import { SetupModal, type SetupModalProps } from './SetupModal';

type OAuthModalRuntimeProps = Omit<OAuthModalProps, 'provider'>;
type SetupModalRuntimeProps = Omit<SetupModalProps, 'provider'>;

export interface OAuthIntegrationEntry {
  oauthModal: ComponentType<OAuthModalRuntimeProps>;
  setupModal: ComponentType<SetupModalRuntimeProps>;
}

function bindOAuthModal(
  provider: OAuthModalProps['provider']
): ComponentType<OAuthModalRuntimeProps> {
  return function BoundOAuthModal(props: OAuthModalRuntimeProps) {
    return <OAuthModal {...props} provider={provider} />;
  };
}

function bindSetupModal(
  provider: SetupModalProps['provider']
): ComponentType<SetupModalRuntimeProps> {
  return function BoundSetupModal(props: SetupModalRuntimeProps) {
    return <SetupModal {...props} provider={provider} />;
  };
}

/**
 * Maps an OAuth-capable integration's name to the modal pair used to authorize it.
 * The backend derives `IntegrationInfo.oauth` from data (see IIntegration/IOAuthIntegration);
 * this registry is the frontend's equivalent lookup so no UI code branches on integration name.
 */
export const OAUTH_INTEGRATION_REGISTRY: Record<string, OAuthIntegrationEntry> = {
  'twitch-auth': {
    oauthModal: bindOAuthModal(TWITCH_OAUTH_PROVIDER),
    setupModal: bindSetupModal(TWITCH_OAUTH_PROVIDER),
  },
  'spotify-auth': {
    oauthModal: bindOAuthModal(SPOTIFY_OAUTH_PROVIDER),
    setupModal: bindSetupModal(SPOTIFY_OAUTH_PROVIDER),
  },
  'youtube-auth': {
    oauthModal: bindOAuthModal(YOUTUBE_OAUTH_PROVIDER),
    setupModal: bindSetupModal(YOUTUBE_OAUTH_PROVIDER),
  },
};
