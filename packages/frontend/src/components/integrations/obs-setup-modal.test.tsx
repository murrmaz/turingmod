import { screen, waitFor } from '@testing-library/react';
import { IntegrationName, OBS_DEFAULT_URL } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { integration } from '@/testing/integrations';
import { renderSetupModal as setup } from '@/testing/render-setup-modal';
import { ObsSetupModal } from './obs-setup-modal';

const save = () => screen.getByRole('button', { name: 'Save' });

describe('ObsSetupModal', () => {
  const { OBS } = IntegrationName;

  it('opens on the address in use, or the default without one', () => {
    setup(ObsSetupModal, integration(OBS, { address: 'ws://10.0.0.2:4455' }));
    expect(screen.getByLabelText('Server address')).toHaveValue('ws://10.0.0.2:4455');
  });

  it('opens on the default address when there is none in use', () => {
    setup(ObsSetupModal, integration(OBS));
    expect(screen.getByLabelText('Server address')).toHaveValue(OBS_DEFAULT_URL);
  });

  it('leaves the password out when empty, which means authentication is off', async () => {
    const { user, configure, onSaved } = setup(ObsSetupModal, integration(OBS));

    await user.click(save());

    expect(configure).toHaveBeenCalledWith({
      integrationName: OBS,
      config: { url: OBS_DEFAULT_URL },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('sends the password entered, exactly as typed', async () => {
    const { user, configure } = setup(ObsSetupModal, integration(OBS));

    await user.type(screen.getByLabelText('Server password'), ' pass ');
    await user.click(save());

    expect(configure).toHaveBeenCalledWith({
      integrationName: OBS,
      config: { url: OBS_DEFAULT_URL, password: ' pass ' },
    });
  });

  it('refuses an address that is not a WebSocket one, marking the field', async () => {
    const { user } = setup(ObsSetupModal, integration(OBS));
    const address = screen.getByLabelText('Server address');

    await user.clear(address);
    expect(address).toHaveAttribute('aria-invalid', 'false');
    expect(save()).toBeDisabled();

    await user.type(address, 'http://127.0.0.1:4455');

    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(save()).toBeDisabled();
  });
});
