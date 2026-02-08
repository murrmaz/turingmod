import { IntegrationStatus } from '@turingmod/shared';
import type { IntegrationInfo } from '@turingmod/shared';
import type { EventBus } from '../core/EventBus.js';
import type { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import type { Logger } from '../utils/Logger.js';
import type { IIntegration } from './interfaces/IIntegration.js';

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
      await this.stateRepository.updateStatus(name, 'connected');
      this.logger.info(`Integration started: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to start integration: ${name}`, error);
      await this.stateRepository.updateStatus(
        name,
        'error',
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
      await this.stateRepository.updateStatus(name, 'disconnected');
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
   * Get integration status
   */
  getStatus(name: string): IntegrationInfo | null {
    const integration = this.integrations.get(name);
    if (!integration) {
      return null;
    }

    const dependencies = integration.getDependencies?.() || [];

    const errorMessage = integration.getErrorMessage?.();

    return {
      name: integration.name,
      status: integration.getStatus(),
      ...(errorMessage ? { errorMessage } : {}),
      metadata: {
        dependencies,
      },
    };
  }

  /**
   * Get all integration statuses
   */
  getAllStatuses(): IntegrationInfo[] {
    return Array.from(this.integrations.values()).map((integration) => {
      const dependencies = integration.getDependencies?.() || [];
      const errorMessage = integration.getErrorMessage?.();

      return {
        name: integration.name,
        status: integration.getStatus(),
        ...(errorMessage ? { errorMessage } : {}),
        metadata: {
          dependencies,
        },
      };
    });
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
