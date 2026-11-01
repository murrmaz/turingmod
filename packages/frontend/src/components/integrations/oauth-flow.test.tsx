import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type IntegrationInfo, IntegrationName } from '@turingmod/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOAuthFlow } from '@/context/oauthFlowContext';
import type { RouterOutputs } from '@/context/trpc-context';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { integration, oauthIntegration } from '@/testing/integrations';
import { renderConsole } from '@/testing/render-console';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

type Result = RouterOutputs['oauth']['results'] extends AsyncIterable<infer R> ? R : never;

const twitch = IntegrationName.TWITCH_AUTH;

function Buttons({ target }: { target: IntegrationInfo }) {
  const flow = useOAuthFlow();
  return (
    <>
      <button type="button" onClick={() => flow.authorize(target)}>
        Start authorizing
      </button>
      <button type="button" onClick={() => flow.changeCredentials(target)}>
        Start changing credentials
      </button>
    </>
  );
}

function setup(target: IntegrationInfo) {
  vi.spyOn(window, 'open').mockReturnValue({ closed: false, close: () => {} } as unknown as Window);
  const results = new FakeSubscription<Result>();
  const configure = vi.fn(
    async (_input: { integrationName: string; config: Record<string, unknown> }) => [target]
  );
  renderConsole(<Buttons target={target} />, {
    procedures: {
      integrations: { configure: { mutate: configure } },
      oauth: { authorizationUrl: { mutate: async () => 'https://example.test/auth' }, results },
    },
  });
  return { user: userEvent.setup(), results, configure };
}

const start = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Start authorizing' }));

describe('OAuthFlowProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('goes straight to signing in when the credentials are saved', async () => {
    const { user } = setup(oauthIntegration(twitch));

    await start(user);

    expect(await screen.findByRole('dialog', { name: 'Authorize Twitch' })).toBeInTheDocument();
  });

  it('asks for the credentials first when there are none, then signs in with them', async () => {
    const { user, configure } = setup(oauthIntegration(twitch, {}, false));

    await start(user);
    expect(screen.getByRole('dialog', { name: 'Twitch application setup' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Client ID'), 'id');
    await user.type(screen.getByLabelText('Client Secret'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Save & continue' }));

    expect(await screen.findByRole('dialog', { name: 'Authorize Twitch' })).toBeInTheDocument();
    expect(configure).toHaveBeenCalledTimes(1);
  });

  it('closes once the sign-in succeeds', async () => {
    const { user, results } = setup(oauthIntegration(twitch));
    await start(user);
    await screen.findByText('Waiting for authorization');

    results.emit({ integrationName: twitch, success: true });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes back to the credentials from a failed sign-in', async () => {
    const { user, results } = setup(oauthIntegration(twitch));
    await start(user);
    await screen.findByText('Waiting for authorization');
    results.emit({ integrationName: twitch, success: false, errorMessage: 'Invalid client' });

    await user.click(screen.getByRole('button', { name: 'Change credentials' }));

    expect(screen.getByRole('dialog', { name: 'Twitch application setup' })).toBeInTheDocument();
  });

  it('opens the credentials directly when asked to change them', async () => {
    const { user } = setup(oauthIntegration(twitch));

    await user.click(screen.getByRole('button', { name: 'Start changing credentials' }));

    expect(screen.getByRole('dialog', { name: 'Twitch application setup' })).toBeInTheDocument();
  });

  it('closes on Cancel', async () => {
    const { user } = setup(oauthIntegration(twitch));
    await start(user);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reports an integration with no sign-in flow rather than doing nothing', async () => {
    const { user } = setup(integration(IntegrationName.OBS));

    await start(user);

    expect(toast.error).toHaveBeenCalledWith(
      `Can't authorize ${IntegrationName.OBS}`,
      expect.anything()
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
