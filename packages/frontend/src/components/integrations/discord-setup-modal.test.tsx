import { screen, waitFor } from '@testing-library/react';
import { IntegrationName } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { integration } from '@/testing/integrations';
import { renderSetupModal as setup } from '@/testing/render-setup-modal';
import { DiscordSetupModal } from './discord-setup-modal';

const save = () => screen.getByRole('button', { name: 'Save' });

describe('DiscordSetupModal', () => {
  const { DISCORD } = IntegrationName;
  const Channel = '123456789012345678';

  it('needs both the token and the channel', async () => {
    const { user } = setup(DiscordSetupModal, integration(DISCORD));
    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText('Bot token'), 'token');
    expect(save()).toBeDisabled();

    await user.type(screen.getByLabelText('Channel ID'), Channel);
    expect(save()).toBeEnabled();
  });

  it('marks a channel ID that is no Discord id', async () => {
    const { user } = setup(DiscordSetupModal, integration(DISCORD));
    const channel = screen.getByLabelText('Channel ID');
    expect(channel).toHaveAttribute('aria-invalid', 'false');

    await user.type(screen.getByLabelText('Bot token'), 'token');
    await user.type(channel, '12345');

    expect(channel).toHaveAttribute('aria-invalid', 'true');
    expect(save()).toBeDisabled();
  });

  it('saves the token and the channel, trimmed', async () => {
    const { user, configure, onSaved } = setup(DiscordSetupModal, integration(DISCORD));

    await user.type(screen.getByLabelText('Bot token'), ' token ');
    await user.type(screen.getByLabelText('Channel ID'), ` ${Channel} `);
    await user.click(save());

    expect(configure).toHaveBeenCalledWith({
      integrationName: DISCORD,
      config: { botToken: 'token', notificationChannelId: Channel },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
