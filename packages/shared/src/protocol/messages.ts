import type { ActivityLogEntry } from '../types/activity.js';
import type { CommandInfo, ExecutionResult } from '../types/command.js';
import type { IntegrationInfo } from '../types/integration.js';
import type {
  ActivityQueryPayload,
  OAuthExchangeCodePayload,
  OAuthGetAuthUrlPayload,
} from './requests.js';

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
  // Client → Server: Commands
  COMMAND_SIMULATE = 'command.simulate',

  // Server → Client: Command responses
  COMMAND_RESULT = 'command.result',
  COMMAND_LIST = 'command.list',

  // Client → Server: Integration control
  INTEGRATION_START = 'integration.start',
  INTEGRATION_STOP = 'integration.stop',
  INTEGRATION_CONFIGURE = 'integration.configure',

  // Server → Client: Integration updates
  INTEGRATION_STATUS = 'integration.status',
  INTEGRATION_LIST = 'integration.list',

  // Server → Client: Event notifications
  EVENT_NOTIFICATION = 'event.notification',

  // Client → Server: Activity log query
  ACTIVITY_QUERY = 'activity.query',

  // Server → Client: Activity log query response
  ACTIVITY_LIST = 'activity.list',

  // Server → Client: Errors
  ERROR = 'error',

  // OAuth Flow
  OAUTH_GET_AUTH_URL = 'oauth.getAuthUrl',
  OAUTH_AUTH_URL_RESPONSE = 'oauth.authUrlResponse',
  OAUTH_EXCHANGE_CODE = 'oauth.exchangeCode',
  OAUTH_EXCHANGE_RESULT = 'oauth.exchangeResult',
  OAUTH_CODE_RECEIVED = 'oauth.codeReceived', // Server → Client: OAuth code captured from callback

  // YouTube chat go-live control. YouTube has no push notification for "a broadcast started"
  // (see YouTubeChatIntegration), so the console can tell the backend to go look for one.
  YOUTUBE_GO_LIVE = 'youtube.goLive', // Client → Server: connect to the active broadcast's chat
  YOUTUBE_GO_OFFLINE = 'youtube.goOffline', // Client → Server: disconnect from chat
  YOUTUBE_GET_CHAT_STATE = 'youtube.getChatState', // Client → Server: read current state on load
  YOUTUBE_CHAT_STATE = 'youtube.chatState', // Server → Client: idle / resolving / streaming
}

// ============================================================================
// Payload Types
//
// What the server sends. Request payloads (client → server) are inferred from their schemas
// in requests.ts.
// ============================================================================

/**
 * Command result payload
 */
export interface CommandResultPayload {
  /** Original command name */
  command: string;

  /** Execution result */
  result: ExecutionResult;

  /** Whether this was a simulation */
  isSimulation: boolean;
}

/**
 * Integration status payload
 */
export interface IntegrationStatusPayload {
  /** Integration information */
  integration: IntegrationInfo;
}

/**
 * Where the YouTube chat integration is in its lifecycle. `IntegrationStatus` only says whether the
 * integration is enabled; this says whether chat is actually connected.
 *
 * - `idle` — running, but waiting for a go-live signal
 * - `resolving` — a signal arrived; looking for an active broadcast's liveChatId
 * - `streaming` — connected to live chat and receiving messages
 */
export type YouTubeChatState = 'idle' | 'resolving' | 'streaming';

/**
 * YouTube chat state payload (server → client).
 */
export interface YouTubeChatStatePayload {
  state: YouTubeChatState;
}

/**
 * Command list payload
 */
export interface CommandListPayload {
  /** All available commands */
  commands: CommandInfo[];
}

/**
 * Integration list payload
 */
export interface IntegrationListPayload {
  /** All integrations */
  integrations: IntegrationInfo[];
}

/**
 * Event notification payload
 */
export interface EventNotificationPayload {
  /** The activity log entry to append to the live feed */
  entry: ActivityLogEntry;
}

/**
 * Activity list payload (server → client)
 */
export interface ActivityListPayload {
  /** Matching activity log entries */
  entries: ActivityLogEntry[];
}

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
  | 'INTEGRATION_START_FAILED'
  | 'INTEGRATION_STOP_FAILED'
  | 'INTEGRATION_CONFIGURE_FAILED'
  | 'ACTIVITY_QUERY_FAILED'
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
 * OAuth exchange result payload
 */
export interface OAuthExchangeResultPayload {
  /** Whether the exchange was successful */
  success: boolean;

  /** Error message if failed */
  errorMessage?: string;

  /** Integration name */
  integrationName: string;
}

/**
 * OAuth code received payload (from callback)
 */
export interface OAuthCodeReceivedPayload {
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: string;

  /** Authorization code captured from callback */
  code: string;
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
 * Create a command result message
 */
export function createCommandResultMessage(
  payload: CommandResultPayload,
  originalMessageId: string
): IWebSocketMessage<CommandResultPayload> {
  return createMessage(MessageType.COMMAND_RESULT, payload, originalMessageId);
}

/**
 * Create an integration status message
 */
export function createIntegrationStatusMessage(
  integration: IntegrationInfo
): IWebSocketMessage<IntegrationStatusPayload> {
  return createMessage(MessageType.INTEGRATION_STATUS, { integration });
}

/**
 * Create an event notification message
 */
export function createEventNotificationMessage(
  entry: ActivityLogEntry
): IWebSocketMessage<EventNotificationPayload> {
  return createMessage(MessageType.EVENT_NOTIFICATION, { entry });
}

/**
 * Create an activity query message
 */
export function createActivityQueryMessage(
  payload: ActivityQueryPayload
): IWebSocketMessage<ActivityQueryPayload> {
  return createMessage(MessageType.ACTIVITY_QUERY, payload);
}

/**
 * Create an activity list message
 */
export function createActivityListMessage(
  entries: ActivityLogEntry[],
  originalMessageId: string
): IWebSocketMessage<ActivityListPayload> {
  return createMessage(MessageType.ACTIVITY_LIST, { entries }, originalMessageId);
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
 * Create an OAuth get auth URL message
 */
export function createOAuthGetAuthUrlMessage(
  integrationName: string
): IWebSocketMessage<OAuthGetAuthUrlPayload> {
  return createMessage(MessageType.OAUTH_GET_AUTH_URL, { integrationName });
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
 * Create an OAuth exchange code message
 */
export function createOAuthExchangeCodeMessage(
  integrationName: string,
  code: string
): IWebSocketMessage<OAuthExchangeCodePayload> {
  return createMessage(MessageType.OAUTH_EXCHANGE_CODE, { integrationName, code });
}

/**
 * Create an OAuth exchange result message
 */
export function createOAuthExchangeResultMessage(
  integrationName: string,
  success: boolean,
  errorMessage: string | undefined,
  originalMessageId: string
): IWebSocketMessage<OAuthExchangeResultPayload> {
  const payload: OAuthExchangeResultPayload = { integrationName, success };
  if (errorMessage !== undefined) {
    payload.errorMessage = errorMessage;
  }
  return createMessage(MessageType.OAUTH_EXCHANGE_RESULT, payload, originalMessageId);
}

/**
 * Create an OAuth code received message
 */
export function createOAuthCodeReceivedMessage(
  integrationName: string,
  code: string
): IWebSocketMessage<OAuthCodeReceivedPayload> {
  return createMessage(MessageType.OAUTH_CODE_RECEIVED, { integrationName, code });
}

/**
 * Create a YouTube chat state message
 */
export function createYouTubeChatStateMessage(
  state: YouTubeChatState,
  originalMessageId?: string
): IWebSocketMessage<YouTubeChatStatePayload> {
  return createMessage(MessageType.YOUTUBE_CHAT_STATE, { state }, originalMessageId);
}
