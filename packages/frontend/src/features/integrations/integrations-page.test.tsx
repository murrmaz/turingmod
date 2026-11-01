import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type IntegrationInfo,
  IntegrationName,
  IntegrationStatus,
  OBS_DEFAULT_URL,
} from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, FakeSubscription } from '@/testing/fakeTrpc';
import { apiIntegration, integration, oauthIntegration } from '@/testing/integrations';
import { renderConsole } from '@/testing/renderConsole';
import { IntegrationsPage } from './integrations-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { TWITCH_AUTH, TWITCH_API, OBS, SOUND } = IntegrationName;
const { CONNECTED, ERROR, NEEDS_REAUTH, BLOCKED } = IntegrationStatus;

type Answer = Promise<IntegrationInfo[]>;

/** The Integrations page with `selected` open in its detail panel. */
function setup(integrations: IntegrationInfo[], selected: IntegrationName) {
  const watch = new FakeSubscription<IntegrationInfo[]>();
  const start = vi.fn((_input: { integrationName: string }): Answer => Promise.resolve([]));
  const stop = vi.fn((_input: { integrationName: string }): Answer => Promise.resolve([]));
  const configure = vi.fn(
    (_input: { integrationName: string; config: unknown }): Answer => Promise.resolve(integrations)
  );
  // Never answers, so the sign-in dialog stays open waiting for its URL, opening no popup.
  const authorizationUrl = vi.fn((_input: { integrationName: string }) => new Promise(() => {}));
  renderConsole(<IntegrationsPage />, {
    route: `/integrations?selected=${selected}`,
    procedures: {
      integrations: {
        watch,
        start: { mutate: start },
        stop: { mutate: stop },
        configure: { mutate: configure },
      },
      oauth: { authorizationUrl: { mutate: authorizationUrl }, results: new FakeSubscription() },
    },
  });
  watch.emit(integrations);
  return { user: userEvent.setup(), watch, start, stop, configure, authorizationUrl };
}

const ACTIONS = ['Authorize', 'Reconnect', 'Start', 'Retry', 'Stop', 'Set up'];

/** The detail panel's action buttons, in order. */
function actions(): string[] {
  return within(screen.getByRole('complementary'))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((name) => ACTIONS.includes(name));
}

function action(name: string): HTMLElement {
  return within(screen.getByRole('complementary')).getByRole('button', { name });
}

describe('Integrations page actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each<[string, IntegrationInfo[], IntegrationName, string[]]>([
    [
      'an OAuth integration not yet signed in is authorized, not started',
      [oauthIntegration(TWITCH_AUTH)],
      TWITCH_AUTH,
      ['Authorize'],
    ],
    [
      'an OAuth integration that lost its grant is reconnected, or stopped',
      [oauthIntegration(TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true })],
      TWITCH_AUTH,
      ['Reconnect', 'Stop'],
    ],
    [
      'a signed-in OAuth integration can only be stopped',
      [oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true })],
      TWITCH_AUTH,
      ['Stop'],
    ],
    ['a stopped integration is started', [integration(SOUND)], SOUND, ['Start']],
    [
      'a running integration is stopped',
      [integration(SOUND, { status: CONNECTED, enabled: true })],
      SOUND,
      ['Stop'],
    ],
    [
      'a failed integration is retried, or stopped',
      [integration(SOUND, { status: ERROR, enabled: true })],
      SOUND,
      ['Retry', 'Stop'],
    ],
    [
      'an integration waiting on a dependency can be stopped, though it never connected',
      [
        oauthIntegration(TWITCH_AUTH),
        apiIntegration(TWITCH_API, TWITCH_AUTH, { status: BLOCKED, enabled: true }),
      ],
      TWITCH_API,
      ['Stop'],
    ],
    [
      'an integration with a setup dialog offers Set up beside its other actions',
      [integration(OBS)],
      OBS,
      ['Start', 'Set up'],
    ],
  ])('%s', (_name, integrations, selected, expected) => {
    setup(integrations, selected);

    expect(actions()).toEqual(expected);
  });

  it('says what a blocked integration is waiting for', () => {
    setup(
      [
        oauthIntegration(TWITCH_AUTH),
        apiIntegration(TWITCH_API, TWITCH_AUTH, { status: BLOCKED, enabled: true }),
      ],
      TWITCH_API
    );

    expect(screen.getByText('Runs once twitch-auth connects.')).toBeInTheDocument();
  });

  it('shows why a failed integration failed', () => {
    setup([integration(SOUND, { status: ERROR, enabled: true, errorMessage: 'No player' })], SOUND);

    expect(screen.getByRole('alert')).toHaveTextContent('No player');
  });

  it('starts an integration, holding the buttons until the state it answers with shows', async () => {
    const { user, start } = setup([integration(SOUND)], SOUND);
    const answer = deferred<IntegrationInfo[]>();
    start.mockReturnValueOnce(answer.promise);

    await user.click(action('Start'));

    expect(start).toHaveBeenCalledWith({ integrationName: SOUND });
    expect(action('Start')).toBeDisabled();

    answer.resolve([integration(SOUND, { status: CONNECTED, enabled: true })]);

    expect(await within(screen.getByRole('complementary')).findByText('Stop')).toBeEnabled();
    expect(actions()).toEqual(['Stop']);
  });

  it('stops an integration', async () => {
    const { user, stop } = setup([integration(SOUND, { status: CONNECTED, enabled: true })], SOUND);

    await user.click(action('Stop'));

    expect(stop).toHaveBeenCalledWith({ integrationName: SOUND });
  });

  it('reports a failed start and lets it be tried again', async () => {
    const { user, start } = setup([integration(SOUND)], SOUND);
    start.mockRejectedValueOnce(new Error('No audio player found'));

    await user.click(action('Start'));

    expect(toast.error).toHaveBeenCalledWith("Couldn't start sound", {
      description: 'No audio player found',
    });
    expect(action('Start')).toBeEnabled();
  });

  it('reconnects an API integration that lost its grant through its sign-in, as the dashboard does', async () => {
    const { user, authorizationUrl } = setup(
      [
        oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true }),
        apiIntegration(TWITCH_API, TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true }),
      ],
      TWITCH_API
    );

    await user.click(action('Reconnect twitch-auth'));

    expect(screen.getByRole('dialog', { name: 'Authorize Twitch' })).toBeInTheDocument();
    expect(authorizationUrl).toHaveBeenCalledWith({ integrationName: TWITCH_AUTH });
  });

  it('authorizes in the sign-in dialog once the client credentials are saved', async () => {
    const { user, authorizationUrl } = setup([oauthIntegration(TWITCH_AUTH)], TWITCH_AUTH);

    await user.click(action('Authorize'));

    expect(screen.getByRole('dialog', { name: 'Authorize Twitch' })).toBeInTheDocument();
    expect(authorizationUrl).toHaveBeenCalledWith({ integrationName: TWITCH_AUTH });
  });

  it('asks for the client credentials first when there are none', async () => {
    const { user, authorizationUrl } = setup(
      [oauthIntegration(TWITCH_AUTH, {}, false)],
      TWITCH_AUTH
    );

    await user.click(action('Authorize'));

    expect(screen.getByRole('dialog', { name: 'Twitch application setup' })).toBeInTheDocument();
    expect(authorizationUrl).not.toHaveBeenCalled();
  });

  it('starts a stopped integration once its setup is saved', async () => {
    const { user, configure, start } = setup([integration(OBS)], OBS);

    await user.click(action('Set up'));
    const dialog = screen.getByRole('dialog', { name: 'OBS setup' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(configure).toHaveBeenCalledWith({
      integrationName: OBS,
      config: { url: OBS_DEFAULT_URL },
    });
    expect(start).toHaveBeenCalledWith({ integrationName: OBS });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("doesn't start a running integration after its setup is saved: it restarts by itself", async () => {
    const { user, configure, start } = setup(
      [integration(OBS, { status: CONNECTED, enabled: true })],
      OBS
    );

    await user.click(action('Set up'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(configure).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
