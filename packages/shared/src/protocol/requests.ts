import { z } from 'zod';
import { ActivityCategory } from '../types/activity.js';
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

/** Ask for an OAuth integration's authorization URL. */
export const OAuthGetAuthUrlPayloadSchema = z.strictObject({
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: z.string().min(1),
});
export type OAuthGetAuthUrlPayload = z.infer<typeof OAuthGetAuthUrlPayloadSchema>;

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

/** Every request the backend accepts, and the schema its payload must match. */
export const REQUEST_PAYLOAD_SCHEMAS = {
  [MessageType.OAUTH_GET_AUTH_URL]: OAuthGetAuthUrlPayloadSchema,
  [MessageType.ACTIVITY_QUERY]: ActivityQueryPayloadSchema,
} as const satisfies Partial<Record<MessageType, z.ZodType>>;

/** A message type the backend accepts as a request, as its MessageType member. */
export type RequestType = Extract<MessageType, keyof typeof REQUEST_PAYLOAD_SCHEMAS>;

/** The payload a request of type `T` carries, once parsed. */
export type RequestPayload<T extends RequestType> = z.infer<(typeof REQUEST_PAYLOAD_SCHEMAS)[T]>;
