/**
 * Base WebSocket message structure
 */
export interface IWebSocketMessage<T = unknown> {
  /** Unique message ID for request/response matching */
  id: string;

  /** Message type */
  type: MessageType;

  /** Unix timestamp when message was created */
  timestamp: number;

  /** Type-specific payload */
  payload: T;
}

/**
 * All possible message types
 */
export enum MessageType {
  // Served by the tRPC router (TRPC_PATH) instead: integrations, liveState, youtubeChat, commands,
  // data, activity

  // Server → Client: Errors
  ERROR = 'error',

  // OAuth Flow
  OAUTH_GET_AUTH_URL = 'oauth.getAuthUrl',
  OAUTH_AUTH_URL_RESPONSE = 'oauth.authUrlResponse',
  OAUTH_RESULT = 'oauth.result', // Server → Client (broadcast): an authorization finished
}

// ============================================================================
// Payload Types
//
// What the server sends. Request payloads (client → server) are inferred from their schemas
// in requests.ts.
// ============================================================================

/** Why a request got an error message instead of its response. */
export type ErrorCode =
  /** The payload didn't have the shape its message type requires. */
  | 'INVALID_PAYLOAD'
  /** No handler is registered for the message type. */
  | 'UNKNOWN_MESSAGE_TYPE'
  /** The handler threw. */
  | 'HANDLER_ERROR'
  /** The message couldn't be read or routed at all (e.g. it wasn't JSON). */
  | 'MESSAGE_HANDLING_ERROR'
  /** Client side: the connection closed before the response arrived. */
  | 'CONNECTION_CLOSED';

/**
 * Error payload
 */
export interface ErrorPayload {
  code: ErrorCode;

  /** Error message */
  message: string;

  /** Original message ID that caused the error (if applicable) */
  originalMessageId?: string;

  /** Additional error details */
  details?: unknown;
}

/**
 * OAuth auth URL response payload
 */
export interface OAuthAuthUrlResponsePayload {
  /** Integration name */
  integrationName: string;

  /** Authorization URL for the user to visit */
  authUrl: string;
}

/**
 * How an authorization ended, broadcast once the backend has handled the provider's callback:
 * it exchanges the code itself, so this never carries one.
 */
export interface OAuthResultPayload {
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: string;

  /** Whether the integration now holds tokens */
  success: boolean;

  /** Why not: the provider's error (e.g. the streamer denied access) or the exchange's */
  errorMessage?: string;
}

// ============================================================================
// Message Creators (Type-safe helpers)
// ============================================================================

/**
 * Create a WebSocket message with type inference
 */
export function createMessage<T>(type: MessageType, payload: T, id?: string): IWebSocketMessage<T> {
  return {
    id: id ?? crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Create an error message
 */
export function createErrorMessage(
  code: ErrorCode,
  message: string,
  originalMessageId?: string,
  details?: unknown
): IWebSocketMessage<ErrorPayload> {
  const payload: ErrorPayload = { code, message };
  if (originalMessageId !== undefined) {
    payload.originalMessageId = originalMessageId;
  }
  if (details !== undefined) {
    payload.details = details;
  }
  return createMessage(MessageType.ERROR, payload, originalMessageId);
}

/**
 * Create an OAuth auth URL response message
 */
export function createOAuthAuthUrlResponseMessage(
  integrationName: string,
  authUrl: string,
  originalMessageId: string
): IWebSocketMessage<OAuthAuthUrlResponsePayload> {
  return createMessage(
    MessageType.OAUTH_AUTH_URL_RESPONSE,
    { integrationName, authUrl },
    originalMessageId
  );
}

/**
 * Create an OAuth result message
 */
export function createOAuthResultMessage(
  integrationName: string,
  success: boolean,
  errorMessage?: string
): IWebSocketMessage<OAuthResultPayload> {
  const payload: OAuthResultPayload = { integrationName, success };
  if (errorMessage !== undefined) {
    payload.errorMessage = errorMessage;
  }
  return createMessage(MessageType.OAUTH_RESULT, payload);
}
