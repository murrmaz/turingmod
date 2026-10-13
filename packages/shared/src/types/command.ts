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
 * Context passed to command during execution
 */
export interface CommandContext {
  /** User executing the command */
  user: {
    id: string;
    platform: StreamingPlatform;
    platformUserId: string;
    username: string;
    permissionLevel: PermissionLevel;
  };

  /** Command arguments (parsed from command text) */
  args: string[];

  /** Platform where command was executed */
  platform: StreamingPlatform;

  /** Additional platform-specific metadata */
  metadata: Record<string, unknown>;

  /** Whether this is a simulated command */
  isSimulation: boolean;
}

/**
 * Result of command execution
 */
export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;

  /** Message to send back to user/chat */
  message: string;

  /** Optional data returned by the command */
  data?: Record<string, unknown>;

  /** Error details if command failed */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
