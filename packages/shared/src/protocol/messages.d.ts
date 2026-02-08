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
export declare enum MessageType {
    COMMAND_EXECUTE = "command.execute",
    COMMAND_SIMULATE = "command.simulate",
    COMMAND_RESULT = "command.result",
    COMMAND_LIST = "command.list",
    INTEGRATION_START = "integration.start",
    INTEGRATION_STOP = "integration.stop",
    INTEGRATION_CONFIGURE = "integration.configure",
    INTEGRATION_STATUS_REQUEST = "integration.status.request",
    INTEGRATION_STATUS = "integration.status",
    INTEGRATION_LIST = "integration.list",
    EVENT_NOTIFICATION = "event.notification",
    HEALTH_UPDATE = "health.update",
    ERROR = "error",
    OAUTH_GET_AUTH_URL = "oauth.getAuthUrl",
    OAUTH_AUTH_URL_RESPONSE = "oauth.authUrlResponse",
    OAUTH_EXCHANGE_CODE = "oauth.exchangeCode",
    OAUTH_EXCHANGE_RESULT = "oauth.exchangeResult",
    OAUTH_CODE_RECEIVED = "oauth.codeReceived",// Server → Client: OAuth code captured from callback
    PING = "ping",
    PONG = "pong"
}
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
 * Integration status request payload
 */
export interface IntegrationStatusRequestPayload {
    /** Optional: specific integration name, or omit for all */
    integrationName?: string;
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
/**
 * Create a WebSocket message with type inference
 */
export declare function createMessage<T>(type: MessageType, payload: T, id?: string): IWebSocketMessage<T>;
/**
 * Create a command execute message
 */
export declare function createCommandExecuteMessage(payload: CommandExecutePayload): IWebSocketMessage<CommandExecutePayload>;
/**
 * Create a command simulate message
 */
export declare function createCommandSimulateMessage(payload: CommandSimulatePayload): IWebSocketMessage<CommandSimulatePayload>;
/**
 * Create a command result message
 */
export declare function createCommandResultMessage(payload: CommandResultPayload, originalMessageId: string): IWebSocketMessage<CommandResultPayload>;
/**
 * Create an integration start message
 */
export declare function createIntegrationStartMessage(integrationName: string): IWebSocketMessage<IntegrationStartPayload>;
/**
 * Create an integration stop message
 */
export declare function createIntegrationStopMessage(integrationName: string): IWebSocketMessage<IntegrationStopPayload>;
/**
 * Create an integration status message
 */
export declare function createIntegrationStatusMessage(integration: IntegrationInfo): IWebSocketMessage<IntegrationStatusPayload>;
/**
 * Create an event notification message
 */
export declare function createEventNotificationMessage(event: string, data: Record<string, unknown>): IWebSocketMessage<EventNotificationPayload>;
/**
 * Create a health update message
 */
export declare function createHealthUpdateMessage(payload: HealthUpdatePayload): IWebSocketMessage<HealthUpdatePayload>;
/**
 * Create an error message
 */
export declare function createErrorMessage(code: string, message: string, originalMessageId?: string, details?: unknown): IWebSocketMessage<ErrorPayload>;
/**
 * Create a ping message
 */
export declare function createPingMessage(): IWebSocketMessage<PingPongPayload>;
/**
 * Create a pong message
 */
export declare function createPongMessage(originalMessageId: string): IWebSocketMessage<PingPongPayload>;
/**
 * Create an OAuth get auth URL message
 */
export declare function createOAuthGetAuthUrlMessage(integrationName: string): IWebSocketMessage<OAuthGetAuthUrlPayload>;
/**
 * Create an OAuth auth URL response message
 */
export declare function createOAuthAuthUrlResponseMessage(integrationName: string, authUrl: string, originalMessageId: string): IWebSocketMessage<OAuthAuthUrlResponsePayload>;
/**
 * Create an OAuth exchange code message
 */
export declare function createOAuthExchangeCodeMessage(integrationName: string, code: string): IWebSocketMessage<OAuthExchangeCodePayload>;
/**
 * Create an OAuth exchange result message
 */
export declare function createOAuthExchangeResultMessage(integrationName: string, success: boolean, errorMessage: string | undefined, originalMessageId: string): IWebSocketMessage<OAuthExchangeResultPayload>;
/**
 * Create an OAuth code received message
 */
export declare function createOAuthCodeReceivedMessage(integrationName: string, code: string): IWebSocketMessage<OAuthCodeReceivedPayload>;
//# sourceMappingURL=messages.d.ts.map