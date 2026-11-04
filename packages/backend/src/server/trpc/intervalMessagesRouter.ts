import { IntervalMessageTextSchema } from '@turingmod/shared';
import { z } from 'zod';
import type { EventBus } from '../../core/EventBus.js';
import type { IntervalMessages } from '../../features/chat/announcements/IntervalMessages.js';
import { procedure, router } from './trpc.js';
import { watchable } from './watch.js';

const MessageIdSchema = z.int().positive();

/**
 * The interval messages, for the console's Interval Messages page. Every mutation answers with the
 * rotation it left, so the console that asked can show it at once; every other console gets it
 * through `watch`.
 */
export function createIntervalMessagesRouter(messages: IntervalMessages, eventBus: EventBus) {
  const rotation = watchable(
    () => messages.rotation(),
    (onChange) => eventBus.on('intervalMessages.changed', onChange)
  );

  return router({
    /** The messages and which is next, sent on subscribing and again whenever they change. */
    watch: procedure.subscription(({ signal }) => rotation.watch(signal)),

    /** Add a message to the end of the rotation. */
    add: procedure
      .input(z.strictObject({ message: IntervalMessageTextSchema }))
      .mutation(({ input }) => {
        messages.add(input.message);
        return rotation.current();
      }),

    /** Replace a message's text, keeping its place. */
    update: procedure
      .input(z.strictObject({ id: MessageIdSchema, message: IntervalMessageTextSchema }))
      .mutation(({ input }) => {
        messages.updateText(input.id, input.message);
        return rotation.current();
      }),

    /** Pause a message, or put it back in the rotation. */
    setEnabled: procedure
      .input(z.strictObject({ id: MessageIdSchema, enabled: z.boolean() }))
      .mutation(({ input }) => {
        messages.setEnabled(input.id, input.enabled);
        return rotation.current();
      }),

    /** Swap a message with its neighbour in the rotation. */
    move: procedure
      .input(z.strictObject({ id: MessageIdSchema, direction: z.enum(['up', 'down']) }))
      .mutation(({ input }) => {
        messages.move(input.id, input.direction);
        return rotation.current();
      }),

    /** Delete these messages; ones already gone are skipped. */
    delete: procedure
      .input(z.strictObject({ ids: z.array(MessageIdSchema).min(1) }))
      .mutation(({ input }) => {
        messages.remove(input.ids);
        return rotation.current();
      }),
  });
}
