import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import type { EventBus } from '../core/EventBus.js';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import type { Logger } from '../utils/Logger.js';
import type { IIntegration } from './interfaces/IIntegration.js';
import type { IOAuthIntegration } from './interfaces/IOAuthIntegration.js';

/**
 * Integration manager
 * Manages lifecycle and state of all integrations
 */
export class IntegrationManager {
  private integrations = new Map<string, IIntegration>();
  private logger: Logger;

  constructor(
    private stateRepository: IntegrationStateRepository,
    private eventBus: EventBus,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'IntegrationManager' });
  }

  /**
   * Register an integration
   */
  register(integration: IIntegration): void {
    if (this.integrations.has(integration.name)) {
      throw new Error(`Integration already registered: ${integration.name}`);
    }

    if (integration.oauth) {
      const path = integration.oauth.getCallbackPath();
      const conflict = Array.from(this.integrations.values()).find(
        (existing) => existing.oauth?.getCallbackPath() === path
      );
      if (conflict) {
        throw new Error(
          `OAuth callback path conflict: '${path}' is claimed by both '${conflict.name}' and '${integration.name}'`
        );
      }
    }

    this.integrations.set(integration.name, integration);
    this.logger.info(`Registered integration: ${integration.name}`);

    // Forward integration events to event bus
    integration.on('status', (...args: unknown[]) => {
      const status = args[0] as IntegrationStatus;
      this.eventBus.emitSync('integration:status', {
        name: integration.name,
        status,
      });
    });

    integration.on('error', (...args: unknown[]) => {
      const error = args[0] as Error;
      this.logger.error(`Integration error: ${integration.name}`, error);
      this.eventBus.emitSync('integration:error', {
        name: integration.name,
        error,
      });
    });
  }

  /**
   * Load integrations from database
   */
  async loadIntegrations(): Promise<void> {
    this.logger.info('Loading integrations from database');

    const configs = await this.stateRepository.findAll();
    this.logger.info(`Found ${configs.length} integration configs`);

    for (const config of configs) {
      const integration = this.integrations.get(config.name);
      if (!integration) {
        this.logger.warn(`Integration not found: ${config.name}`);
        continue;
      }

      if (config.config) {
        try {
          const decryptedConfig = await this.stateRepository.getDecryptedConfig(config.name);
          if (decryptedConfig) {
            await integration.initialize(decryptedConfig);
            this.logger.info(`Initialized integration: ${config.name}`);
          }
        } catch (error) {
          this.logger.error(`Failed to initialize integration: ${config.name}`, error);
        }
      }
    }
  }

  /**
   * Start enabled integrations in dependency order
   */
  async startEnabledIntegrations(): Promise<void> {
    this.logger.info('Starting enabled integrations');

    const configs = await this.stateRepository.findAllEnabled();
    this.logger.info(`Found ${configs.length} enabled integrations`);

    // Build dependency graph and sort
    const sorted = this.topologicalSort(configs.map((c) => c.name));

    this.logger.info('Integration startup order:', sorted);

    // Start in dependency order
    for (const name of sorted) {
      const config = configs.find((c) => c.name === name);
      if (config) {
        try {
          await this.startIntegration(name);
        } catch (error) {
          this.logger.error(`Failed to start integration ${name}, continuing with others`, error);
          // Continue with other integrations even if one fails
        }
      }
    }
  }

  /**
   * Topological sort of integrations based on dependencies
   * Returns array of integration names in startup order (dependencies first)
   */
  private topologicalSort(names: string[]): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving ${name}`);
      }

      visiting.add(name);

      // Visit dependencies first
      const integration = this.integrations.get(name);
      if (integration?.getDependencies) {
        const deps = integration.getDependencies();
        for (const dep of deps) {
          if (names.includes(dep)) {
            visit(dep);
          }
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(name);
    };

    // Visit all nodes
    for (const name of names) {
      visit(name);
    }

    return sorted;
  }

  /**
   * Start a specific integration
   */
  async startIntegration(name: string): Promise<void> {
    const integration = this.integrations.get(name);
    if (!integration) {
      throw new Error(`Integration not found: ${name}`);
    }

    // Check dependencies
    if (integration.getDependencies) {
      const deps = integration.getDependencies();
      for (const dep of deps) {
        const depIntegration = this.integrations.get(dep);
        if (!depIntegration) {
          throw new Error(`Dependency not found: ${dep} (required by ${name})`);
        }
        if (depIntegration.getStatus() !== IntegrationStatus.CONNECTED) {
          throw new Error(
            `Cannot start ${name}: dependency ${dep} is not connected (status: ${depIntegration.getStatus()})`
          );
        }
      }
    }

    this.logger.info(`Starting integration: ${name}`);

    try {
      // Ensure integration is initialized before starting (it may not have been
      // initialized during loadIntegrations if no config existed at that time)
      const savedConfig = await this.stateRepository.getDecryptedConfig(name);
      if (savedConfig) {
        await integration.initialize(savedConfig);
      }

      await integration.start();
      await this.stateRepository.updateStatus(name, IntegrationStatus.CONNECTED);
      this.logger.info(`Integration started: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to start integration: ${name}`, error);
      await this.stateRepository.updateStatus(
        name,
        IntegrationStatus.ERROR,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Stop a specific integration
   */
  async stopIntegration(name: string): Promise<void> {
    const integration = this.integrations.get(name);
    if (!integration) {
      throw new Error(`Integration not found: ${name}`);
    }

    this.logger.info(`Stopping integration: ${name}`);

    try {
      await integration.stop();
      await this.stateRepository.updateStatus(name, IntegrationStatus.DISCONNECTED);
      this.logger.info(`Integration stopped: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to stop integration: ${name}`, error);
      throw error;
    }
  }

  /**
   * Stop all integrations
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping all integrations');

    const promises: Promise<void>[] = [];
    for (const integration of this.integrations.values()) {
      promises.push(
        this.stopIntegration(integration.name).catch((error) => {
          this.logger.error(`Error stopping ${integration.name}`, error);
        })
      );
    }

    await Promise.allSettled(promises);
    this.logger.info('All integrations stopped');
  }

  /**
   * Get an integration instance by name
   */
  getIntegration(name: string): IIntegration | null {
    return this.integrations.get(name) || null;
  }

  /**
   * Get the OAuth callback path for every OAuth-capable registered
   * integration. register() already guarantees paths are unique, so callers
   * (e.g. HttpServer) get plain routing data instead of live integration
   * instances they have no business holding onto.
   */
  getOAuthCallbackRoutes(): Array<{ path: string; integrationName: string }> {
    const routes: Array<{ path: string; integrationName: string }> = [];

    for (const integration of this.integrations.values()) {
      if (integration.oauth) {
        routes.push({
          path: integration.oauth.getCallbackPath(),
          integrationName: integration.name,
        });
      }
    }

    return routes;
  }

  /**
   * Look up an integration and confirm it supports the OAuth flow
   */
  private getOAuthIntegration(name: string): IOAuthIntegration {
    const integration = this.integrations.get(name);
    if (!integration) {
      throw new Error(`Integration not found: ${name}`);
    }

    if (!integration.oauth) {
      throw new Error(`Integration does not support OAuth: ${name}`);
    }

    return integration.oauth;
  }

  /**
   * Build the OAuth authorization URL for an integration, resolving config
   * from previously-saved (database) credentials and falling back to
   * environment variables for first-time setup. Required scopes always come
   * from the integration itself, never the caller.
   */
  async getOAuthAuthorizationUrl(name: string): Promise<string> {
    const integration = this.getOAuthIntegration(name);
    const config = await this.resolveOAuthConfig(integration, name);
    return integration.getAuthorizationUrl(config);
  }

  /**
   * Exchange an OAuth authorization code for tokens, then enable and start
   * the integration.
   */
  async completeOAuthExchange(name: string, code: string): Promise<void> {
    const integration = this.getOAuthIntegration(name);
    await integration.exchangeCode(code);
    await this.stateRepository.updateEnabled(name, true);
    await this.startIntegration(name);
  }

  /**
   * Resolve the config needed to build an authorization URL: prefer
   * previously-saved (database) credentials, falling back to environment
   * variables for first-time setup.
   */
  private async resolveOAuthConfig(
    integration: IOAuthIntegration,
    name: string
  ): Promise<Record<string, unknown>> {
    try {
      const decryptedConfig = await this.stateRepository.getDecryptedConfig(name);
      if (decryptedConfig?.clientId && decryptedConfig.clientSecret) {
        this.logger.info(`Loaded ${name} credentials from database`);
        return { ...decryptedConfig, scopes: integration.getRequiredScopes() };
      }
    } catch (error) {
      this.logger.warn(`Could not load ${name} config from database`, error);
    }

    this.logger.info(`Falling back to environment variables for ${name}`);
    return integration.getEnvConfig();
  }

  /**
   * Get integration status
   */
  getStatus(name: string): IntegrationInfo | null {
    const integration = this.integrations.get(name);
    if (!integration) {
      return null;
    }

    return this.toIntegrationInfo(integration);
  }

  /**
   * Get all integration statuses
   */
  getAllStatuses(): IntegrationInfo[] {
    return Array.from(this.integrations.values()).map((integration) =>
      this.toIntegrationInfo(integration)
    );
  }

  /**
   * Build the wire-format snapshot of an integration's current state
   */
  private toIntegrationInfo(integration: IIntegration): IntegrationInfo {
    const dependencies = integration.getDependencies?.() || [];
    const errorMessage = integration.getErrorMessage?.();

    return {
      name: integration.name,
      status: integration.getStatus(),
      ...(errorMessage ? { errorMessage } : {}),
      metadata: {
        dependencies,
      },
      ...(integration.oauth
        ? { oauth: { callbackPath: integration.oauth.getCallbackPath() } }
        : {}),
    };
  }

  /**
   * Configure an integration
   */
  async configureIntegration(
    name: string,
    config: Record<string, unknown>,
    enabled: boolean
  ): Promise<void> {
    const integration = this.integrations.get(name);
    if (!integration) {
      throw new Error(`Integration not found: ${name}`);
    }

    this.logger.info(`Configuring integration: ${name}`);

    // Save configuration
    await this.stateRepository.upsert(name, config, enabled);

    // Initialize with new configuration
    await integration.initialize(config);

    this.logger.info(`Integration configured: ${name}`);
  }
}
