/**
 * Integration connection status
 */
export enum IntegrationStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  /** Was connected, but token refresh failed — needs the user to redo the OAuth flow. */
  NEEDS_REAUTH = 'needs_reauth',
}

/**
 * Integration information
 */
export interface IntegrationInfo {
  /** Unique integration name */
  name: string;

  /** Current connection status */
  status: IntegrationStatus;

  /** Timestamp of last successful connection */
  lastConnected?: number;

  /** Error message if status is ERROR or NEEDS_REAUTH */
  errorMessage?: string;

  /** Additional integration-specific metadata */
  metadata?: {
    /** Array of integration names this integration depends on */
    dependencies?: string[];
    [key: string]: unknown;
  };

  /** OAuth capability info, present only if this integration supports OAuth */
  oauth?: {
    /** HTTP callback path this integration's OAuth flow completes on */
    callbackPath: string;
  };
}

/**
 * Integration configuration stored in database
 */
export interface IntegrationConfig {
  /** Unique identifier */
  id: string;

  /** Integration name */
  name: string;

  /** Whether integration is enabled */
  enabled: boolean;

  /** Encrypted configuration data (JSON string) */
  config: string;

  /** Last known status */
  lastStatus: IntegrationStatus;

  /** Last error message */
  lastError?: string;

  /** Timestamp of last connection */
  lastConnectedAt?: number;

  /** Timestamp when config was created */
  createdAt: number;

  /** Timestamp when config was last updated */
  updatedAt: number;
}
