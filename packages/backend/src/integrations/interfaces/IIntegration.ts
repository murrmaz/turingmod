import type { IntegrationStatus } from '@turingmod/shared';
import type { IOAuthIntegration } from './IOAuthIntegration.js';

/**
 * Integration interface
 * All platform integrations must implement this interface
 */
export interface IIntegration {
  /** Unique integration name */
  readonly name: string;

  /** Integration version */
  readonly version: string;

  /**
   * This integration's OAuth capability view, or null if it doesn't support
   * OAuth. Callers narrow with a plain `if (integration.oauth)` check instead
   * of a runtime type guard.
   */
  readonly oauth: IOAuthIntegration | null;

  /**
   * Initialize the integration with configuration
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Start the integration
   */
  start(): Promise<void>;

  /**
   * Stop the integration
   */
  stop(): Promise<void>;

  /**
   * Get current status
   */
  getStatus(): IntegrationStatus;

  /**
   * Subscribe to integration events
   */
  on(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * Unsubscribe from integration events
   */
  off(event: string, handler: (...args: unknown[]) => void): void;

  /**
   * Get integration dependencies (optional)
   * Returns array of integration names that must be connected before this integration can start
   * @returns Array of integration names, or undefined if no dependencies
   */
  getDependencies?(): string[];

  /**
   * Get error message if status is ERROR (optional)
   * @returns Error message string, or undefined if no error
   */
  getErrorMessage?(): string | undefined;
}
