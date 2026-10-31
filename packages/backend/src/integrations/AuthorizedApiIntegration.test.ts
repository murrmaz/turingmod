import 'reflect-metadata';
import { type IntegrationGroup, IntegrationStatus } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { AuthorizedApiIntegration } from './AuthorizedApiIntegration.js';
import { DependencyFailurePolicy, type IIntegration } from './interfaces/IIntegration.js';

const GROUP: IntegrationGroup = { id: 'fake', label: 'Fake' };

/** An auth integration whose status, and whether it has credentials, the test sets. */
class FakeAuth {
  readonly name = 'fake-auth';
  status = IntegrationStatus.CONNECTED;
  credentials: object | null = {};
  getStatus = () => this.status;
  getGroup = () => GROUP;
}

interface FakeClient {
  credentials: object;
}

/** The smallest AuthorizedApiIntegration: a client per credentials object, and failures recorded. */
class FakeApi extends AuthorizedApiIntegration<FakeAuth & IIntegration, FakeClient> {
  readonly name = 'fake-api';
  forgotten = 0;
  readonly onRequestFailureSpy = vi.fn();

  constructor(auth: FakeAuth) {
    super(new Logger({ level: 'silent' }), 'Fake', auth as FakeAuth & IIntegration);
  }

  protected resolveClient(): FakeClient | null {
    return this.auth.credentials ? { credentials: this.auth.credentials } : null;
  }

  protected override forgetClient(): void {
    this.forgotten++;
  }

  protected override onRequestFailure<T>(error: unknown, retry: () => Promise<T>): Promise<T> {
    return this.onRequestFailureSpy(error, retry) ?? super.onRequestFailure(error, retry);
  }
}

function setup() {
  const auth = new FakeAuth();
  return { auth, api: new FakeApi(auth) };
}

describe('AuthorizedApiIntegration', () => {
  it('blocks on its auth integration and sits in its group', () => {
    const { auth, api } = setup();

    expect(api.dependencyFailurePolicy).toBe(DependencyFailurePolicy.BLOCK);
    expect(api.getDependencies()).toEqual([auth]);
    expect(api.getGroup()).toBe(GROUP);
  });

  it('connects when auth is connected and has credentials', async () => {
    const { api } = setup();

    await api.start();

    expect(api.getStatus()).toBe(IntegrationStatus.CONNECTED);
  });

  it('fails to start while auth is not connected, naming it', async () => {
    const { auth, api } = setup();
    auth.status = IntegrationStatus.NEEDS_REAUTH;

    await expect(api.start()).rejects.toThrow(
      'fake-auth must be connected before fake-api can start'
    );
    expect(api.getStatus()).toBe(IntegrationStatus.ERROR);
  });

  it('fails to start when connected auth has no credentials to build on', async () => {
    const { auth, api } = setup();
    auth.credentials = null;

    await expect(api.start()).rejects.toThrow();
    expect(api.getStatus()).toBe(IntegrationStatus.ERROR);
  });

  it('refuses to call, and drops its client, while auth is not connected', async () => {
    const { auth, api } = setup();
    await api.start();
    auth.status = IntegrationStatus.NEEDS_REAUTH;
    const call = vi.fn();

    await expect(api.request(call)).rejects.toThrow('Fake is not connected');
    expect(call).not.toHaveBeenCalled();
    expect(api.forgotten).toBe(1);
    // Refusing isn't a failed call, so there is nothing for the subclass to react to.
    expect(api.onRequestFailureSpy).not.toHaveBeenCalled();
  });

  it('rethrows a failed call by default', async () => {
    const { api } = setup();
    const error = new Error('rate limited');

    await expect(api.request(() => Promise.reject(error))).rejects.toBe(error);
    expect(api.onRequestFailureSpy).toHaveBeenCalledWith(error, expect.any(Function));
  });

  it("lets a subclass retry once, on auth's current credentials", async () => {
    const { auth, api } = setup();
    const before = auth.credentials;
    const after = {};
    api.onRequestFailureSpy.mockImplementation((_error, retry: () => Promise<unknown>) => {
      auth.credentials = after;
      return retry();
    });
    const call = vi
      .fn<(client: FakeClient) => Promise<string>>()
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce('ok');

    expect(await api.request(call)).toBe('ok');
    expect(call.mock.calls.map(([client]) => client.credentials)).toEqual([before, after]);
  });

  it('drops its client when stopped', async () => {
    const { api } = setup();
    await api.start();

    await api.stop();

    expect(api.forgotten).toBe(1);
    expect(api.getStatus()).toBe(IntegrationStatus.DISCONNECTED);
  });
});
