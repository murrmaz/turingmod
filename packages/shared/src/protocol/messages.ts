import type { CommandContext, CommandInfo, CommandResult } from '../types/command.js';
import type { IntegrationInfo, IntegrationStatus } from '../types/integration.js';
import type { SimulatedUser } from '../types/user.js';

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
  COMMAND_EXECUTE = 'command.execute',
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

  // Server → Client: Health updates
  HEALTH_UPDATE = 'health.update',

  // Server → Client: Errors
  ERROR = 'error',

  // OAuth Flow
  OAUTH_GET_AUTH_URL = 'oauth.getAuthUrl',
  OAUTH_AUTH_URL_RESPONSE = 'oauth.authUrlResponse',
  OAUTH_EXCHANGE_CODE = 'oauth.exchangeCode',
  OAUTH_EXCHANGE_RESULT = 'oauth.exchangeResult',
  OAUTH_CODE_RECEIVED = 'oauth.codeReceived', // Server → Client: OAuth code captured from callback

  // Bidirectional: Connection health
  PING = 'ping',
  PONG = 'pong',
}

// ============================================================================
// Payload Types
// ============================================================================

/**
 * Command execution payload (real commands from integrations)
 */
export interface CommandExecutePayload {
  /** Command name (without !) */
  command: string;

  /** Command arguments */
  args: string[];

  /** Execution context */
  context: Omit<CommandContext, 'args'>;
}

/**
 * Command simulation payload (test commands from UI)
 */
export interface CommandSimulatePayload {
  /** Full command text (e.g., "!bonk @username") */
  commandText: string;

  /** Simulated user information */
  simulatedUser: SimulatedUser;

  /** Platform to simulate */
  platform: string;
}

/**
 * Command result payload
 */
export interface CommandResultPayload {
  /** Original command name */
  command: string;

  /** Execution result */
  result: CommandResult;

  /** Whether this was a simulation */
  isSimulation: boolean;
}

/**
 * Integration start payload
 */
export interface IntegrationStartPayload {
  /** Integration name to start */
  integrationName: string;
}

/**
 * Integration stop payload
 */
export interface IntegrationStopPayload {
  /** Integration name to stop */
  integrationName: string;
}

/**
 * Integration configure payload
 */
export interface IntegrationConfigurePayload {
  /** Integration name */
  integrationName: string;

  /** Configuration data (will be encrypted server-side) */
  config: Record<string, unknown>;
}

/**
 * Integration status payload
 */
export interface IntegrationStatusPayload {
  /** Integration information */
  integration: IntegrationInfo;
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
  /** Event type (e.g., 'twitch.chat.message') */
  event: string;

  /** Event data */
  data: Record<string, unknown>;
}

/**
 * Health update payload
 */
export interface HealthUpdatePayload {
  /** Overall system health */
  healthy: boolean;

  /** WebSocket connection status */
  websocket: {
    connected: boolean;
    connectedClients: number;
  };

  /** Database status */
  database: {
    connected: boolean;
  };

  /** Integration statuses */
  integrations: Record<string, IntegrationStatus>;
}

/**
 * Error payload
 */
export interface ErrorPayload {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Original message ID that caused the error (if applicable) */
  originalMessageId?: string;

  /** Additional error details */
  details?: unknown;
}

/**
 * Ping/Pong payload (empty)
 */
export type PingPongPayload = Record<string, never>;

/**
 * OAuth get auth URL payload
 */
export interface OAuthGetAuthUrlPayload {
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: string;
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
 * OAuth exchange code payload
 */
export interface OAuthExchangeCodePayload {
  /** Integration name (e.g., 'twitch-auth') */
  integrationName: string;

  /** Authorization code from OAuth callback */
  code: string;
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
 * Create a command execute message
 */
export function createCommandExecuteMessage(
  payload: CommandExecutePayload
): IWebSocketMessage<CommandExecutePayload> {
  return createMessage(MessageType.COMMAND_EXECUTE, payload);
}

/**
 * Create a command simulate message
 */
export function createCommandSimulateMessage(
  payload: CommandSimulatePayload
): IWebSocketMessage<CommandSimulatePayload> {
  return createMessage(MessageType.COMMAND_SIMULATE, payload);
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
 * Create an integration start message
 */
export function createIntegrationStartMessage(
  integrationName: string
): IWebSocketMessage<IntegrationStartPayload> {
  return createMessage(MessageType.INTEGRATION_START, { integrationName });
}

/**
 * Create an integration stop message
 */
export function createIntegrationStopMessage(
  integrationName: string
): IWebSocketMessage<IntegrationStopPayload> {
  return createMessage(MessageType.INTEGRATION_STOP, { integrationName });
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
  event: string,
  data: Record<string, unknown>
): IWebSocketMessage<EventNotificationPayload> {
  return createMessage(MessageType.EVENT_NOTIFICATION, { event, data });
}

/**
 * Create a health update message
 */
export function createHealthUpdateMessage(
  payload: HealthUpdatePayload
): IWebSocketMessage<HealthUpdatePayload> {
  return createMessage(MessageType.HEALTH_UPDATE, payload);
}

/**
 * Create an error message
 */
export function createErrorMessage(
  code: string,
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
 * Create a ping message
 */
export function createPingMessage(): IWebSocketMessage<PingPongPayload> {
  return createMessage(MessageType.PING, {});
}

/**
 * Create a pong message
 */
export function createPongMessage(originalMessageId: string): IWebSocketMessage<PingPongPayload> {
  return createMessage(MessageType.PONG, {}, originalMessageId);
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
