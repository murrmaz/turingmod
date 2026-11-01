import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntegrationName } from '@turingmod/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouterOutputs } from '@/context/trpc-context';
import { deferred, FakeSubscription } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';
import { OAuthModal } from './oauth-modal';
import { TWITCH_OAUTH_PROVIDER } from './oauth-providers';

type Result = RouterOutputs['oauth']['results'] extends AsyncIterable<infer R> ? R : never;

const URL = 'https://id.twitch.tv/oauth2/authorize';
const twitch = IntegrationName.TWITCH_AUTH;

function fakePopup() {
  const popup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };
  return popup;
}

function setup(answer: () => Promise<string> = async () => URL) {
  const popup = fakePopup();
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  const results = new FakeSubscription<Result>();
  const subscribe = vi.spyOn(results, 'subscribe');
  const authorizationUrl = vi.fn((_input: { integrationName: string }) => answer());
  const callbacks = {
    onDismiss: vi.fn(),
    onSuccess: vi.fn(),
    onChangeCredentials: vi.fn(),
  };
  const view = renderConsole(<OAuthModal provider={TWITCH_OAUTH_PROVIDER} {...callbacks} />, {
    procedures: { oauth: { authorizationUrl: { mutate: authorizationUrl }, results } },
  });
  return {
    user: userEvent.setup(),
    popup,
    open,
    results,
    subscribe,
    authorizationUrl,
    ...callbacks,
    ...view,
  };
}

/** The dialog once its popup is open, waiting for the sign-in's result. */
async function waiting(answer?: () => Promise<string>) {
  const view = setup(answer);
  await screen.findByText('Waiting for authorization');
  return view;
}

describe('OAuthModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for the integration's URL and opens it in a popup", async () => {
    const { open, authorizationUrl } = await waiting();

    expect(authorizationUrl).toHaveBeenCalledWith({ integrationName: twitch });
    expect(open).toHaveBeenCalledWith(URL, 'TwitchAuth', expect.any(String));
  });

  it('subscribes to results before asking for the URL, so a result cannot come first', async () => {
    const { subscribe, authorizationUrl } = await waiting();

    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      authorizationUrl.mock.invocationCallOrder[0] as number
    );
  });

  it('closes the popup and reports success when the sign-in succeeds', async () => {
    const { results, popup, onSuccess } = await waiting();

    results.emit({ integrationName: twitch, success: true });

    expect(popup.close).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("ignores another integration's result, which every console hears", async () => {
    const { results, popup, onSuccess } = await waiting();

    results.emit({ integrationName: IntegrationName.SPOTIFY_AUTH, success: true });
    results.emit({ integrationName: IntegrationName.SPOTIFY_AUTH, success: false });

    expect(popup.close).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Waiting for authorization')).toBeInTheDocument();
  });

  it('closes the popup and says why when the sign-in fails', async () => {
    const { results, popup, onSuccess } = await waiting();

    results.emit({ integrationName: twitch, success: false, errorMessage: 'Invalid client' });

    expect(popup.close).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid client')).toBeInTheDocument();
  });

  it('still says it failed when the result gives no reason', async () => {
    const { results } = await waiting();

    results.emit({ integrationName: twitch, success: false });

    expect(screen.getByText('Authorization failed', { selector: 'p' })).toBeInTheDocument();
  });

  it('starts a new attempt on Try again', async () => {
    const { results, user, authorizationUrl, open } = await waiting();
    results.emit({ integrationName: twitch, success: false, errorMessage: 'Invalid client' });

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Waiting for authorization')).toBeInTheDocument();
    expect(screen.queryByText('Invalid client')).not.toBeInTheDocument();
    expect(authorizationUrl).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('goes back to the credentials on Change credentials', async () => {
    const { results, user, onChangeCredentials } = await waiting();
    results.emit({ integrationName: twitch, success: false, errorMessage: 'Invalid client' });

    await user.click(screen.getByRole('button', { name: 'Change credentials' }));

    expect(onChangeCredentials).toHaveBeenCalledTimes(1);
  });

  it('offers a retry only once something has failed', async () => {
    await waiting();

    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change credentials' })).not.toBeInTheDocument();
  });

  it('says the popup was blocked when the browser blocks it', async () => {
    const { open } = setup();
    open.mockReturnValue(null);

    expect(await screen.findByText(/Popup was blocked/)).toBeInTheDocument();
  });

  it('says why when the URL could not be had', async () => {
    setup(() => Promise.reject(new Error('Client credentials rejected')));

    expect(await screen.findByText('Client credentials rejected')).toBeInTheDocument();
  });

  it('fails rather than opening a popup on an empty URL', async () => {
    const { open } = setup(async () => '');

    expect(await screen.findByText('Failed to get authorization URL')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it('says so when the subscription to results fails', async () => {
    const { results } = await waiting();

    results.fail(new Error('Subscription lost'));

    expect(screen.getByText('Subscription lost')).toBeInTheDocument();
  });

  it('says the sign-in was cancelled when the streamer closes the popup', async () => {
    const { popup } = await waiting();

    popup.closed = true;

    expect(await screen.findByText('Authorization cancelled')).toBeInTheDocument();
  });

  it("doesn't call a finished sign-in cancelled when its page closes the popup", async () => {
    const { results, popup, onSuccess } = await waiting();

    results.emit({ integrationName: twitch, success: true });
    popup.closed = true;
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(screen.queryByText('Authorization cancelled')).not.toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Cancel', async () => {
    const { user, onDismiss } = await waiting();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes the popup with the dialog', async () => {
    const { popup, unmount } = await waiting();

    unmount();

    expect(popup.close).toHaveBeenCalled();
  });

  it('opens no popup for a URL that arrives after the dialog closed', async () => {
    const url = deferred<string>();
    const { open, unmount, authorizationUrl } = setup(() => url.promise);
    await waitFor(() => expect(authorizationUrl).toHaveBeenCalled());

    unmount();
    url.resolve(URL);
    await url.promise;

    expect(open).not.toHaveBeenCalled();
  });
});
