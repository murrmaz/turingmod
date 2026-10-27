import { IntegrationName } from '@turingmod/shared';
import type { ComponentType } from 'react';
import { ArduinoSetupModal } from './ArduinoSetupModal';
import { type ConfigSetupModalProps, DiscordSetupModal } from './DiscordSetupModal';
import { ObsSetupModal } from './ObsSetupModal';

/**
 * Maps a non-OAuth integration whose config the console can enter to its setup dialog, so the
 * Integrations page offers Set up without branching on integration names. OAuth providers' setup
 * is in OAUTH_INTEGRATION_REGISTRY instead.
 */
export const CONFIG_SETUP_REGISTRY: Record<string, ComponentType<ConfigSetupModalProps>> = {
  [IntegrationName.ARDUINO]: ArduinoSetupModal,
  [IntegrationName.DISCORD]: DiscordSetupModal,
  [IntegrationName.OBS]: ObsSetupModal,
};
