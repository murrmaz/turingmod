import type { PermissionLevel } from '../constants/permissions.js';
import type { PlatformCapability, StreamingPlatform } from '../constants/platform.js';

/**
 * Command metadata exposed to clients
 * Derived from code-defined commands at runtime
 */
export interface CommandInfo {
  /** Command name (without ! prefix) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Usage examples */
  usage: string;

  /** Required permission levels */
  permissions: PermissionLevel[];

  /** Cooldown in seconds (0 = no cooldown) */
  cooldown: number;

  /** Platform capabilities this command requires (empty = available on every platform) */
  requiredCapabilities: PlatformCapability[];

  /**
   * The platforms whose capabilities cover `requiredCapabilities`, worked out by the backend
   * from its platform façades, so clients never keep their own copy of each platform's set.
   */
  availableOn: StreamingPlatform[];
}

/**
 * Failures a command reports about its own work. Its `message` is written for the viewer, so
 * chat gets it as a reply.
 */
export type CommandErrorCode =
  /** The arguments were missing or malformed; the message says how to use the command. */
  | 'INVALID_INPUT'
  /** The viewer may run the command, but not this branch of it (e.g. setting rather than reading). */
  | 'ACTION_NOT_PERMITTED'
  /** The platform needs someone to complete or redo OAuth. */
  | 'NOT_AUTHENTICATED'
  /** The platform call failed. */
  | 'API_ERROR'
  /** The command refuses to run from the simulator because it can't be undone. */
  | 'NOT_SIMULATED';

/**
 * Failures CommandExecutor reports about the invocation itself, before or around running the
 * command. Chat gets no reply to these: an unknown `!word` is often meant for another bot.
 */
export const EXECUTOR_ERROR_CODES = [
  'COMMAND_NOT_FOUND',
  'INSUFFICIENT_PERMISSIONS',
  'COMMAND_ON_COOLDOWN',
  /** The command threw instead of returning a result. */
  'EXECUTION_ERROR',
] as const;

export type ExecutorErrorCode = (typeof EXECUTOR_ERROR_CODES)[number];

export function isExecutorErrorCode(code: string): code is ExecutorErrorCode {
  return (EXECUTOR_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * What a command returns. Typed with only `CommandErrorCode` by default, so a command can't
 * report one of the executor's codes and have its reply silenced as if the executor had.
 */
export interface CommandResult<TCode extends string = CommandErrorCode> {
  /** Whether the command succeeded */
  success: boolean;

  /** Message to send back to user/chat */
  message: string;

  /** Optional data returned by the command */
  data?: Record<string, unknown>;

  /** Error details if command failed */
  error?: {
    code: TCode;
    message: string;
    details?: unknown;
  };
}

/** What running a command produced: the command's own result, or the executor's rejection. */
export type ExecutionResult = CommandResult<CommandErrorCode | ExecutorErrorCode>;
