import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PAGES } from '@/constants/pages';
import type { CommandInfo } from '@/context/app-state-context';
import { CurrentLocation, renderConsole } from '@/testing/render-console';
import { CommandPalette } from './command-palette';

const BONK: CommandInfo = {
  name: 'bonk',
  description: 'Bonks someone',
  usage: '!bonk <who>',
  permissions: [PermissionLevel.VIEWER],
  cooldown: 0,
  availableOn: [StreamingPlatform.TWITCH],
};

function Palette() {
  const [open, setOpen] = useState(false);
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

function setup() {
  const user = userEvent.setup();
  renderConsole(
    <>
      <Palette />
      <CurrentLocation />
    </>,
    { procedures: { commands: { list: { query: async () => [BONK] } } } }
  );
  return user;
}

const search = () => screen.queryByPlaceholderText('Search or run a command…');

describe('CommandPalette', () => {
  it.each([
    ['Ctrl+K', '{Control>}k{/Control}'],
    ['Cmd+K', '{Meta>}k{/Meta}'],
    ['Ctrl+K with caps lock on', '{Control>}K{/Control}'],
  ])('opens on %s, and closes on it again', async (_name, keys) => {
    const user = setup();
    expect(search()).not.toBeInTheDocument();

    await user.keyboard(keys);
    expect(search()).toBeInTheDocument();

    await user.keyboard(keys);
    await waitFor(() => expect(search()).not.toBeInTheDocument());
  });

  it("doesn't open on K alone", async () => {
    const user = setup();

    await user.keyboard('k');

    expect(search()).not.toBeInTheDocument();
  });

  it('goes to the page chosen, and closes', async () => {
    const user = setup();
    await user.keyboard('{Control>}k{/Control}');

    for (const page of PAGES) {
      expect(screen.getByRole('option', { name: page.label })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('option', { name: 'History' }));

    expect(screen.getByRole('status', { name: 'Current location' })).toHaveTextContent('/history');
    await waitFor(() => expect(search()).not.toBeInTheDocument());
  });

  it('opens a command in the simulator as the broadcaster, without running it', async () => {
    const user = setup();
    await user.keyboard('{Control>}k{/Control}');

    await user.click(await screen.findByRole('option', { name: /!bonk/ }));

    expect(await screen.findByLabelText('Command')).toHaveValue('!bonk ');
    expect(screen.getByLabelText('Permission level')).toHaveTextContent('Broadcaster');
    expect(search()).not.toBeInTheDocument();
  });

  it('finds a command by its description, and says when nothing matches', async () => {
    const user = setup();
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('option', { name: /!bonk/ });

    await user.type(screen.getByRole('combobox'), 'bonks someone');
    expect(screen.getByRole('option', { name: /!bonk/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'History' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText('No results.')).toBeInTheDocument();
  });
});
