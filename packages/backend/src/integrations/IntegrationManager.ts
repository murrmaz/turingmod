import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import { Logger } from '../utils/Logger.js';
import { DependencyGraph } from './DependencyGraph.js';
import { DependencyFailurePolicy, type IIntegration } from './interfaces/IIntegration.js';

/**
 * Integration manager
 * Manages lifecycle and state of all integrations
 */
@injectable()
@singleton()
export class IntegrationManager {
  private integrations = new Map<string, IIntegration>();

  /**
   * Dependency-graph queries. Built over the live `integrations` map, so it
   * sees everything registered after construction.
   */
  private readonly graph = new DependencyGraph(this.integrations);

  /**
   * Integrations this manager stopped because a dependency became unusable,
   * and which it should therefore bring back once that dependency recovers.
   * Only these are auto-restarted: an integration that failed on its own
   * stays down, so a persistently failing start() can't become a restart loop.
   */
  private readonly cascadeStopped = new Set<string>();

  /** Tail of the serialized chain of reactive dependency work. */
  private dependencyQueue: Promise<void> = Promise.resolve();

  /**
   * Tail of each integration's chain of start/stop calls. Every start and
   * stop goes through it, whoever asked — the console, an OAuth exchange,
   * the dependency queue, shutdown — so a stop never runs against a start()
   * still in flight, or the other way round.
   */
  private readonly lifecycleLocks = new Map<string, Promise<void>>();

  private logger: Logger;

  /**
   * Cap on a single integration's start(). Without one, an integration whose
   * start() never settles (a socket that neither connects nor errors) blocks
   * every integration in a later dependency level, and with it application
   * startup, forever.
   */
  private static readonly START_TIMEOUT_MS = 30 * 1000;

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
      this.eventBus.emitSync('integration.status', {
        name: integration.name,
        status,
      });

      // The integration owns its status; this is the one place it gets
      // persisted. Writing it from startIntegration()/stopIntegration()
      // instead let the stored row disagree with getStatus() — notably by
      // recording CONNECTED for an integration that had set something else
      // during start().
      void this.persistStatus(integration);

      void this.onDependencyStatusChange(integration.name, status);
    });

    // A token rotation isn't a status change, so it gets its own forward.
    // Logged as well as published: that gives it at least one consumer today
    // (answering "did my token refresh overnight?" from the log) rather than
    // leaving another emit with nobody listening.
    integration.on('token-refreshed', (...args: unknown[]) => {
      const { expiresAt } = (args[0] ?? {}) as { expiresAt?: number };
      this.logger.info(`OAuth token refreshed: ${integration.name}`, {
        ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt).toISOString() }),
      });
      this.eventBus.emitSync('integration.tokenRefreshed', {
        name: integration.name,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });
    });

    integration.on('error', (...args: unknown[]) => {
      const error = args[0] as Error;
      this.logger.error(`Integration error: ${integration.name}`, error);
      this.eventBus.emitSync('integration.error', {
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

    const enabled = configs.map((c) => c.name).filter((name) => this.integrations.has(name));
    const levels = this.graph.levels(enabled);

    this.logger.info(
      'Integration startup order:',
      levels.map((level) => level.join(', '))
    );

    // Each level depends only on earlier ones, so its members start
    // concurrently; a slow OBS connect no longer delays Twitch.
    for (const level of levels) {
      await Promise.allSettled(
        level.map((name) =>
          this.startIntegration(name).catch((error) => {
            this.logger.error(`Failed to start integration ${name}, continuing with others`, error);
          })
        )
      );
    }
  }

  /**
   * Check the whole dependency graph: no unregistered dependencies, no
   * cycles. Called once after every integration is registered (setup.ts), so
   * a wiring mistake fails at boot rather than whenever someone happens to
   * enable the integrations involved.
   */
  validateDependencies(): void {
    this.graph.validate();
    this.logger.info('Integration dependency graph validated');
  }

  /**
   * Start a specific integration
   */
  startIntegration(name: string): Promise<void> {
    const integration = this.integrations.get(name);
    if (!integration) {
      return Promise.reject(new Error(`Integration not found: ${name}`));
    }

    // Inside the lock, so the dependency check sees the state left by
    // whatever start or stop ran before it.
    return this.withLifecycleLock(name, () => this.doStart(integration));
  }

  private async doStart(integration: IIntegration): Promise<void> {
    const { name } = integration;
    const blockedReason = this.getBlockedReason(integration);
    if (blockedReason) {
      // Not an error: nothing about this integration is broken, a
      // prerequisite simply isn't connected. reportBlocked() persists via the
      // status listener, so no error row is written for a healthy integration.
      integration.reportBlocked(blockedReason);
      throw new Error(blockedReason);
    }

    this.logger.info(`Starting integration: ${name}`);

    try {
      // Ensure integration is initialized before starting (it may not have been
      // initialized during loadIntegrations if no config existed at that time)
      const savedConfig = await this.stateRepository.getDecryptedConfig(name);
      if (savedConfig) {
        await integration.initialize(savedConfig);
      }

      await this.withStartTimeout(name, integration.start());

      // No status is written here: the integration set its own during
      // start(), and the status listener persisted it.
      this.cascadeStopped.delete(name);
      this.logger.info(`Integration started: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to start integration: ${name}`, error);
      // reportError() persists through the status listener. Integrations
      // normally set ERROR themselves; this covers a start() that threw
      // before doing so, and keeps the stored status consistent either way.
      integration.reportError(error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Run one start or stop of `name` after the ones already asked for have
   * settled. Nothing that holds a lock waits on the dependency queue (status
   * listeners only add to it), so queued work waiting here can't deadlock.
   */
  private withLifecycleLock(name: string, work: () => Promise<void>): Promise<void> {
    const run = (this.lifecycleLocks.get(name) ?? Promise.resolve()).then(work);
    const tail = run.catch(() => {});
    this.lifecycleLocks.set(name, tail);
    void tail.then(() => {
      if (this.lifecycleLocks.get(name) === tail) {
        this.lifecycleLocks.delete(name);
      }
    });
    return run;
  }

  /**
   * Reject if an integration's start() hasn't settled within the timeout. The
   * integration isn't cancelled — nothing in the IIntegration contract can be
   * — but startup stops waiting on it and later dependency levels proceed.
   */
  private async withStartTimeout(name: string, started: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`Timed out after ${IntegrationManager.START_TIMEOUT_MS}ms starting ${name}`)
          ),
        IntegrationManager.START_TIMEOUT_MS
      );
    });

    try {
      await Promise.race([started, timeout]);
    } finally {
      clearTimeout(timer);
      // The losing start() may still reject later; it's already been logged
      // and reported, so swallow it rather than take down the process.
      started.catch(() => {});
    }
  }

  /**
   * Describe the first dependency that isn't connected, or null if the
   * integration is clear to start. Dependencies are node references, so there
   * is no name lookup to fail — validateDependencies() has already confirmed
   * every one of them is registered.
   */
  private getBlockedReason(integration: IIntegration): string | null {
    for (const dep of integration.getDependencies?.() ?? []) {
      const status = dep.getStatus();
      if (status !== IntegrationStatus.CONNECTED) {
        return `Cannot start ${integration.name}: dependency ${dep.name} is not connected (status: ${status})`;
      }
    }
    return null;
  }

  /**
   * Stop a specific integration
   */
  stopIntegration(name: string): Promise<void> {
    const integration = this.integrations.get(name);
    if (!integration) {
      return Promise.reject(new Error(`Integration not found: ${name}`));
    }

    return this.withLifecycleLock(name, () => this.doStop(integration));
  }

  private async doStop(integration: IIntegration): Promise<void> {
    const { name } = integration;
    this.logger.debug(`Stopping integration: ${name}`);

    try {
      await integration.stop();
      // The integration sets DISCONNECTED itself; the status listener persists it.
      this.logger.info(`Integration stopped: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to stop integration: ${name}`, error);
      throw error;
    }
  }

  /**
   * Statuses that make a dependency unusable to anything that depends on it.
   * Previously only NEEDS_REAUTH cascaded, which left dependents running
   * against a dead auth provider when the dependency errored or was stopped
   * by hand from the console.
   */
  private static readonly UNUSABLE_STATUSES: ReadonlySet<IntegrationStatus> = new Set([
    IntegrationStatus.ERROR,
    IntegrationStatus.NEEDS_REAUTH,
    IntegrationStatus.BLOCKED,
    IntegrationStatus.DISCONNECTED,
  ]);

  /**
   * React to one integration's status change on behalf of its dependents:
   * stop them when it becomes unusable, bring the ones we stopped back when
   * it recovers. Together these are the whole dependency policy — the start
   * gate alone only ever checked dependencies at the instant of starting.
   */
  private onDependencyStatusChange(name: string, status: IntegrationStatus): Promise<void> {
    if (IntegrationManager.UNUSABLE_STATUSES.has(status)) {
      return this.enqueue(`cascade from ${name}`, () => this.cascadeFailure(name, status));
    }
    if (status === IntegrationStatus.CONNECTED) {
      return this.enqueue(`reconcile after ${name}`, () => this.reconcile());
    }
    return Promise.resolve();
  }

  /**
   * Run the manager's reactive dependency work one item at a time.
   *
   * Both directions have to share the queue, not just the reconcile passes:
   * a cascade running concurrently with a reconcile pass could call
   * stopIntegration() on an integration whose start() was still in flight,
   * because the dependency checks either side of an await can't hold across
   * it. A start from outside the queue (the console, an OAuth exchange) is
   * kept apart from queued work by the per-integration lifecycle lock in
   * startIntegration()/stopIntegration() instead.
   */
  private enqueue(label: string, work: () => Promise<void>): Promise<void> {
    this.dependencyQueue = this.dependencyQueue.then(() =>
      work().catch((error) => {
        this.logger.error(`Dependency work failed (${label})`, error);
      })
    );
    return this.dependencyQueue;
  }

  /**
   * Handle a dependency becoming unusable, for each integration that
   * (transitively) depends on it, most downstream first.
   *
   * What happens to a dependent is its own choice, via
   * `dependencyFailurePolicy`: STOP tears it down and records it for restart,
   * BLOCK leaves it running and merely reports that it can't act. Neither is
   * right for both kinds — a long-lived listener has to reconnect, while
   * tearing down an API layer discards unrelated state for nothing.
   */
  private async cascadeFailure(name: string, cause: IntegrationStatus): Promise<void> {
    const dependents = this.graph.transitiveDependentsOf(name);
    if (dependents.length === 0) return;

    for (const dependentName of this.graph.stopOrder(dependents)) {
      const dependent = this.integrations.get(dependentName);
      if (!dependent) continue;

      const status = dependent.getStatus();
      // Nothing to do for one that isn't running or has already been told.
      if (status === IntegrationStatus.DISCONNECTED || status === IntegrationStatus.BLOCKED) {
        continue;
      }

      const reason = `${dependentName} cannot act: dependency ${name} is ${cause}`;

      if (dependent.dependencyFailurePolicy === DependencyFailurePolicy.BLOCK) {
        this.logger.warn(`Blocking ${dependentName}: dependency ${name} is ${cause}`);
        // Left running: reconcile() picks it back up off its BLOCKED status,
        // so it doesn't need recording the way a stopped dependent does.
        dependent.reportBlocked(reason);
        continue;
      }

      this.logger.warn(`Stopping ${dependentName}: dependency ${name} is ${cause}`);
      // Recorded before the stop so the DISCONNECTED this triggers can't race
      // a reconcile pass that would otherwise consider it unmanaged.
      this.cascadeStopped.add(dependentName);
      try {
        await this.stopIntegration(dependentName);
      } catch (error) {
        this.logger.error(`Failed to stop ${dependentName}`, error);
      }
    }
  }

  /**
   * Bring back the integrations a dependency failure took out, now that it
   * may be up again. This is what closes the loop after a re-authorization:
   * completing OAuth starts the auth integration, and its CONNECTED recovers
   * the dependents on its own instead of leaving them for the user to
   * restart by hand.
   *
   * Two sources, matching the two policies: the integrations we stopped, and
   * the ones we only blocked. A BLOCKED integration is started rather than
   * just flipped back to CONNECTED, which covers "was running" and "never
   * started" with one path — for a BLOCK-policy integration start() is just
   * resolve-and-report, so it is cheap and idempotent.
   *
   * One attempt each: a failure drops it from the candidates rather than
   * retrying, so this cannot turn a persistently failing start() into a
   * restart loop.
   */
  private async reconcile(): Promise<void> {
    const blocked = [...this.integrations.values()]
      .filter((integration) => integration.getStatus() === IntegrationStatus.BLOCKED)
      .map((integration) => integration.name);

    const candidates = new Set([...this.cascadeStopped, ...blocked]);
    if (candidates.size === 0) return;

    for (const name of this.graph.sort([...candidates])) {
      const integration = this.integrations.get(name);

      if (!integration || integration.getStatus() === IntegrationStatus.CONNECTED) {
        this.cascadeStopped.delete(name);
        continue;
      }

      // Dependencies still aren't back; leave it queued for a later pass.
      if (this.getBlockedReason(integration)) {
        continue;
      }

      if (!(await this.isEnabled(name))) {
        this.cascadeStopped.delete(name);
        continue;
      }

      this.logger.info(`Recovering ${name}: its dependencies are connected again`);
      try {
        await this.startIntegration(name);
      } catch (error) {
        this.logger.error(`Failed to recover ${name}; leaving it down`, error);
        // startIntegration() reported ERROR, so it is no longer a BLOCKED
        // candidate either — one attempt, then it waits for a real event.
        this.cascadeStopped.delete(name);
      }
    }
  }

  private async isEnabled(name: string): Promise<boolean> {
    try {
      const config = await this.stateRepository.findByName(name);
      return config?.enabled === true;
    } catch (error) {
      this.logger.error(`Could not read enabled state for ${name}`, error);
      return false;
    }
  }

  /**
   * Persist an integration's current status. Single writer, driven by the
   * integration's own 'status' event.
   */
  private async persistStatus(integration: IIntegration): Promise<void> {
    try {
      await this.stateRepository.updateStatus(
        integration.name,
        integration.getStatus(),
        integration.getErrorMessage?.()
      );
    } catch (error) {
      this.logger.error(`Failed to persist status for ${integration.name}`, error);
    }
  }

  /**
   * Stop all integrations
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping all integrations');

    // Reverse dependency order, a level at a time: a dependency is never torn
    // down while something still depending on it is running. stopAll() used to
    // stop everything at once, which contradicted the care cascadeFailure()
    // takes with the same graph.
    const levels = this.graph.levels(this.integrations.keys()).reverse();

    for (const level of levels) {
      await Promise.allSettled(
        level.map((name) =>
          this.stopIntegration(name).catch((error) => {
            this.logger.error(`Error stopping ${name}`, error);
          })
        )
      );
    }

    this.logger.info('All integrations stopped');
  }

  /**
   * Get an integration instance by name
   */
  getIntegration(name: string): IIntegration | null {
    return this.integrations.get(name) || null;
  }

  /** Every registered integration, in registration order. */
  getAllIntegrations(): IIntegration[] {
    return [...this.integrations.values()];
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
    return Array.from(this.integrations.values())
      .map((integration) => this.toIntegrationInfo(integration))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Build the wire-format snapshot of an integration's current state
   */
  private toIntegrationInfo(integration: IIntegration): IntegrationInfo {
    const dependencies = (integration.getDependencies?.() ?? []).map((dep) => dep.name);
    const errorMessage = integration.getErrorMessage?.();
    const group = integration.getGroup?.();

    return {
      name: integration.name,
      status: integration.getStatus(),
      ...(errorMessage ? { errorMessage } : {}),
      metadata: {
        dependencies,
      },
      ...(integration.oauth
        ? {
            oauth: {
              callbackPath: integration.oauth.getCallbackPath(),
              redirectUri: integration.oauth.getRedirectUri(),
            },
          }
        : {}),
      ...(group ? { group } : {}),
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
