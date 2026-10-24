import { z } from 'zod';
import { StreamingPlatform } from '../constants/platform.js';
import { ActivityCategory } from '../types/activity.js';
import { SimulatedUserSchema } from '../types/user.js';
import { MessageType } from './messages.js';

/**
 * Schemas for what the console sends: the message envelope, and the payload of each request type.
 * The backend parses every inbound message against them before a handler sees it, and the payload
 * types are inferred from them, so a type and its check can't drift apart. Objects are strict: an
 * unknown key is an error, not something to ignore.
 */

/** The envelope every message shares. The payload is checked against its type's schema. */
export const WebSocketMessageSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(MessageType),
  timestamp: z.number(),
  payload: z.unknown(),
});

/** A request that carries no fields: the message type is the whole request. */
export const EmptyPayloadSchema = z.strictObject({});
export type EmptyPayload = z.infer<typeof EmptyPayloadSchema>;

/**
 * Run a command typed into the console's simulator. The text is parsed exactly as chat is, so
 * anything chat wouldn't run as a command is answered as not being one.
 */
export const CommandSimulatePayloadSchema = z.strictObject({
  /** Full command text (e.g., "!bonk @username") */
  commandText: z.string().min(1),
  /** Simulated user information */
  simulatedUser: SimulatedUserSchema,
  /** Platform to simulate */
  platform: z.enum(StreamingPlatform),
});
export type CommandSimulatePayload = z.infer<typeof CommandSimulatePayloadSchema>;

/** List commands, optionally only those available on one platform. */
export const CommandListRequestPayloadSchema = z.strictObject({
  /** Platform to filter commands by. Omitted = all registered commands. */
  platform: z.enum(StreamingPlatform).exactOptional(),
});
export type CommandListRequestPayload = z.infer<typeof CommandListRequestPayloadSchema>;

/** Start or stop one integration. */
export const IntegrationNamePayloadSchema = z.strictObject({
  integrationName: z.string().min(1),
});
export type IntegrationStartPayload = z.infer<typeof IntegrationNamePayloadSchema>;
export type IntegrationStopPayload = z.infer<typeof IntegrationNamePayloadSchema>;

/**
 * Save an integration's config. Its fields are checked against that integration's own schema on
 * the backend, before anything is stored.
 */
export const IntegrationConfigurePayloadSchema = z.strictObject({
  integrationName: z.string().min(1),
  /** Configuration data (will be encrypted server-side) */
  config: z.record(z.string(), z.unknown()),
});
export type IntegrationConfigurePayload = z.infer<typeof IntegrationConfigurePayloadSchema>;

/** Ask for an OAuth integration's authorization URL. */
export const OAuthGetAuthUrlPayloadSchema = z.strictObject({
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: z.string().min(1),
});
export type OAuthGetAuthUrlPayload = z.infer<typeof OAuthGetAuthUrlPayloadSchema>;

/** Exchange an authorization code the console captured. */
export const OAuthExchangeCodePayloadSchema = z.strictObject({
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: z.string().min(1),
  /** Authorization code from OAuth callback */
  code: z.string().min(1),
});
export type OAuthExchangeCodePayload = z.infer<typeof OAuthExchangeCodePayloadSchema>;

/** Read a page of the activity log. */
export const ActivityQueryPayloadSchema = z.strictObject({
  /** Max entries to return (default 100 server-side, capped at 500) */
  limit: z.int().positive().exactOptional(),
  /** Filter to a single category. Omit = all categories */
  category: z.enum(ActivityCategory).exactOptional(),
  /** Timestamp cursor for "load older"; omit = most recent */
  before: z.number().exactOptional(),
});
export type ActivityQueryPayload = z.infer<typeof ActivityQueryPayloadSchema>;

/** Most rows one data page may return. */
export const MAX_DATA_PAGE_SIZE = 200;

/**
 * Read a page of one table for the Data inspector. Table and column names are checked against the
 * tables the backend allows inspecting; values are only ever bound as parameters.
 */
export const DataQueryRowsPayloadSchema = z.strictObject({
  table: z.string().min(1),
  /** Zero-based page number */
  page: z.int().nonnegative(),
  pageSize: z.int().positive().max(MAX_DATA_PAGE_SIZE),
  sort: z
    .strictObject({
      column: z.string().min(1),
      direction: z.enum(['asc', 'desc']),
    })
    .exactOptional(),
  /** Keep rows whose column equals one of the listed values, per column */
  filters: z.record(z.string(), z.array(z.string()).min(1)).exactOptional(),
  /** Text matched anywhere in the table's unmasked text columns */
  search: z.string().exactOptional(),
  /** Only rows at or after this epoch-ms time, on the table's timestamp column */
  since: z.number().exactOptional(),
});
export type DataQueryRowsPayload = z.infer<typeof DataQueryRowsPayloadSchema>;

/** Every request the backend accepts, and the schema its payload must match. */
export const REQUEST_PAYLOAD_SCHEMAS = {
  [MessageType.COMMAND_SIMULATE]: CommandSimulatePayloadSchema,
  [MessageType.COMMAND_LIST]: CommandListRequestPayloadSchema,
  [MessageType.INTEGRATION_START]: IntegrationNamePayloadSchema,
  [MessageType.INTEGRATION_STOP]: IntegrationNamePayloadSchema,
  [MessageType.INTEGRATION_LIST]: EmptyPayloadSchema,
  [MessageType.INTEGRATION_CONFIGURE]: IntegrationConfigurePayloadSchema,
  [MessageType.OAUTH_GET_AUTH_URL]: OAuthGetAuthUrlPayloadSchema,
  [MessageType.OAUTH_EXCHANGE_CODE]: OAuthExchangeCodePayloadSchema,
  [MessageType.ACTIVITY_QUERY]: ActivityQueryPayloadSchema,
  [MessageType.YOUTUBE_GO_LIVE]: EmptyPayloadSchema,
  [MessageType.YOUTUBE_GO_OFFLINE]: EmptyPayloadSchema,
  [MessageType.YOUTUBE_GET_CHAT_STATE]: EmptyPayloadSchema,
  [MessageType.PLATFORM_GET_LIVE_STATE]: EmptyPayloadSchema,
  [MessageType.DATA_LIST_TABLES]: EmptyPayloadSchema,
  [MessageType.DATA_QUERY_ROWS]: DataQueryRowsPayloadSchema,
} as const satisfies Partial<Record<MessageType, z.ZodType>>;

/** A message type the backend accepts as a request, as its MessageType member. */
export type RequestType = Extract<MessageType, keyof typeof REQUEST_PAYLOAD_SCHEMAS>;

/** The payload a request of type `T` carries, once parsed. */
export type RequestPayload<T extends RequestType> = z.infer<(typeof REQUEST_PAYLOAD_SCHEMAS)[T]>;
