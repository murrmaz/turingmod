import type { StreamingPlatform } from '../constants/platform.js';
import type { ActivityLogEntry } from '../types/activity.js';
import type { CommandInfo, ExecutionResult } from '../types/command.js';

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

  // Integrations are served by the tRPC router (TRPC_PATH): integrations.watch/start/stop/configure

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
  OAUTH_RESULT = 'oauth.result', // Server → Client (broadcast): an authorization finished

  // YouTube chat go-live control. YouTube has no push notification for "a broadcast started"
  // (see YouTubeChatIntegration), so the console can tell the backend to go look for one.
  YOUTUBE_GO_LIVE = 'youtube.goLive', // Client → Server: connect to the active broadcast's chat
  YOUTUBE_GO_OFFLINE = 'youtube.goOffline', // Client → Server: disconnect from chat
  YOUTUBE_GET_CHAT_STATE = 'youtube.getChatState', // Client → Server: read current state on load
  YOUTUBE_CHAT_STATE = 'youtube.chatState', // Server → Client: idle / resolving / streaming

  // Whether each platform is broadcasting, and since when, for the console's header badges.
  PLATFORM_GET_LIVE_STATE = 'platform.getLiveState', // Client → Server: read current state on load
  PLATFORM_LIVE_STATE = 'platform.liveState', // Server → Client: pushed on every change

  // Read-only database inspector (the console's Data page).
  DATA_LIST_TABLES = 'data.listTables', // Client → Server
  DATA_TABLES = 'data.tables', // Server → Client
  DATA_QUERY_ROWS = 'data.queryRows', // Client → Server
  DATA_ROWS = 'data.rows', // Server → Client
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
 * Whether one platform is broadcasting. `startedAt` (epoch ms) is null when offline, or when the
 * platform hasn't reported a start time yet.
 */
export interface PlatformLiveState {
  platform: StreamingPlatform;
  live: boolean;
  startedAt: number | null;
}

/** Live state of every platform (server → client). */
export interface PlatformLiveStatePayload {
  platforms: PlatformLiveState[];
}

/** One column of an inspectable table. */
export interface DataColumnInfo {
  name: string;
  /** SQLite declared type, e.g. TEXT or INTEGER */
  type: string;
  /** The value is never sent: a masked column reads as its size instead. */
  masked: boolean;
  /** The values this column can take, for columns the console offers as a filter. */
  enumValues?: string[];
  /** Holds epoch-millisecond timestamps. */
  isTimestamp: boolean;
  /** Holds JSON text. */
  isJson: boolean;
}

/** One inspectable table. */
export interface DataTableInfo {
  name: string;
  rowCount: number;
  columns: DataColumnInfo[];
  /** The column rows are ordered by when no sort is given (newest first if it's a timestamp). */
  defaultSort: string;
}

/** Every inspectable table (server → client). */
export interface DataTablesPayload {
  tables: DataTableInfo[];
}

/** A cell as sent to the console: masked columns arrive as a description of their size. */
export type DataCell = string | number | null;

/** One page of a table's rows (server → client). */
export interface DataRowsPayload {
  rows: Record<string, DataCell>[];
  /** Rows matching the filters, across all pages */
  total: number;
}

/**
 * Command list payload
 */
export interface CommandListPayload {
  /** All available commands */
  commands: CommandInfo[];
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
  | 'ACTIVITY_QUERY_FAILED'
  /** The Data inspector couldn't read what was asked (unknown table or column, or a read error). */
  | 'DATA_QUERY_FAILED'
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
 * Create a command result message
 */
export function createCommandResultMessage(
  payload: CommandResultPayload,
  originalMessageId: string
): IWebSocketMessage<CommandResultPayload> {
  return createMessage(MessageType.COMMAND_RESULT, payload, originalMessageId);
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

/**
 * Create a YouTube chat state message
 */
export function createYouTubeChatStateMessage(
  state: YouTubeChatState,
  originalMessageId?: string
): IWebSocketMessage<YouTubeChatStatePayload> {
  return createMessage(MessageType.YOUTUBE_CHAT_STATE, { state }, originalMessageId);
}

/**
 * Create a platform live state message, pushed on every change or answering a request
 */
export function createPlatformLiveStateMessage(
  platforms: PlatformLiveState[],
  originalMessageId?: string
): IWebSocketMessage<PlatformLiveStatePayload> {
  return createMessage(MessageType.PLATFORM_LIVE_STATE, { platforms }, originalMessageId);
}
