import { IntegrationName } from '@turingmod/shared';
import {
  type OAuthProviderConfig,
  SPOTIFY_OAUTH_PROVIDER,
  TWITCH_OAUTH_PROVIDER,
  YOUTUBE_OAUTH_PROVIDER,
} from './oauth-providers';

/**
 * Maps an OAuth-capable integration's name to the provider config its SetupModal/OAuthModal
 * pair is rendered with. The backend derives `IntegrationInfo.oauth` from data (see
 * IIntegration/IOAuthIntegration); this registry is the frontend's equivalent lookup so no UI
 * code branches on integration name.
 */
export const OAUTH_INTEGRATION_REGISTRY: Record<string, OAuthProviderConfig> = {
  [IntegrationName.TWITCH_AUTH]: TWITCH_OAUTH_PROVIDER,
  [IntegrationName.SPOTIFY_AUTH]: SPOTIFY_OAUTH_PROVIDER,
  [IntegrationName.YOUTUBE_AUTH]: YOUTUBE_OAUTH_PROVIDER,
} satisfies Partial<Record<IntegrationName, OAuthProviderConfig>>;
