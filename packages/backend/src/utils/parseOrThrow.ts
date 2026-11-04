import { z } from 'zod';

/** Parse `value`, or throw `what` followed by every field that was wrong. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${what}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
