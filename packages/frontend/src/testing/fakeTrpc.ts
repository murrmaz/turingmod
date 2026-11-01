import { act } from '@testing-library/react';
import type { TrpcClient } from '@/context/trpc-context';

interface SubscriptionHandlers<T> {
  onData: (value: T) => void;
  onError: (error: unknown) => void;
}

/**
 * A subscription procedure (`watch`, `feed`) for the fake client: whoever subscribes receives what
 * the test emits, as they would what the backend sends.
 */
export class FakeSubscription<T> {
  private readonly subscribers = new Set<SubscriptionHandlers<T>>();

  readonly subscribe = (_input: unknown, handlers: SubscriptionHandlers<T>) => {
    this.subscribers.add(handlers);
    return {
      unsubscribe: () => {
        this.subscribers.delete(handlers);
      },
    };
  };

  /** Send a value to every subscriber, rendering what it changes. */
  emit(value: T): void {
    act(() => {
      for (const subscriber of this.subscribers) {
        subscriber.onData(value);
      }
    });
  }

  /** Fail the subscription, as a backend error or a lost stream does. */
  fail(error: unknown): void {
    act(() => {
      for (const subscriber of this.subscribers) {
        subscriber.onError(error);
      }
    });
  }
}

/** A promise the test settles when it chooses, e.g. a mutation's answer. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** What a subscription procedure sends to its subscribers. */
type Sent<Procedure> = Procedure extends {
  subscribe: (input: never, observer: { onData?: (value: infer T) => void }) => unknown;
}
  ? T
  : never;

/** A procedure's fake: a FakeSubscription for a subscription, else `query` or `mutate` as typed. */
type FakeProcedure<Procedure> = Procedure extends { subscribe: unknown }
  ? FakeSubscription<Sent<Procedure>>
  : Procedure;

/**
 * The fakes a test gives the client, by sub-router and procedure, e.g.
 * `{ suggestions: { watch: new FakeSubscription(), delete: { mutate: vi.fn() } } }`. Typed from the
 * router, so a fake that no longer matches its procedure's input or output doesn't compile. Any of
 * them can be left out, and calling one that was throws (see fakeTrpc).
 */
export type Procedures = {
  [Router in keyof TrpcClient & string]?: {
    [Name in keyof TrpcClient[Router]]?: FakeProcedure<TrpcClient[Router][Name]>;
  };
};

/**
 * A tRPC client over these fakes instead of a WebSocket, for TrpcClientProvider. Calling a
 * procedure the test didn't give throws, naming it.
 */
export function fakeTrpc(procedures: Procedures): TrpcClient {
  return over(procedures, []) as TrpcClient;
}

function over(target: object, path: string[]): unknown {
  return new Proxy(target, {
    get(object, key) {
      const value: unknown = Reflect.get(object, key);
      if (typeof key !== 'string') {
        return value;
      }
      if (value === undefined) {
        // Not a thenable: something awaiting the client mustn't call a missing `then`.
        return key === 'then' ? undefined : missing([...path, key]);
      }
      return typeof value === 'object' && value !== null ? over(value, [...path, key]) : value;
    },
  });
}

function missing(path: string[]): unknown {
  return new Proxy(() => undefined, {
    get: (_target, key) =>
      typeof key === 'string' && key !== 'then' ? missing([...path, key]) : undefined,
    apply: () => {
      throw new Error(`The fake tRPC client has no ${path.join('.')}`);
    },
  });
}
