import { z } from 'zod';

/**
 * A Discord id ("snowflake"), as Discord's "Copy Channel ID" gives it. Shared so the console's
 * setup dialog checks ids the way the backend's config schema does.
 */
export const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Expected a Discord id, such as a channel id');

/** The Discord integration's config, as its setup dialog saves it and the backend stores it. */
export const DiscordConfigSchema = z.strictObject({
  /** The bot's token, from the Discord developer portal's Bot page. */
  botToken: z.string().trim().min(1),
  /** The channel go-live notifications are posted in. */
  notificationChannelId: DiscordSnowflakeSchema,
});
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
