/**
 * A client built on an auth object (a Twurple auth provider, a Google OAuth2 client), kept until
 * that object is replaced.
 *
 * An auth integration makes a new auth object each time it starts, so a client captured once
 * would keep calling through credentials that can no longer refresh, silently, until its access
 * token aged out. Asking the cache on every access, with the auth integration's *current* object,
 * means that stale client can't exist: a different object is a new grant, and the client is
 * rebuilt on it. That is why the auth integrations' accessors must return a stable instance:
 * a fresh object per call would rebuild the client on every access.
 */
export class ClientCache<TAuth extends object, TClient> {
  private current: { auth: TAuth; client: TClient } | null = null;

  /**
   * @param build Makes a client on an auth object.
   * @param onRebuild Called when the auth object is replaced and the client rebuilt, not when
   *   the first one is built or after clear().
   */
  constructor(
    private readonly build: (auth: TAuth) => TClient,
    private readonly onRebuild: () => void = () => undefined
  ) {}

  /** The client built on `auth`, building it if the cached one was built on another. */
  get(auth: TAuth): TClient {
    if (this.current?.auth === auth) {
      return this.current.client;
    }
    if (this.current) {
      this.onRebuild();
    }
    this.current = { auth, client: this.build(auth) };
    return this.current.client;
  }

  /** Forget the client. Safe to call when none was ever built. */
  clear(): void {
    this.current = null;
  }
}
