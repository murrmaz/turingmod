import { z } from 'zod';

/**
 * The parts of a failed googleapis call that YouTube's integrations read: gaxios's error for a
 * request that got an answer, or Node's for a connection that never did.
 *
 * Gaxios puts the HTTP status on the error's `response`, and also mirrors it onto `status` on newer
 * errors; Google's own errors may carry it as a numeric `code`, where Node puts a string one
 * (`ECONNRESET`). A field that's absent or another type reads as undefined without hiding the
 * others, and they may be present but undefined (gaxios sets `response` that way), so `.optional()`
 * rather than `.exactOptional()`.
 */
const GoogleErrorSchema = z.object({
  status: z.number().optional().catch(undefined),
  response: z
    .object({ status: z.number().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  code: z.union([z.string(), z.number()]).optional().catch(undefined),
});

/** The HTTP status of a failed request, or undefined when it never got one. */
export function httpStatusOf(error: unknown): number | undefined {
  const parsed = GoogleErrorSchema.safeParse(error);
  if (!parsed.success) {
    return undefined;
  }
  const { response, status, code } = parsed.data;
  return response?.status ?? status ?? (typeof code === 'number' ? code : undefined);
}

/** Node's error code for a failed connection (`ECONNRESET`), or undefined. */
export function connectionErrorCodeOf(error: unknown): string | undefined {
  const parsed = GoogleErrorSchema.safeParse(error);
  return parsed.success && typeof parsed.data.code === 'string' ? parsed.data.code : undefined;
}
