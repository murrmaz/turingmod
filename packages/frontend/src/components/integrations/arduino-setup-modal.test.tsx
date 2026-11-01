import { screen } from '@testing-library/react';
import { ARDUINO_DEFAULT_URL, IntegrationName } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { integration } from '@/testing/integrations';
import { renderSetupModal as setup } from '@/testing/render-setup-modal';
import { ArduinoSetupModal } from './arduino-setup-modal';

const save = () => screen.getByRole('button', { name: 'Save' });

describe('ArduinoSetupModal', () => {
  const { ARDUINO } = IntegrationName;

  it('opens on the address in use, and saving unchanged keeps it', async () => {
    const address = 'ws://192.168.1.50:81';
    const { user, configure } = setup(ArduinoSetupModal, integration(ARDUINO, { address }));
    expect(screen.getByLabelText('Board address')).toHaveValue(address);

    await user.click(save());

    expect(configure).toHaveBeenCalledWith({
      integrationName: ARDUINO,
      config: { url: address },
    });
  });

  it('opens on the reference firmware address when there is none in use', () => {
    setup(ArduinoSetupModal, integration(ARDUINO));

    expect(screen.getByLabelText('Board address')).toHaveValue(ARDUINO_DEFAULT_URL);
  });

  it('refuses an address that is not a WebSocket one, marking the field', async () => {
    const { user } = setup(ArduinoSetupModal, integration(ARDUINO));
    const address = screen.getByLabelText('Board address');

    await user.clear(address);
    await user.type(address, 'not an address');

    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(save()).toBeDisabled();
  });
});
