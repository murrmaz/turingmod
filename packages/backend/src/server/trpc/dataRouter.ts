import { TRPCError } from '@trpc/server';
import { DataRowsQuerySchema, messageOf } from '@turingmod/shared';
import type { DataInspector } from '../../database/DataInspector.js';
import { procedure, router } from './trpc.js';

/**
 * The console's read-only Data page. Everything it can read, and what it masks, is decided by
 * DataInspector.
 */
export function createDataRouter(inspector: DataInspector) {
  /**
   * The inspector refuses what it won't read (an unknown table or column) by throwing; that's
   * a bad request from the console, not a failure here.
   */
  const read = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: messageOf(error, 'Failed to read data'),
        cause: error,
      });
    }
  };

  return router({
    /** Every table the page may show, with its columns and row count. */
    listTables: procedure.query(() => read(() => inspector.listTables())),

    /** One page of a table's rows, filtered, searched and sorted. */
    queryRows: procedure
      .input(DataRowsQuerySchema)
      .query(({ input }) => read(() => inspector.queryRows(input))),
  });
}
