import { initTRPC } from '@trpc/server';

/**
 * The tRPC instance every router is built from. A procedure's input is checked against its Zod
 * schema before the procedure runs, and its output type is what the console's client infers, so
 * one definition is the whole contract for a request.
 */
const t = initTRPC.create();

export const router = t.router;
export const procedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
