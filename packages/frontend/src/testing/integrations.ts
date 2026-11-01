import { type IntegrationInfo, type IntegrationName, IntegrationStatus } from '@turingmod/shared';

/** An integration as `integrations.watch` reports it: stopped, unless the test says otherwise. */
export function integration(
  name: IntegrationName,
  overrides: Partial<IntegrationInfo> = {}
): IntegrationInfo {
  return { name, status: IntegrationStatus.DISCONNECTED, enabled: false, ...overrides };
}

/** An OAuth sign-in integration, with or without its client credentials entered. */
export function oauthIntegration(
  name: IntegrationName,
  overrides: Partial<IntegrationInfo> = {},
  configured = true
): IntegrationInfo {
  const path = `/callback/${name.replace(/-auth$/, '')}`;
  return integration(name, {
    oauth: { callbackPath: path, redirectUri: `http://localhost:8080${path}`, configured },
    ...overrides,
  });
}

/** An API integration that signs in through `auth`. */
export function apiIntegration(
  name: IntegrationName,
  auth: IntegrationName,
  overrides: Partial<IntegrationInfo> = {}
): IntegrationInfo {
  return integration(name, { metadata: { dependencies: [auth] }, ...overrides });
}
