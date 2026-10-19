import { z } from 'zod';

/**
 * The messages TuringMod and an Arduino exchange over WebSocket: one JSON object per text frame,
 * each with a `type`. The protocol is TuringMod's own, but the firmware is written separately, so
 * what the board sends is parsed like a third party's response: only the fields we use are
 * required, and extra ones are allowed so newer firmware can add some.
 */

/** Bumped when a change would break firmware written for the previous version. */
export const ARDUINO_PROTOCOL_VERSION = 1;

/** TuringMod's opening message, sent as soon as the socket is open. */
export function helloMessage(): string {
  return JSON.stringify({ type: 'hello', protocol: ARDUINO_PROTOCOL_VERSION });
}

/** The board's answer to `hello`, describing itself. */
export const HelloReplySchema = z.object({
  type: z.literal('hello'),
  protocol: z.number().int(),
  /** What the device is, e.g. `turingmod-arm`. */
  name: z.string().min(1),
  firmware: z.string().min(1),
  /** How many servos it drives; 0 for a device without any. */
  servos: z.number().int().min(0),
});

export type ArduinoDevice = Omit<z.infer<typeof HelloReplySchema>, 'type'>;

/** Anything else the board sends: a `type` and whatever fields that type carries. */
export const DeviceMessageSchema = z.looseObject({ type: z.string().min(1) });

export type DeviceMessage = z.infer<typeof DeviceMessageSchema>;

/** One text frame as JSON, or undefined if it isn't JSON. */
export function parseFrame(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What a frame received before the handshake means: the board, described by its `hello` reply;
 * why that reply can't be used (it doesn't parse, or the firmware speaks another protocol
 * version); or null for any other frame, which is ignored until the reply arrives.
 */
export function readHello(frame: unknown): ArduinoDevice | string | null {
  const message = DeviceMessageSchema.safeParse(frame);
  if (!message.success || message.data.type !== 'hello') {
    return null;
  }
  const reply = HelloReplySchema.safeParse(frame);
  if (!reply.success) {
    return `The Arduino answered hello with something TuringMod can't read:\n${z.prettifyError(reply.error)}`;
  }
  const { type: _type, ...device } = reply.data;
  if (device.protocol !== ARDUINO_PROTOCOL_VERSION) {
    return (
      `The Arduino's firmware speaks protocol ${device.protocol}, and TuringMod speaks ` +
      `${ARDUINO_PROTOCOL_VERSION}: update whichever is older`
    );
  }
  return device;
}
