import { StreamingPlatform } from '@turingmod/shared';

/** `settings` table key the break settings are stored under. */
export const BREAK_SETTINGS_KEY = 'breaks';

/**
 * A chat message with an optional per-platform override. `default` is used for any platform
 * without an override. An empty string means "send nothing" on that platform.
 */
export type PerPlatformMessage = { default: string } & Partial<Record<StreamingPlatform, string>>;

/**
 * Stream-break behavior. During a break the streamer is taken off camera and mic in OBS, which
 * every platform sees, so the OBS side is platform-agnostic; only the chat wording varies.
 */
export interface BreakSettings {
  /** Master switch for automatic behavior: ad-triggered breaks and ad pre-warnings. */
  enabled: boolean;

  obs: {
    /** Sources hidden for the break, in every scene of every canvas they appear in. */
    hideSources: string[];
    /** Sources shown for the break (e.g. a "taking a break" text source). */
    showSources: string[];
    /** Audio inputs muted for the break. */
    muteInputs: string[];
    /** Scenes in which `hideSources` are left alone (e.g. a full-screen facecam scene). */
    keepVisibleInScenes: string[];
  };

  adWarnings: {
    /** Seconds before a scheduled ad at which to warn chat, e.g. [300, 60]. */
    leadTimesSeconds: number[];
    /** How often to re-read the ad schedule, which moves on snoozes and manual ads. */
    pollIntervalSeconds: number;
  };

  /** Templates. `{time}` is the time until the ad; `{duration}` is the break length. */
  messages: {
    adWarning: PerPlatformMessage;
    adBreakStarted: PerPlatformMessage;
    manualBreakStarted: PerPlatformMessage;
    breakEnded: PerPlatformMessage;
  };

  /**
   * Sound clips to play at the start and end of a break — a name in the sound library or an
   * absolute path; null for none. The original bot played `ad warn.wav` and `ad done.wav`.
   */
  sounds: {
    breakStarted: string | null;
    breakEnded: string | null;
  };
}

export const DEFAULT_BREAK_SETTINGS: BreakSettings = {
  enabled: true,
  obs: {
    hideSources: ['Facecam'],
    showSources: ['Ads Text'],
    muteInputs: ['Mic/Aux'],
    keepVisibleInScenes: [],
  },
  adWarnings: {
    leadTimesSeconds: [300, 60],
    pollIntervalSeconds: 300,
  },
  messages: {
    adWarning: {
      default: 'Heads up: short break in {time}.',
      [StreamingPlatform.TWITCH]: 'Heads up: ads will run in {time}. Sorry for the interruption!',
    },
    adBreakStarted: {
      default: 'Taking a short break, back in about {duration}.',
      [StreamingPlatform.TWITCH]: 'Ads are running for {duration}. Back soon!',
    },
    manualBreakStarted: {
      default: 'Taking a short break, back in about {duration}.',
    },
    breakEnded: {
      default: "Break's over, welcome back!",
    },
  },
  sounds: {
    breakStarted: null,
    breakEnded: null,
  },
};

const MIN_POLL_INTERVAL_SECONDS = 30;

/**
 * Merge stored settings over the defaults, field by field. A field that is missing or of the
 * wrong type falls back to its default and is reported in `problems`, so one bad value doesn't
 * discard the rest of the streamer's settings.
 */
export function parseBreakSettings(raw: unknown): {
  settings: BreakSettings;
  problems: string[];
} {
  const problems: string[] = [];
  const d = DEFAULT_BREAK_SETTINGS;
  const root = asRecord(raw, 'breaks', problems);
  const obs = asRecord(root.obs, 'breaks.obs', problems);
  const adWarnings = asRecord(root.adWarnings, 'breaks.adWarnings', problems);
  const messages = asRecord(root.messages, 'breaks.messages', problems);
  const sounds = asRecord(root.sounds, 'breaks.sounds', problems);

  const pollIntervalSeconds = field(
    adWarnings.pollIntervalSeconds,
    d.adWarnings.pollIntervalSeconds,
    'breaks.adWarnings.pollIntervalSeconds',
    problems,
    (v): v is number => typeof v === 'number' && v >= MIN_POLL_INTERVAL_SECONDS
  );

  return {
    settings: {
      enabled: field(root.enabled, d.enabled, 'breaks.enabled', problems, isBoolean),
      obs: {
        hideSources: field(
          obs.hideSources,
          d.obs.hideSources,
          'breaks.obs.hideSources',
          problems,
          isStringArray
        ),
        showSources: field(
          obs.showSources,
          d.obs.showSources,
          'breaks.obs.showSources',
          problems,
          isStringArray
        ),
        muteInputs: field(
          obs.muteInputs,
          d.obs.muteInputs,
          'breaks.obs.muteInputs',
          problems,
          isStringArray
        ),
        keepVisibleInScenes: field(
          obs.keepVisibleInScenes,
          d.obs.keepVisibleInScenes,
          'breaks.obs.keepVisibleInScenes',
          problems,
          isStringArray
        ),
      },
      adWarnings: {
        leadTimesSeconds: field(
          adWarnings.leadTimesSeconds,
          d.adWarnings.leadTimesSeconds,
          'breaks.adWarnings.leadTimesSeconds',
          problems,
          (v): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number' && n > 0)
        ),
        pollIntervalSeconds,
      },
      messages: {
        adWarning: message(messages.adWarning, d.messages.adWarning, 'adWarning', problems),
        adBreakStarted: message(
          messages.adBreakStarted,
          d.messages.adBreakStarted,
          'adBreakStarted',
          problems
        ),
        manualBreakStarted: message(
          messages.manualBreakStarted,
          d.messages.manualBreakStarted,
          'manualBreakStarted',
          problems
        ),
        breakEnded: message(messages.breakEnded, d.messages.breakEnded, 'breakEnded', problems),
      },
      sounds: {
        breakStarted: field(
          sounds.breakStarted,
          d.sounds.breakStarted,
          'breaks.sounds.breakStarted',
          problems,
          isNullableString
        ),
        breakEnded: field(
          sounds.breakEnded,
          d.sounds.breakEnded,
          'breaks.sounds.breakEnded',
          problems,
          isNullableString
        ),
      },
    },
    problems,
  };
}

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

function asRecord(value: unknown, path: string, problems: string[]): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${path} is not an object; using defaults`);
    return {};
  }
  return value as Record<string, unknown>;
}

function field<T>(
  value: unknown,
  fallback: T,
  path: string,
  problems: string[],
  valid: (v: unknown) => v is T
): T {
  if (value === undefined) {
    return fallback;
  }
  if (!valid(value)) {
    problems.push(`${path} is invalid; using the default`);
    return fallback;
  }
  return value;
}

function message(
  value: unknown,
  fallback: PerPlatformMessage,
  name: string,
  problems: string[]
): PerPlatformMessage {
  if (value === undefined) {
    return fallback;
  }
  // A stored message replaces the built-in one wholesale rather than merging with it: setting
  // only `default` should change the wording everywhere, not leave a built-in Twitch override.
  const valid =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).default === 'string' &&
    Object.values(value).every((v) => typeof v === 'string');
  if (!valid) {
    problems.push(
      `breaks.messages.${name} is invalid (needs a string "default"); using the default`
    );
    return fallback;
  }
  return value as PerPlatformMessage;
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}
