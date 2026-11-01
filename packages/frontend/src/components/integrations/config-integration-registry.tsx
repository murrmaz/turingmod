import { IntegrationName } from '@turingmod/shared';
import type { ComponentType } from 'react';
import { ArduinoSetupModal } from './arduino-setup-modal';
import { DiscordSetupModal } from './discord-setup-modal';
import type { ConfigSetupModalProps } from './integration-config-dialog';
import { ObsSetupModal } from './obs-setup-modal';

/**
 * Maps a non-OAuth integration whose config the console can enter to its setup dialog, so the
 * Integrations page offers Set up without branching on integration names. OAuth providers' setup
 * is in OAUTH_INTEGRATION_REGISTRY instead.
 */
export const CONFIG_SETUP_REGISTRY: Record<string, ComponentType<ConfigSetupModalProps>> = {
  [IntegrationName.ARDUINO]: ArduinoSetupModal,
  [IntegrationName.DISCORD]: DiscordSetupModal,
  [IntegrationName.OBS]: ObsSetupModal,
} satisfies Partial<Record<IntegrationName, ComponentType<ConfigSetupModalProps>>>;
