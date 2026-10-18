import { z } from 'zod';

/**
 * A Discord id ("snowflake"), as Discord's "Copy Channel ID" gives it. Shared so the console's
 * setup dialog checks ids the way the backend's config schema does.
 */
export const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Expected a Discord id, such as a channel id');
