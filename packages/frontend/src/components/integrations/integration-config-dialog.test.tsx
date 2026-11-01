import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type IntegrationInfo, IntegrationName } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';
import { IntegrationConfigDialog } from './integration-config-dialog';

const CONFIG = { url: 'ws://127.0.0.1:4455' };

function setup(
  config: Record<string, unknown> | null,
  answer: () => Promise<IntegrationInfo[]> = async () => []
) {
  const configure = vi.fn((_input: { integrationName: string; config: Record<string, unknown> }) =>
    answer()
  );
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  renderConsole(
    <IntegrationConfigDialog
      integrationName={IntegrationName.OBS}
      title="OBS setup"
      description="Connects to OBS."
      config={config}
      saveLabel="Save it"
      failureMessage="Failed to save"
      onDismiss={onDismiss}
      onSaved={onSaved}
    >
      <input aria-label="Address" />
    </IntegrationConfigDialog>,
    { procedures: { integrations: { configure: { mutate: configure } } } }
  );
  return { user: userEvent.setup(), configure, onDismiss, onSaved };
}

const saveButton = () => screen.getByRole('button', { name: 'Save it' });

describe('IntegrationConfigDialog', () => {
  it('keeps Save disabled, and Enter from saving, until the form is valid', async () => {
    const { user, configure } = setup(null);

    expect(saveButton()).toBeDisabled();

    await user.type(screen.getByLabelText('Address'), 'x{Enter}');

    expect(configure).not.toHaveBeenCalled();
  });

  it("saves the config under the integration's name, then says so", async () => {
    const { user, configure, onSaved } = setup(CONFIG);

    await user.click(saveButton());

    expect(configure).toHaveBeenCalledWith({
      integrationName: IntegrationName.OBS,
      config: CONFIG,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('saves on Enter', async () => {
    const { user, configure } = setup(CONFIG);

    await user.type(screen.getByLabelText('Address'), '{Enter}');

    expect(configure).toHaveBeenCalledTimes(1);
  });

  it('holds Save while saving', async () => {
    const answer = deferred<IntegrationInfo[]>();
    const { user, onSaved } = setup(CONFIG, () => answer.promise);

    await user.click(saveButton());

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();

    answer.resolve([]);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(saveButton()).toBeEnabled();
  });

  it('shows why saving failed and stays open, so it can be tried again', async () => {
    const { user, onSaved, configure } = setup(CONFIG, () =>
      Promise.reject(new Error('Bad address'))
    );

    await user.click(saveButton());

    expect(await screen.findByText('Bad address')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();

    configure.mockImplementation(async () => []);
    await user.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByText('Bad address')).not.toBeInTheDocument();
  });

  it('dismisses on Cancel without saving', async () => {
    const { user, configure, onDismiss } = setup(CONFIG);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(configure).not.toHaveBeenCalled();
  });
});
