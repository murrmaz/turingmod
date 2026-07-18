import type {
  CommandExecutePayload,
  CommandListRequestPayload,
  CommandSimulatePayload,
  IntegrationConfigurePayload,
  IntegrationStartPayload,
  IntegrationStopPayload,
  OAuthExchangeCodePayload,
  OAuthGetAuthUrlPayload,
} from '@turingmod/shared';
import { PermissionLevel, Platform } from '@turingmod/shared';

/**
 * Runtime shape checks for inbound WebSocket payloads. The wire format is untyped JSON, so
 * `message.payload` is only as trustworthy as the client that sent it — these guards stop a
 * malformed payload from throwing a raw TypeError deep inside a handler (which MessageRouter
 * would otherwise surface as a generic HANDLER_ERROR with the raw error object attached).
 */

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlatform(value: unknown): value is Platform {
  return value === Platform.TWITCH || value === Platform.YOUTUBE;
}

function isPermissionLevel(value: unknown): value is PermissionLevel {
  return (Object.values(PermissionLevel) as unknown[]).includes(value);
}

export function isCommandExecutePayload(payload: unknown): payload is CommandExecutePayload {
  if (!isPlainObject(payload)) {
    return false;
  }
  const { command, args, context } = payload;
  if (!(isNonEmptyString(command) && isStringArray(args) && isPlainObject(context))) {
    return false;
  }

  const { user, platform, metadata, isSimulation } = context;
  if (!isPlainObject(user)) {
    return false;
  }

  return (
    isNonEmptyString(user.id) &&
    isPlatform(user.platform) &&
    isNonEmptyString(user.platformUserId) &&
    isNonEmptyString(user.username) &&
    isPermissionLevel(user.permissionLevel) &&
    isPlatform(platform) &&
    isPlainObject(metadata) &&
    typeof isSimulation === 'boolean'
  );
}

export function isCommandSimulatePayload(payload: unknown): payload is CommandSimulatePayload {
  if (!isPlainObject(payload)) {
    return false;
  }
  const { commandText, simulatedUser, platform } = payload;
  if (!(isNonEmptyString(commandText) && isPlainObject(simulatedUser) && isPlatform(platform))) {
    return false;
  }

  const { username, permissionLevel, userId } = simulatedUser;
  return (
    isNonEmptyString(username) &&
    isPermissionLevel(permissionLevel) &&
    (userId === undefined || isString(userId))
  );
}

export function isCommandListRequestPayload(
  payload: unknown
): payload is CommandListRequestPayload {
  // The payload itself is optional (CommandHandler.handleList reads message.payload?.platform).
  if (payload === undefined) {
    return true;
  }
  if (!isPlainObject(payload)) {
    return false;
  }
  return payload.platform === undefined || isPlatform(payload.platform);
}

export function isIntegrationStartPayload(payload: unknown): payload is IntegrationStartPayload {
  return isPlainObject(payload) && isNonEmptyString(payload.integrationName);
}

export function isIntegrationStopPayload(payload: unknown): payload is IntegrationStopPayload {
  return isPlainObject(payload) && isNonEmptyString(payload.integrationName);
}

export function isIntegrationConfigurePayload(
  payload: unknown
): payload is IntegrationConfigurePayload {
  return (
    isPlainObject(payload) &&
    isNonEmptyString(payload.integrationName) &&
    isPlainObject(payload.config)
  );
}

export function isOAuthGetAuthUrlPayload(payload: unknown): payload is OAuthGetAuthUrlPayload {
  return isPlainObject(payload) && isNonEmptyString(payload.integrationName);
}

export function isOAuthExchangeCodePayload(payload: unknown): payload is OAuthExchangeCodePayload {
  return (
    isPlainObject(payload) &&
    isNonEmptyString(payload.integrationName) &&
    isNonEmptyString(payload.code)
  );
}
