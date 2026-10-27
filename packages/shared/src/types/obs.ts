import { z } from 'zod';

/** obs-websocket's default address, on the machine TuringMod runs on. */
export const OBS_DEFAULT_URL = 'ws://127.0.0.1:4455';

/** The OBS integration's config, as its setup dialog saves it and the backend stores it. */
export const ObsConfigSchema = z.strictObject({
  /** obs-websocket's address. Omitted = OBS's default on this machine. */
  url: z
    .url({ protocol: /^wss?$/, error: 'Expected a ws:// address, such as ws://127.0.0.1:4455' })
    .default(OBS_DEFAULT_URL),
  /** obs-websocket's server password. Omitted = authentication is off in OBS. */
  password: z.string().min(1).exactOptional(),
});
export type ObsConfig = z.infer<typeof ObsConfigSchema>;
