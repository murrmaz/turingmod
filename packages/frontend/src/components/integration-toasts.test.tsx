import { type IntegrationInfo, IntegrationName, IntegrationStatus } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { integration } from '@/testing/integrations';
import { renderConsole } from '@/testing/render-console';
import { IntegrationToasts } from './integration-toasts';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const running = integration(IntegrationName.OBS, {
  status: IntegrationStatus.CONNECTED,
  enabled: true,
});
const failed = integration(IntegrationName.OBS, {
  status: IntegrationStatus.ERROR,
  enabled: true,
  errorMessage: 'Connection refused',
});

function setup() {
  const watch = new FakeSubscription<IntegrationInfo[]>();
  renderConsole(<IntegrationToasts />, { procedures: { integrations: { watch } } });
  return watch;
}

describe('IntegrationToasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says nothing about what was already broken when the console opened', () => {
    const watch = setup();

    watch.emit([failed]);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('treats the first list with anything in it as how things were', () => {
    const watch = setup();

    watch.emit([]);
    watch.emit([failed]);

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says so when an integration breaks, and why', () => {
    const watch = setup();

    watch.emit([running]);
    watch.emit([failed]);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('obs: error', { description: 'Connection refused' });
  });

  it('says so when an integration needs signing in again', () => {
    const watch = setup();

    watch.emit([running]);
    watch.emit([integration(IntegrationName.OBS, { status: IntegrationStatus.NEEDS_REAUTH })]);

    expect(toast.error).toHaveBeenCalledWith('obs: needs reauth', { description: undefined });
  });

  it("doesn't repeat itself while an integration stays broken", () => {
    const watch = setup();

    watch.emit([running]);
    watch.emit([failed]);
    watch.emit([{ ...failed, errorMessage: 'Still refused' }]);

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('says so again when one that recovered breaks again', () => {
    const watch = setup();

    watch.emit([running]);
    watch.emit([failed]);
    watch.emit([running]);
    watch.emit([failed]);

    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('names only the integration that broke', () => {
    const watch = setup();
    const discord = integration(IntegrationName.DISCORD, { status: IntegrationStatus.ERROR });

    watch.emit([running, discord]);
    watch.emit([failed, discord]);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('obs: error', expect.anything());
  });

  it('says nothing about an integration that is only blocked or starting', () => {
    const watch = setup();

    watch.emit([running]);
    watch.emit([integration(IntegrationName.OBS, { status: IntegrationStatus.BLOCKED })]);
    watch.emit([integration(IntegrationName.OBS, { status: IntegrationStatus.CONNECTING })]);

    expect(toast.error).not.toHaveBeenCalled();
  });
});
