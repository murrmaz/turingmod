import type { Platform, PlatformCapability } from '@turingmod/shared';

/**
 * Platform-agnostic stream metadata. Fields the platform has no concept of are omitted.
 */
export interface StreamInfo {
  title: string;
  game?: string; // category/game name where the platform has one
  tags?: string[];
}

/**
 * Platform-agnostic façade over one streaming platform. Implemented by TwitchPlatform and
 * YouTubePlatform, each delegating to that platform's integration trio. Capability-guarded
 * methods are optional; callers must check getCapabilities() (or go through
 * StreamControlService, which does).
 */
export interface IStreamPlatform {
  readonly platform: Platform;

  /** Which PlatformCapabilities this platform currently supports. */
  getCapabilities(): Set<PlatformCapability>;

  /** True if the platform is connected AND currently broadcasting. */
  isLive(): Promise<boolean>;

  /** Post a message to this platform's own chat. Reply routing (Phase 5) uses this. */
  sendChatMessage(message: string): Promise<void>;

  /** Read current stream metadata. Throws if not connected. */
  getStreamInfo(): Promise<StreamInfo>;

  /** Apply metadata changes the platform supports; ignores fields it can't set. */
  setStreamInfo(info: Partial<StreamInfo>): Promise<void>;

  /** Milliseconds the current broadcast has been live, or null if offline. */
  getUptime(): Promise<number | null>;
}
