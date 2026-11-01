import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type IntegrationInfo, IntegrationName } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { oauthIntegration } from '@/testing/integrations';
import { renderConsole } from '@/testing/render-console';
import { SPOTIFY_OAUTH_PROVIDER, TWITCH_OAUTH_PROVIDER } from './oauth-providers';
import { SetupModal } from './setup-modal';

const twitch = IntegrationName.TWITCH_AUTH;

function setup(provider = TWITCH_OAUTH_PROVIDER) {
  const watch = new FakeSubscription<IntegrationInfo[]>();
  const configure = vi.fn(
    async (_input: { integrationName: string; config: Record<string, unknown> }) => []
  );
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  renderConsole(<SetupModal provider={provider} onDismiss={onDismiss} onSaved={onSaved} />, {
    procedures: { integrations: { watch, configure: { mutate: configure } } },
  });
  return { user: userEvent.setup(), watch, configure, onSaved };
}

const save = () => screen.getByRole('button', { name: 'Save & continue' });

describe('SetupModal', () => {
  it("shows the redirect URI the backend reports, once it's connected", () => {
    const { watch } = setup();
    expect(screen.getByText('unavailable until the backend is connected')).toBeInTheDocument();

    watch.emit([oauthIntegration(twitch)]);

    expect(screen.getByText('http://localhost:8080/callback/twitch')).toBeInTheDocument();
  });

  it("gives the instructions for the provider it's for", () => {
    setup(SPOTIFY_OAUTH_PROVIDER);

    expect(screen.getByRole('dialog', { name: 'Spotify application setup' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /developer\.spotify\.com/ })).toHaveAttribute(
      'href',
      'https://developer.spotify.com/dashboard'
    );
  });

  it('keeps Save disabled until both credentials are entered', async () => {
    const { user } = setup();
    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText('Client ID'), 'id');
    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText('Client Secret'), '   ');
    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText('Client Secret'), 'secret');
    expect(save()).toBeEnabled();
  });

  it('saves the credentials trimmed, as pasted ones often need', async () => {
    const { user, configure, onSaved } = setup();

    await user.type(screen.getByLabelText('Client ID'), ' id ');
    await user.type(screen.getByLabelText('Client Secret'), ' secret ');
    await user.click(save());

    expect(configure).toHaveBeenCalledWith({
      integrationName: twitch,
      config: { clientId: 'id', clientSecret: 'secret' },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('warns that saving replaces credentials only when there are some', () => {
    const { watch } = setup();
    const warning = /Saving replaces the credentials/;

    watch.emit([oauthIntegration(twitch, {}, false)]);
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    watch.emit([oauthIntegration(twitch, {}, true)]);
    expect(screen.getByText(warning)).toBeInTheDocument();
  });
});
