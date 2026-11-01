import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type IntegrationInfo, IntegrationName, IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { apiIntegration, integration, oauthIntegration } from '@/testing/integrations';
import { renderConsole } from '@/testing/render-console';
import { HealthRail } from './health-rail';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { TWITCH_AUTH, TWITCH_API, OBS, SOUND } = IntegrationName;
const { CONNECTED, ERROR, NEEDS_REAUTH } = IntegrationStatus;

function setup(integrations: IntegrationInfo[]) {
  const watch = new FakeSubscription<IntegrationInfo[]>();
  const start = vi.fn((_input: { integrationName: string }) => Promise.resolve(integrations));
  const authorizationUrl = vi.fn((_input: { integrationName: string }) => new Promise(() => {}));
  renderConsole(<HealthRail />, {
    procedures: {
      integrations: { watch, start: { mutate: start } },
      oauth: { authorizationUrl: { mutate: authorizationUrl }, results: new FakeSubscription() },
    },
  });
  watch.emit(integrations);
  return { user: userEvent.setup(), start, authorizationUrl };
}

describe('HealthRail', () => {
  it('stays quiet while everything is healthy', () => {
    setup([
      oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true }),
      integration(SOUND),
    ]);

    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.getByText('1 up')).toBeInTheDocument();
  });

  it('reconnects an API integration that lost its grant by authorizing its sign-in again', async () => {
    const { user, authorizationUrl } = setup([
      oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true }),
      apiIntegration(TWITCH_API, TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Reconnect twitch-auth' }));

    expect(screen.getByRole('dialog', { name: 'Authorize Twitch' })).toBeInTheDocument();
    expect(authorizationUrl).toHaveBeenCalledWith({ integrationName: TWITCH_AUTH });
  });

  it('reconnects an OAuth integration that lost its grant by authorizing it', async () => {
    const { user, authorizationUrl } = setup([
      oauthIntegration(TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(authorizationUrl).toHaveBeenCalledWith({ integrationName: TWITCH_AUTH });
  });

  it('retries a failed integration without OAuth by starting it', async () => {
    const { user, start, authorizationUrl } = setup([
      integration(OBS, { status: ERROR, enabled: true, errorMessage: 'Wrong password' }),
    ]);

    expect(screen.getByText(/Wrong password/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(start).toHaveBeenCalledWith({ integrationName: OBS });
    expect(authorizationUrl).not.toHaveBeenCalled();
  });
});
