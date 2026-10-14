import { StreamingPlatform } from '@turingmod/shared';
import { z } from 'zod';
import type { SettingsDefinition } from '../database/repositories/SettingsRepository.js';

/** A platform's override of a message's default wording. */
const PLATFORM_OVERRIDES = {
  [StreamingPlatform.TWITCH]: z.string().exactOptional(),
  [StreamingPlatform.YOUTUBE]: z.string().exactOptional(),
} satisfies Record<StreamingPlatform, z.ZodType>;

/**
 * A chat message with an optional per-platform override. `default` is used for any platform
 * without an override. An empty string means "send nothing" on that platform. A stored message
 * replaces the built-in one wholesale rather than merging with it: setting only `default` changes
 * the wording everywhere, rather than leaving a built-in Twitch override in place.
 */
const PerPlatformMessageSchema = z.strictObject({ default: z.string(), ...PLATFORM_OVERRIDES });

export type PerPlatformMessage = z.infer<typeof PerPlatformMessageSchema>;

const sourceNames = (defaults: string[]) => z.array(z.string().min(1)).default(() => [...defaults]);

/**
 * Stream-break behavior. During a break the streamer is taken off camera and mic in OBS, which
 * every platform sees, so the OBS side is platform-agnostic; only the chat wording varies.
 *
 * A field left out takes its default; one that is present must be valid.
 */
const BreakSettingsSchema = z.strictObject({
  /** Master switch for automatic behavior: ad-triggered breaks and ad pre-warnings. */
  enabled: z.boolean().default(true),

  obs: z
    .strictObject({
      /** Sources hidden for the break, in every scene of every canvas they appear in. */
      hideSources: sourceNames(['Facecam']),
      /** Sources shown for the break (e.g. a "taking a break" text source). */
      showSources: sourceNames(['Ads Text']),
      /** Audio inputs muted for the break. */
      muteInputs: sourceNames(['Mic/Aux']),
      /** Scenes in which `hideSources` are left alone (e.g. a full-screen facecam scene). */
      keepVisibleInScenes: sourceNames([]),
    })
    .prefault({}),

  adWarnings: z
    .strictObject({
      /** Seconds before a scheduled ad at which to warn chat, e.g. [300, 60]. */
      leadTimesSeconds: z.array(z.number().positive()).default(() => [300, 60]),
      /** How often to re-read the ad schedule, which moves on snoozes and manual ads. */
      pollIntervalSeconds: z.number().min(30).default(300),
    })
    .prefault({}),

  /** Templates. `{time}` is the time until the ad; `{duration}` is the break length. */
  messages: z
    .strictObject({
      adWarning: PerPlatformMessageSchema.default(() => ({
        default: 'Heads up: short break in {time}.',
        [StreamingPlatform.TWITCH]: 'Heads up: ads will run in {time}. Sorry for the interruption!',
      })),
      adBreakStarted: PerPlatformMessageSchema.default(() => ({
        default: 'Taking a short break, back in about {duration}.',
        [StreamingPlatform.TWITCH]: 'Ads are running for {duration}. Back soon!',
      })),
      manualBreakStarted: PerPlatformMessageSchema.default(() => ({
        default: 'Taking a short break, back in about {duration}.',
      })),
      breakEnded: PerPlatformMessageSchema.default(() => ({
        default: "Break's over, welcome back!",
      })),
    })
    .prefault({}),

  /**
   * Sound clips to play at the start and end of a break — a name in the sound library or an
   * absolute path; null for none. The original bot played `ad warn.wav` and `ad done.wav`.
   */
  sounds: z
    .strictObject({
      breakStarted: z.string().min(1).nullable().default(null),
      breakEnded: z.string().min(1).nullable().default(null),
    })
    .prefault({}),
});

export type BreakSettings = z.infer<typeof BreakSettingsSchema>;

/** The break settings, stored under the `breaks` key. */
export const BREAK_SETTINGS: SettingsDefinition<BreakSettings> = {
  key: 'breaks',
  schema: BreakSettingsSchema,
};

export const DEFAULT_BREAK_SETTINGS: BreakSettings = BreakSettingsSchema.parse({});

/** The message for `platform`, falling back to the default. Null when it renders empty. */
export function renderMessage(
  message: PerPlatformMessage,
  platform: StreamingPlatform,
  vars: Record<string, string>
): string | null {
  const template = message[platform] ?? message.default;
  const rendered = template
    .replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)
    .trim();
  return rendered === '' ? null : rendered;
}
