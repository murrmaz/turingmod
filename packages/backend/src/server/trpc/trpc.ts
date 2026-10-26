import { initTRPC } from '@trpc/server';

/** What every procedure knows about the console calling it. */
export interface TrpcContext {
  /**
   * The console's origin (e.g. `http://localhost:3000`), from its connection's Origin header,
   * which the endpoint's origin check has already allowed; null if it sent none.
   */
  consoleOrigin: string | null;
}

/**
 * The tRPC instance every router is built from. A procedure's input is checked against its Zod
 * schema before the procedure runs, and its output type is what the console's client infers, so
 * one definition is the whole contract for a request.
 */
const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
