/**
 * Generate a simple UUID v4
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
/**
 * All possible message types
 */
export var MessageType;
(function (MessageType) {
    // Client → Server: Commands
    MessageType["COMMAND_EXECUTE"] = "command.execute";
    MessageType["COMMAND_SIMULATE"] = "command.simulate";
    // Server → Client: Command responses
    MessageType["COMMAND_RESULT"] = "command.result";
    MessageType["COMMAND_LIST"] = "command.list";
    // Client → Server: Integration control
    MessageType["INTEGRATION_START"] = "integration.start";
    MessageType["INTEGRATION_STOP"] = "integration.stop";
    MessageType["INTEGRATION_CONFIGURE"] = "integration.configure";
    MessageType["INTEGRATION_STATUS_REQUEST"] = "integration.status.request";
    // Server → Client: Integration updates
    MessageType["INTEGRATION_STATUS"] = "integration.status";
    MessageType["INTEGRATION_LIST"] = "integration.list";
    // Server → Client: Event notifications
    MessageType["EVENT_NOTIFICATION"] = "event.notification";
    // Server → Client: Health updates
    MessageType["HEALTH_UPDATE"] = "health.update";
    // Server → Client: Errors
    MessageType["ERROR"] = "error";
    // OAuth Flow
    MessageType["OAUTH_GET_AUTH_URL"] = "oauth.getAuthUrl";
    MessageType["OAUTH_AUTH_URL_RESPONSE"] = "oauth.authUrlResponse";
    MessageType["OAUTH_EXCHANGE_CODE"] = "oauth.exchangeCode";
    MessageType["OAUTH_EXCHANGE_RESULT"] = "oauth.exchangeResult";
    MessageType["OAUTH_CODE_RECEIVED"] = "oauth.codeReceived";
    // Bidirectional: Connection health
    MessageType["PING"] = "ping";
    MessageType["PONG"] = "pong";
})(MessageType || (MessageType = {}));
// ============================================================================
// Message Creators (Type-safe helpers)
// ============================================================================
/**
 * Create a WebSocket message with type inference
 */
export function createMessage(type, payload, id) {
    return {
        id: id ?? generateUUID(),
        type,
        timestamp: Date.now(),
        payload,
    };
}
/**
 * Create a command execute message
 */
export function createCommandExecuteMessage(payload) {
    return createMessage(MessageType.COMMAND_EXECUTE, payload);
}
/**
 * Create a command simulate message
 */
export function createCommandSimulateMessage(payload) {
    return createMessage(MessageType.COMMAND_SIMULATE, payload);
}
/**
 * Create a command result message
 */
export function createCommandResultMessage(payload, originalMessageId) {
    return createMessage(MessageType.COMMAND_RESULT, payload, originalMessageId);
}
/**
 * Create an integration start message
 */
export function createIntegrationStartMessage(integrationName) {
    return createMessage(MessageType.INTEGRATION_START, { integrationName });
}
/**
 * Create an integration stop message
 */
export function createIntegrationStopMessage(integrationName) {
    return createMessage(MessageType.INTEGRATION_STOP, { integrationName });
}
/**
 * Create an integration status message
 */
export function createIntegrationStatusMessage(integration) {
    return createMessage(MessageType.INTEGRATION_STATUS, { integration });
}
/**
 * Create an event notification message
 */
export function createEventNotificationMessage(event, data) {
    return createMessage(MessageType.EVENT_NOTIFICATION, { event, data });
}
/**
 * Create a health update message
 */
export function createHealthUpdateMessage(payload) {
    return createMessage(MessageType.HEALTH_UPDATE, payload);
}
/**
 * Create an error message
 */
export function createErrorMessage(code, message, originalMessageId, details) {
    const payload = { code, message };
    if (originalMessageId !== undefined) {
        payload.originalMessageId = originalMessageId;
    }
    if (details !== undefined) {
        payload.details = details;
    }
    return createMessage(MessageType.ERROR, payload);
}
/**
 * Create a ping message
 */
export function createPingMessage() {
    return createMessage(MessageType.PING, {});
}
/**
 * Create a pong message
 */
export function createPongMessage(originalMessageId) {
    return createMessage(MessageType.PONG, {}, originalMessageId);
}
/**
 * Create an OAuth get auth URL message
 */
export function createOAuthGetAuthUrlMessage(integrationName) {
    return createMessage(MessageType.OAUTH_GET_AUTH_URL, { integrationName });
}
/**
 * Create an OAuth auth URL response message
 */
export function createOAuthAuthUrlResponseMessage(integrationName, authUrl, originalMessageId) {
    return createMessage(MessageType.OAUTH_AUTH_URL_RESPONSE, { integrationName, authUrl }, originalMessageId);
}
/**
 * Create an OAuth exchange code message
 */
export function createOAuthExchangeCodeMessage(integrationName, code) {
    return createMessage(MessageType.OAUTH_EXCHANGE_CODE, { integrationName, code });
}
/**
 * Create an OAuth exchange result message
 */
export function createOAuthExchangeResultMessage(integrationName, success, errorMessage, originalMessageId) {
    const payload = { integrationName, success };
    if (errorMessage !== undefined) {
        payload.errorMessage = errorMessage;
    }
    return createMessage(MessageType.OAUTH_EXCHANGE_RESULT, payload, originalMessageId);
}
/**
 * Create an OAuth code received message
 */
export function createOAuthCodeReceivedMessage(integrationName, code) {
    return createMessage(MessageType.OAUTH_CODE_RECEIVED, { integrationName, code });
}
//# sourceMappingURL=messages.js.map