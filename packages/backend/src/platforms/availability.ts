import { IntegrationStatus, type Platform } from '@turingmod/shared';
import { platformDisplayName } from './platformNames.js';

/** The slice of BaseIntegration a platform façade needs to explain its own availability. */
interface StatusReporting {
  getStatus(): IntegrationStatus;
  getErrorMessage(): string | undefined;
}

/**
 * Describe why an integration can't currently be acted on, or null if it can.
 *
 * Shared by the platform façades so Twitch and YouTube phrase the same conditions the same way.
 * Prefers the integration's own error message, which carries the specific cause (a rejected
 * refresh token, a revoked grant) over this generic wording.
 */
export function unavailableReason(integration: StatusReporting, platform: Platform): string | null {
  const platformLabel = platformDisplayName(platform);

  switch (integration.getStatus()) {
    case IntegrationStatus.CONNECTED:
      return null;
    case IntegrationStatus.NEEDS_REAUTH:
      return (
        integration.getErrorMessage() ??
        `${platformLabel} authorization expired — re-authorization required`
      );
    case IntegrationStatus.ERROR:
      return integration.getErrorMessage() ?? `${platformLabel} connection failed`;
    default:
      return `Not connected to ${platformLabel} — complete the ${platformLabel} OAuth flow first`;
  }
}
