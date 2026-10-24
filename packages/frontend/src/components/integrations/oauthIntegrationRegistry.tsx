import {
  type OAuthProviderConfig,
  SPOTIFY_OAUTH_PROVIDER,
  TWITCH_OAUTH_PROVIDER,
  YOUTUBE_OAUTH_PROVIDER,
} from './oauthProviders';

/**
 * Maps an OAuth-capable integration's name to the provider config its SetupModal/OAuthModal
 * pair is rendered with. The backend derives `IntegrationInfo.oauth` from data (see
 * IIntegration/IOAuthIntegration); this registry is the frontend's equivalent lookup so no UI
 * code branches on integration name.
 */
export const OAUTH_INTEGRATION_REGISTRY: Record<string, OAuthProviderConfig> = {
  'twitch-auth': TWITCH_OAUTH_PROVIDER,
  'spotify-auth': SPOTIFY_OAUTH_PROVIDER,
  'youtube-auth': YOUTUBE_OAUTH_PROVIDER,
};
