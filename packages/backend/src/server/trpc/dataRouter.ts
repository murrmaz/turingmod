import { TRPCError } from '@trpc/server';
import {
  type DataInspector,
  DataRefusedError,
  DataRowsQuerySchema,
} from '../../database/DataInspector.js';
import { procedure, router } from './trpc.js';

/**
 * The console's read-only Data page. Everything it can read, and what it masks, is decided by
 * DataInspector.
 */
export function createDataRouter(inspector: DataInspector) {
  /**
   * What the inspector refuses (an unknown table or column) is a bad request from the console.
   * Anything else, such as a corrupt database, is a read failing, and is logged as one.
   */
  const read = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof DataRefusedError) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
      }
      throw error;
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
