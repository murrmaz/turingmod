import { type MockInstance, vi } from 'vitest';
import { Logger } from './utils/Logger.js';

type IsAny<X> = 0 extends 1 & X ? true : false;

/** Whether `M` is a mock that says nothing of its signature: a bare `vi.fn()`, returning `any`. */
type IsUntypedMock<M> =
  M extends MockInstance<infer F>
    ? F extends (...args: never) => infer R
      ? IsAny<R>
      : true
    : false;

/**
 * Each member `parts` gives, checked against `T`'s member of that name. A bare `vi.fn()` has no
 * signature to check, so it only has to be a method `T` has; give it one (`vi.fn<Signature>()`, or
 * an implementation) to check that too. A member `T` lacks may be the test's own state (a value),
 * but not a function: that's a method `T` doesn't have, most likely one renamed or removed since
 * the fake was written.
 */
type CheckedParts<T, P> = {
  [K in keyof P]: K extends keyof T
    ? IsUntypedMock<P[K]> extends true
      ? T[K] extends (...args: never) => unknown
        ? P[K]
        : T[K]
      : T[K]
    : P[K] extends (...args: never) => unknown
      ? never
      : P[K];
};

/**
 * Test helper: a stand-in for `T` made of only the members a test needs. Each one is checked against
 * `T`'s own, so a fake whose method was renamed, or no longer takes or returns what the real one
 * does, doesn't compile; a cast (`as unknown as T`) would accept anything. A member left out is
 * undefined, so the code under test fails at once if it uses one. A value `T` doesn't have is
 * allowed, for state the test keeps on the fake (what a fake repository has stored).
 *
 * Name `T`, then give the members: `fake<StreamControlService>()({ announce })`. Split in two because
 * TypeScript infers all of a call's type arguments or none, and `parts` must be inferred to be
 * checked member by member. The result is both: a `T` to hand to the code under test, and `parts`,
 * so a test reads `.mock.calls` on the same object.
 */
export function fake<T extends object>() {
  return <P extends object>(parts: P & CheckedParts<T, P>): T & P => parts as T & P;
}

/**
 * Test helper: a real Logger that writes nothing, with a spy on each method, and whose `child()` is
 * itself, so what a class logs through its child logger is seen too.
 */
export function silentLogger() {
  const logger = new Logger({ level: 'silent' });
  vi.spyOn(logger, 'child').mockReturnValue(logger);
  return Object.assign(logger, {
    error: vi.spyOn(logger, 'error'),
    warn: vi.spyOn(logger, 'warn'),
    info: vi.spyOn(logger, 'info'),
    debug: vi.spyOn(logger, 'debug'),
  });
}
