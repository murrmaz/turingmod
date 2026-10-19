import { z } from 'zod';

/** The hostname the reference firmware announces over mDNS, on its WebSocket server's port. */
export const ARDUINO_DEFAULT_URL = 'ws://turingmod-arm.local:81';

/**
 * The address of the Arduino's WebSocket server. Shared so the console's setup dialog checks it
 * the way the backend's config schema does.
 */
export const ArduinoUrlSchema = z.url({
  protocol: /^wss?$/,
  error: 'Expected a ws:// address, such as ws://192.168.1.50:81',
});
