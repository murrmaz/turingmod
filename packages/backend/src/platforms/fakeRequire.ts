import type { StreamingPlatform } from '@turingmod/shared';
import type { CapabilityApiName, CapabilityApis } from './interfaces/IStreamPlatform.js';

/**
 * Test helper: a `StreamControlService.require` that hands out `apis` on `platform` and throws
 * for anything else, so asking the wrong platform fails the test. An object need only have the
 * methods the test uses.
 */
export function fakeRequire(
  platform: StreamingPlatform,
  apis: { [K in CapabilityApiName]?: Partial<CapabilityApis[K]> }
) {
  return <K extends CapabilityApiName>(
    requested: StreamingPlatform,
    name: K
  ): CapabilityApis[K] => {
    const api = apis[name] as CapabilityApis[K] | undefined;
    if (requested !== platform || !api) {
      throw new Error(`${requested} does not support ${name}`);
    }
    return api;
  };
}
