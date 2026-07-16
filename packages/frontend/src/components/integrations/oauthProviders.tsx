import type { ReactNode } from 'react';

/**
 * Everything that differs between OAuth-capable integrations' setup/authorize modals.
 * `redirectUri` in particular is a per-provider requirement, not a shared constant:
 * Twitch only allows loopback redirects to `localhost`, Spotify only to `127.0.0.1`.
 */
export interface OAuthProviderConfig {
  integrationName: string;
  displayName: string;
  popupWindowName: string;
  redirectUri: string;
  registrationUrl: string;
  registrationLinkText: string;
  createButtonLabel: string;
  saveButtonLabel: string;
  fields: { label: string; value: ReactNode }[];
  finalSteps: { id: string; content: ReactNode }[];
  clientIdHint: string;
  clientSecretHint: string;
}

export const TWITCH_OAUTH_PROVIDER: OAuthProviderConfig = {
  integrationName: 'twitch-auth',
  displayName: 'Twitch',
  popupWindowName: 'TwitchAuth',
  redirectUri: 'http://localhost:8080/callback/twitch',
  registrationUrl: 'https://dev.twitch.tv/console/apps',
  registrationLinkText: 'dev.twitch.tv/console/apps',
  createButtonLabel: 'Register Your Application',
  saveButtonLabel: 'Create',
  fields: [
    { label: 'Name', value: 'TuringMod Local (or any name you prefer)' },
    { label: 'OAuth Redirect URLs', value: <code>http://localhost:8080/callback/twitch</code> },
    { label: 'Category', value: 'Application Integration' },
  ],
  finalSteps: [
    {
      id: 'copy-client-id',
      content: (
        <>
          Copy your <strong>Client ID</strong>
        </>
      ),
    },
    {
      id: 'copy-client-secret',
      content: (
        <>
          Click <strong>&quot;New Secret&quot;</strong> and copy the <strong>Client Secret</strong>
        </>
      ),
    },
  ],
  clientIdHint: 'Copy from your Twitch application page',
  clientSecretHint: "Click 'New Secret' on Twitch to generate",
};

export const SPOTIFY_OAUTH_PROVIDER: OAuthProviderConfig = {
  integrationName: 'spotify-auth',
  displayName: 'Spotify',
  popupWindowName: 'SpotifyAuth',
  redirectUri: 'http://127.0.0.1:8080/callback/spotify',
  registrationUrl: 'https://developer.spotify.com/dashboard',
  registrationLinkText: 'developer.spotify.com/dashboard',
  createButtonLabel: 'Create App',
  saveButtonLabel: 'Save',
  fields: [
    { label: 'App name', value: 'TuringMod Local (or any name you prefer)' },
    { label: 'App description', value: 'Local Twitch bot integration' },
    { label: 'Redirect URI', value: <code>http://127.0.0.1:8080/callback/spotify</code> },
    { label: 'Which API/SDKs are you planning to use?', value: 'Web API' },
  ],
  finalSteps: [
    {
      id: 'copy-client-id',
      content: (
        <>
          Go to <strong>&quot;Settings&quot;</strong> and copy your <strong>Client ID</strong>
        </>
      ),
    },
    {
      id: 'copy-client-secret',
      content: (
        <>
          Click <strong>&quot;View client secret&quot;</strong> and copy the{' '}
          <strong>Client Secret</strong>
        </>
      ),
    },
  ],
  clientIdHint: 'Copy from your Spotify application settings',
  clientSecretHint: "Click 'View client secret' on Spotify to reveal",
};
