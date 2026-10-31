import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationStatus, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../core/EventBus.js';
import { IntegrationStateRepository } from '../database/repositories/IntegrationStateRepository.js';
import { Logger } from '../utils/Logger.js';
import { DependencyGraph } from './DependencyGraph.js';
import { DependencyFailurePolicy, type IIntegration } from './interfaces/IIntegration.js';

/**
 * A start refused because a dependency isn't connected. Not a failure: the integration reports
 * BLOCKED, and reconcile() starts it once the dependency connects, if it is still enabled.
 */
class DependencyBlockedError extends Error {}

/**
 * Integration manager
 * Manages lifecycle and state of all integrations
 */
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

  /**
   * Why each integration's stored config failed to load. Such an integration refuses to start
   * until it is given a config that fits, rather than running on its defaults.
   */
  private readonly configErrors = new Map<string, string>();

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
    // An abstract base class has no name; `abstract` is erased, so tsyringe will construct one.
    if (typeof integration.name !== 'string' || integration.name === '') {
      throw new Error(`Integration has no name: ${integration.constructor.name}`);
    }
    if (this.integrations.has(integration.name)) {
      throw new Error(`Integration already registered: ${integration.name}`);
    }
    this.checkGroup(integration);

    this.integrations.set(integration.name, integration);
    this.logger.info(`Registered integration: ${integration.name}`);

    // Forward integration events to event bus
    integration.on('status', (status) => {
      this.eventBus.emitSync('integration.status', {
        name: integration.name,
        status,
      });

      void this.onDependencyStatusChange(integration.name, status);
    });

    // A token rotation isn't a status change, and nothing needs to react to one, so it is only
    // logged: enough to answer "did my token refresh overnight?".
    integration.on('tokenRefreshed', ({ expiresAt }) => {
      this.logger.info(`OAuth token refreshed: ${integration.name}`, {
        ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt).toISOString() }),
      });
    });

    integration.on('failure', (error) => {
      this.logger.error(`Integration error: ${integration.name}`, error);
      this.eventBus.emitSync('integration.error', {
        name: integration.name,
        error,
      });
    });
  }

  /**
   * Refuse a group whose id another group already has. Members refer to their group's one
   * declared object, so two objects with one id are two groups the console would merge.
   */
  private checkGroup(integration: IIntegration): void {
    const group = integration.getGroup();
    if (!group) return;
    for (const other of this.integrations.values()) {
      const otherGroup = other.getGroup();
      if (otherGroup && otherGroup !== group && otherGroup.id === group.id) {
        throw new Error(
          `Integration group id '${group.id}' is declared twice: ${other.name} and ${integration.name} use different groups`
        );
      }
    }
  }

  /**
   * Apply each integration's stored config. This is the one time a stored config is read: after
   * it, the integration holds its config, and configureIntegration() replaces it.
   */
  async loadIntegrations(): Promise<void> {
    this.logger.info('Loading integrations from database');

    const configs = this.stateRepository.findAll();
    this.logger.info(`Found ${configs.length} integration configs`);

    for (const config of configs) {
      const integration = this.integrations.get(config.name);
      if (!integration) {
        this.logger.warn(`Integration not found: ${config.name}`);
        continue;
      }

      if (config.config) {
        try {
          const decryptedConfig = this.stateRepository.getDecryptedConfig(config.name);
          if (decryptedConfig) {
            await integration.initialize(decryptedConfig);
            this.logger.info(`Initialized integration: ${config.name}`);
          }
        } catch (error) {
          // Most often a stored config that no longer fits the integration's schema. The
          // error names the fields, and showing it as the integration's status puts it in
          // front of the streamer rather than only in the log.
          this.logger.error(`Failed to initialize integration: ${config.name}`, error);
          this.configErrors.set(config.name, messageOf(error));
          integration.reportError(messageOf(error));
        }
      }
    }
  }

  /**
   * Start enabled integrations in dependency order
   */
  async startEnabledIntegrations(): Promise<void> {
    this.logger.info('Starting enabled integrations');

    const configs = this.stateRepository.findAllEnabled();
    this.logger.info(`Found ${configs.length} enabled integrations`);

    const enabled = configs.map((c) => c.name).filter((name) => this.integrations.has(name));
    const levels = this.graph.levels(enabled);

    this.logger.info(
      'Integration startup order:',
      levels.map((level) => level.join(', '))
    );

    // Each level depends only on earlier ones, so its members start
    // concurrently; a slow OBS connect doesn't delay Twitch.
    for (const level of levels) {
      await Promise.allSettled(
        level.map((name) =>
          this.startIntegration(name).catch((error) => {
            if (error instanceof DependencyBlockedError) {
              this.logger.info(`${name} waits for its dependencies: ${error.message}`);
              return;
            }
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
      // prerequisite simply isn't connected.
      integration.reportBlocked(blockedReason);
      throw new DependencyBlockedError(blockedReason);
    }

    const configError = this.configErrors.get(name);
    if (configError) {
      integration.reportError(configError);
      throw new Error(configError);
    }

    this.logger.info(`Starting integration: ${name}`);

    try {
      await this.withStartTimeout(name, integration.start());

      // No status is set here: the integration set its own during start().
      this.cascadeStopped.delete(name);
      this.logger.info(`Integration started: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to start integration: ${name}`, error);
      // Integrations normally set ERROR themselves; this covers a start()
      // that threw before doing so.
      integration.reportError(messageOf(error));
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
    for (const dep of integration.getDependencies()) {
      const status = dep.getStatus();
      if (status !== IntegrationStatus.CONNECTED) {
        return `Cannot start ${integration.name}: dependency ${dep.name} is not connected (status: ${status})`;
      }
    }
    return null;
  }

  /**
   * The streamer turning an integration on: remember that, so boot and dependency recovery bring
   * it back, and start it. An unmet dependency isn't an error here: it reports BLOCKED and starts
   * once the dependency connects.
   */
  async enableIntegration(name: string): Promise<void> {
    if (!this.integrations.has(name)) {
      throw new Error(`Integration not found: ${name}`);
    }
    this.stateRepository.setEnabled(name, true);
    try {
      await this.startIntegration(name);
    } catch (error) {
      if (!(error instanceof DependencyBlockedError)) {
        throw error;
      }
    }
  }

  /**
   * The streamer turning an integration off: remember that, so nothing brings it back on its own,
   * and stop it.
   */
  async disableIntegration(name: string): Promise<void> {
    if (!this.integrations.has(name)) {
      throw new Error(`Integration not found: ${name}`);
    }
    this.stateRepository.setEnabled(name, false);
    this.cascadeStopped.delete(name);
    await this.stopIntegration(name);
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
      // The integration sets DISCONNECTED itself.
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

      if (!this.isEnabled(name)) {
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

  private isEnabled(name: string): boolean {
    try {
      const config = this.stateRepository.findByName(name);
      return config?.enabled === true;
    } catch (error) {
      this.logger.error(`Could not read enabled state for ${name}`, error);
      return false;
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
    const dependencies = integration.getDependencies().map((dep) => dep.name);
    const errorMessage = integration.getErrorMessage();
    const group = integration.getGroup();
    const address = integration.getAddress();

    return {
      name: integration.name,
      status: integration.getStatus(),
      enabled: this.isEnabled(integration.name),
      ...(errorMessage ? { errorMessage } : {}),
      metadata: {
        dependencies,
      },
      ...(integration.oauth
        ? {
            oauth: {
              callbackPath: integration.oauth.getCallbackPath(),
              redirectUri: integration.oauth.getRedirectUri(),
              configured: integration.oauth.isConfigured(),
            },
          }
        : {}),
      ...(group ? { group } : {}),
      ...(address === null ? {} : { address }),
    };
  }

  /**
   * Replace an integration's config. It is applied first, which checks it against the
   * integration's schema, so a config that doesn't fit is rejected before anything is stored.
   * An enabled integration is restarted on it, so the change takes effect now; whether it is
   * enabled doesn't change.
   */
  configureIntegration(name: string, config: Record<string, unknown>): Promise<void> {
    const integration = this.integrations.get(name);
    if (!integration) {
      return Promise.reject(new Error(`Integration not found: ${name}`));
    }

    return this.withLifecycleLock(name, async () => {
      this.logger.info(`Configuring integration: ${name}`);
      await integration.initialize(config);
      this.stateRepository.saveConfig(name, config);
      this.configErrors.delete(name);
      this.logger.info(`Integration configured: ${name}`);

      if (!this.isEnabled(name)) {
        return;
      }
      await this.doStop(integration);
      try {
        await this.doStart(integration);
      } catch (error) {
        if (!(error instanceof DependencyBlockedError)) {
          throw error;
        }
      }
    });
  }
}
