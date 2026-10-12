import { PlatformCapability } from '@turingmod/shared';
import type {
  CapabilityApiName,
  DeclaredCapability,
  IStreamPlatform,
} from './interfaces/IStreamPlatform.js';

/** The capabilities a capability object stands for, rather than being declared outright. */
type ApiCapability = Exclude<PlatformCapability, DeclaredCapability>;

/** Which capability each capability object stands for. */
export const CAPABILITY_OF_API = {
  ads: PlatformCapability.ADS,
  schedule: PlatformCapability.SCHEDULE,
  contentLabels: PlatformCapability.CONTENT_LABELS,
  broadcasterAbout: PlatformCapability.BROADCASTER_ABOUT,
  shoutout: PlatformCapability.SHOUTOUT,
  channelPoints: PlatformCapability.CHANNEL_POINTS,
  moderation: PlatformCapability.MODERATION,
  clips: PlatformCapability.CLIPS,
  followInfo: PlatformCapability.FOLLOW_INFO,
  accountAge: PlatformCapability.ACCOUNT_AGE,
  markers: PlatformCapability.MARKERS,
  vods: PlatformCapability.VODS,
  announcements: PlatformCapability.ANNOUNCEMENTS,
} as const satisfies Record<CapabilityApiName, ApiCapability>;

// `satisfies` above makes every capability object name a capability. This makes every capability
// that isn't declared outright have an object, so a new PlatformCapability can't be added without
// deciding which it is.
type UnbackedCapability = Exclude<ApiCapability, (typeof CAPABILITY_OF_API)[CapabilityApiName]>;
const everyCapabilityHasAnObject: [UnbackedCapability] extends [never] ? true : UnbackedCapability =
  true;
void everyCapabilityHasAnObject;

const API_NAMES = Object.keys(CAPABILITY_OF_API) as CapabilityApiName[];

/** A façade's capabilities: what it declares, plus one for each capability object it has. */
export function capabilitiesOf(platform: IStreamPlatform): Set<PlatformCapability> {
  const capabilities = new Set<PlatformCapability>(platform.declaredCapabilities);
  for (const name of API_NAMES) {
    if (platform[name]) {
      capabilities.add(CAPABILITY_OF_API[name]);
    }
  }
  return capabilities;
}
