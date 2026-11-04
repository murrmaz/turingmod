import { type IntegrationInfo, IntegrationName, IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import {
  apiIntegration,
  integration,
  oauthIntegration,
  signedInIntegration,
} from '@/testing/integrations';
import { integrationActions, missingDependencies, repairAction } from './integrationActions';

const { TWITCH_AUTH, TWITCH_API, TWITCH_EVENTSUB, SOUND } = IntegrationName;
const { CONNECTED, CONNECTING, ERROR, NEEDS_REAUTH, BLOCKED } = IntegrationStatus;

/** Each action as `label → what it acts on`. */
function offered(subject: IntegrationInfo, all: IntegrationInfo[] = [subject]): string[] {
  return integrationActions(subject, all).map(
    (action) => `${action.kind} ${action.label} → ${action.target.name}`
  );
}

describe('integrationActions', () => {
  describe('an OAuth integration', () => {
    it('is authorized while not signed in, whether or not its credentials are saved', () => {
      expect(offered(oauthIntegration(TWITCH_AUTH))).toEqual(['authorize Authorize → twitch-auth']);
      expect(offered(oauthIntegration(TWITCH_AUTH, {}, false))).toEqual([
        'authorize Authorize → twitch-auth',
      ]);
    });

    it('is reconnected, or stopped, once its grant is lost', () => {
      const auth = oauthIntegration(TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true });

      expect(offered(auth)).toEqual([
        'authorize Reconnect → twitch-auth',
        'stop Stop → twitch-auth',
      ]);
    });

    describe('with a sign-in saved', () => {
      it('is started on it after being stopped, or signed in again', () => {
        expect(offered(signedInIntegration(TWITCH_AUTH))).toEqual([
          'start Start → twitch-auth',
          'authorize Sign in again → twitch-auth',
        ]);
      });

      it('is retried on it after failing, signed in again, or stopped', () => {
        const auth = signedInIntegration(TWITCH_AUTH, { status: ERROR, enabled: true });

        expect(offered(auth)).toEqual([
          'start Retry → twitch-auth',
          'authorize Sign in again → twitch-auth',
          'stop Stop → twitch-auth',
        ]);
      });

      it("offers the dashboard's one repair as the retry", () => {
        const auth = signedInIntegration(TWITCH_AUTH, { status: ERROR, enabled: true });

        expect(repairAction(auth, [auth])).toMatchObject({ kind: 'start', label: 'Retry' });
      });

      it('is left alone while it connects', () => {
        const auth = signedInIntegration(TWITCH_AUTH, { status: CONNECTING, enabled: true });

        expect(offered(auth)).toEqual(['stop Stop → twitch-auth']);
      });

      it('is reconnected, not retried, once its grant is lost', () => {
        const auth = signedInIntegration(TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true });

        expect(repairAction(auth, [auth])).toMatchObject({ kind: 'authorize', label: 'Reconnect' });
      });
    });

    it('can only be stopped while signed in', () => {
      const auth = oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true });

      expect(offered(auth)).toEqual(['stop Stop → twitch-auth']);
    });
  });

  describe('an integration without OAuth', () => {
    it('is started while stopped', () => {
      expect(offered(integration(SOUND))).toEqual(['start Start → sound']);
    });

    it('is started, not retried, when it failed after being stopped', () => {
      expect(offered(integration(SOUND, { status: ERROR }))).toEqual(['start Start → sound']);
    });

    it('is retried, or stopped, when it failed while enabled', () => {
      expect(offered(integration(SOUND, { status: ERROR, enabled: true }))).toEqual([
        'start Retry → sound',
        'stop Stop → sound',
      ]);
    });

    it('can only be stopped while running or connecting', () => {
      expect(offered(integration(SOUND, { status: CONNECTED, enabled: true }))).toEqual([
        'stop Stop → sound',
      ]);
      expect(offered(integration(SOUND, { status: CONNECTING, enabled: true }))).toEqual([
        'stop Stop → sound',
      ]);
    });
  });

  describe('an API integration', () => {
    it('can only be stopped while it waits on its sign-in', () => {
      const auth = oauthIntegration(TWITCH_AUTH);
      const api = apiIntegration(TWITCH_API, TWITCH_AUTH, { status: BLOCKED, enabled: true });

      expect(offered(api, [auth, api])).toEqual(['stop Stop → twitch-api']);
    });

    it('is reconnected by signing in again through its auth integration once its grant is lost', () => {
      const auth = oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true });
      const api = apiIntegration(TWITCH_API, TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true });

      expect(offered(api, [auth, api])).toEqual([
        'authorize Reconnect twitch-auth → twitch-auth',
        'stop Stop → twitch-api',
      ]);
    });

    it('finds the sign-in through the integrations between them', () => {
      const auth = oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true });
      const api = apiIntegration(TWITCH_API, TWITCH_AUTH, { status: CONNECTED, enabled: true });
      const eventSub = apiIntegration(TWITCH_EVENTSUB, TWITCH_API, { status: NEEDS_REAUTH });

      expect(repairAction(eventSub, [auth, api, eventSub])).toMatchObject({
        kind: 'authorize',
        target: auth,
      });
    });

    it('is retried when it lost its grant but signs in through nothing the console knows', () => {
      const api = apiIntegration(TWITCH_API, TWITCH_AUTH, { status: NEEDS_REAUTH, enabled: true });

      expect(repairAction(api, [api])).toMatchObject({ kind: 'start', label: 'Retry' });
    });
  });
});

describe('missingDependencies', () => {
  it('lists the dependencies not yet connected, unknown ones included', () => {
    const auth = oauthIntegration(TWITCH_AUTH, { status: CONNECTED, enabled: true });
    const api = apiIntegration(TWITCH_API, TWITCH_AUTH);
    const eventSub = integration(TWITCH_EVENTSUB, {
      metadata: { dependencies: [TWITCH_AUTH, TWITCH_API, 'gone'] },
    });

    expect(missingDependencies(eventSub, [auth, api, eventSub])).toEqual([TWITCH_API, 'gone']);
  });
});
