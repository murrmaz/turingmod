import { z } from 'zod';
import type { EventBus } from '../../core/EventBus.js';
import type { IntegrationManager } from '../../integrations/IntegrationManager.js';
import type { Logger } from '../../utils/Logger.js';
import { procedure, router } from './trpc.js';
import { watchable } from './watch.js';

const IntegrationNameSchema = z.strictObject({ integrationName: z.string().min(1) });

/**
 * Starting, stopping and configuring integrations, and every integration's state as it changes.
 * The mutations answer, once they're done, with every integration's state as they left it, so the
 * console that asked can show it at once; every other console gets it through `watch`.
 */
export function createIntegrationsRouter(
  integrationManager: IntegrationManager,
  eventBus: EventBus,
  logger: Logger
) {
  const log = logger.child({ component: 'IntegrationsRouter' });

  // What a mutation changes isn't always a status change: saving OAuth credentials, or turning
  // off an integration that had already stopped, changes only `oauth` or `enabled`.
  const mutated = new Set<() => void>();
  const afterMutation = () => {
    for (const onChange of mutated) {
      onChange();
    }
  };

  const onIntegrationChange = (onChange: () => void) => {
    const unsubscribe = [
      eventBus.on('integration.status', onChange),
      eventBus.on('oauth.completed', onChange),
    ];
    mutated.add(onChange);
    return () => {
      for (const off of unsubscribe) {
        off();
      }
      mutated.delete(onChange);
    };
  };

  const integrations = watchable(() => integrationManager.getAllStatuses(), onIntegrationChange);

  /** Run a mutation, then announce it and answer with the state it left. */
  const mutate = async (work: () => Promise<void>) => {
    try {
      await work();
    } finally {
      afterMutation();
    }
    return integrations.current();
  };

  return router({
    /** Every integration, sent on subscribing and again whenever any of them changes. */
    watch: procedure.subscription(({ signal }) => integrations.watch(signal)),

    /** Turn an integration on, remembering that, and start it. */
    start: procedure.input(IntegrationNameSchema).mutation(({ input }) => {
      log.info(`Starting integration: ${input.integrationName}`);
      return mutate(() => integrationManager.enableIntegration(input.integrationName));
    }),

    /** Turn an integration off, remembering that, and stop it. */
    stop: procedure.input(IntegrationNameSchema).mutation(({ input }) => {
      log.info(`Stopping integration: ${input.integrationName}`);
      return mutate(() => integrationManager.disableIntegration(input.integrationName));
    }),

    /**
     * Save an integration's config. Its fields are checked against that integration's own schema
     * before anything is stored.
     */
    configure: procedure
      .input(
        IntegrationNameSchema.extend({
          /** Encrypted before it's stored */
          config: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(({ input }) => {
        log.info(`Configuring integration: ${input.integrationName}`);
        return mutate(() =>
          integrationManager.configureIntegration(input.integrationName, input.config)
        );
      }),
  });
}
