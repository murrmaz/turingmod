import { IntegrationName } from '@turingmod/shared';
import type { ReactNode } from 'react';

/**
 * Everything that differs between OAuth-capable integrations' setup/authorize modals.
 *
 * The redirect URI isn't here: the backend derives it from its port and the loopback host each
 * provider requires (Twitch `localhost`, Spotify and Google `127.0.0.1`) and reports it in the
 * integration's `oauth` info, so `fields` receives it.
 */
export interface OAuthProviderConfig {
  integrationName: IntegrationName;
  displayName: string;
  popupWindowName: string;
  registrationUrl: string;
  registrationLinkText: string;
  createButtonLabel: string;
  saveButtonLabel: string;
  /** What to fill in when registering the app, given the redirect URI to register. */
  fields: (redirectUri: string) => { label: string; value: ReactNode }[];
  finalSteps: { id: string; content: ReactNode }[];
  clientIdHint: string;
  clientSecretHint: string;
}

export const TWITCH_OAUTH_PROVIDER: OAuthProviderConfig = {
  integrationName: IntegrationName.TWITCH_AUTH,
  displayName: 'Twitch',
  popupWindowName: 'TwitchAuth',
  registrationUrl: 'https://dev.twitch.tv/console/apps',
  registrationLinkText: 'dev.twitch.tv/console/apps',
  createButtonLabel: 'Register Your Application',
  saveButtonLabel: 'Create',
  fields: (redirectUri) => [
    { label: 'Name', value: 'TuringMod Local (or any name you prefer)' },
    { label: 'OAuth Redirect URLs', value: <code>{redirectUri}</code> },
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

export const YOUTUBE_OAUTH_PROVIDER: OAuthProviderConfig = {
  integrationName: IntegrationName.YOUTUBE_AUTH,
  displayName: 'YouTube',
  popupWindowName: 'YouTubeAuth',
  registrationUrl: 'https://console.cloud.google.com/apis/credentials',
  registrationLinkText: 'console.cloud.google.com/apis/credentials',
  createButtonLabel: 'Create Credentials',
  saveButtonLabel: 'Create',
  fields: (redirectUri) => [
    { label: 'Application type', value: 'Web application' },
    { label: 'Name', value: 'TuringMod Local (or any name you prefer)' },
    { label: 'Authorized redirect URIs', value: <code>{redirectUri}</code> },
  ],
  finalSteps: [
    {
      id: 'enable-api',
      content: (
        <>
          Enable the <strong>YouTube Data API v3</strong> for your project under{' '}
          <strong>&quot;APIs &amp; Services&quot;</strong>
        </>
      ),
    },
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
          Copy your <strong>Client Secret</strong>
        </>
      ),
    },
  ],
  clientIdHint: 'Copy from your Google Cloud OAuth client',
  clientSecretHint: 'Copy from your Google Cloud OAuth client',
};

export const SPOTIFY_OAUTH_PROVIDER: OAuthProviderConfig = {
  integrationName: IntegrationName.SPOTIFY_AUTH,
  displayName: 'Spotify',
  popupWindowName: 'SpotifyAuth',
  registrationUrl: 'https://developer.spotify.com/dashboard',
  registrationLinkText: 'developer.spotify.com/dashboard',
  createButtonLabel: 'Create App',
  saveButtonLabel: 'Save',
  fields: (redirectUri) => [
    { label: 'App name', value: 'TuringMod Local (or any name you prefer)' },
    { label: 'App description', value: 'Local Twitch bot integration' },
    { label: 'Redirect URI', value: <code>{redirectUri}</code> },
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
