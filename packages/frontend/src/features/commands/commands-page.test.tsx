import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInfo } from '@/context/app-state-context';
import { plural } from '@/lib/plural';
import { renderConsole } from '@/testing/render-console';
import { CommandsPage } from './commands-page';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { VIEWER, MODERATOR, BROADCASTER } = PermissionLevel;
const { TWITCH, YOUTUBE } = StreamingPlatform;

function command(name: string, overrides: Partial<CommandInfo> = {}): CommandInfo {
  return {
    name,
    description: `Runs ${name}`,
    usage: `!${name} <who>`,
    permissions: [VIEWER, MODERATOR, BROADCASTER],
    cooldown: 0,
    availableOn: [TWITCH],
    ...overrides,
  };
}

/** The page once the backend has answered with these commands. */
async function setup(commands: CommandInfo[]) {
  const user = userEvent.setup();
  renderConsole(<CommandsPage />, {
    procedures: { commands: { list: { query: async () => commands } } },
  });
  await screen.findByText(`${commands.length} of ${plural(commands.length, 'command')}`);
  return { user };
}

/** The commands the table is showing, top to bottom. */
function shown(): string[] {
  return screen.queryAllByText(/^!\w+$/).map((cell) => cell.textContent ?? '');
}

/** A column's sort button, which can share its name with a filter's. */
function header(name: string): HTMLElement {
  return within(screen.getByRole('columnheader', { name })).getByRole('button');
}

/** Tick an option in the filter above the table named `filter`. */
async function tick(user: ReturnType<typeof userEvent.setup>, filter: string, option: string) {
  const [button] = screen.getAllByRole('button', { name: filter });
  await user.click(button as HTMLElement);
  await user.click(await screen.findByRole('option', { name: option }));
  await user.keyboard('{Escape}');
}

describe('Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says none have loaded until the backend answers', () => {
    renderConsole(<CommandsPage />);

    expect(screen.getByText('No commands loaded yet.')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 commands')).toBeInTheDocument();
  });

  it('shows who can use each command, its cooldown and where it works', async () => {
    await setup([
      command('so', {
        permissions: [MODERATOR, BROADCASTER],
        cooldown: 30,
        availableOn: [TWITCH, YOUTUBE],
      }),
    ]);

    const row = within(screen.getByRole('row', { name: /!so/ }));
    expect(row.getByText('Runs so')).toBeInTheDocument();
    expect(row.getByText('Moderator')).toBeInTheDocument();
    expect(row.getByText('30s')).toBeInTheDocument();
    expect(row.getByText('Twitch, YouTube')).toBeInTheDocument();
  });

  it('shows a dash for a command with no cooldown', async () => {
    await setup([command('lurk')]);

    expect(within(screen.getByRole('row', { name: /!lurk/ })).getByText('—')).toBeInTheDocument();
  });

  it('sorts by name to start with, and by what a header asks for', async () => {
    const { user } = await setup([
      command('zap', { permissions: [VIEWER] }),
      command('ban', { permissions: [BROADCASTER] }),
      command('mute', { permissions: [MODERATOR] }),
    ]);
    expect(shown()).toEqual(['!ban', '!mute', '!zap']);

    await user.click(header('Command'));
    expect(shown()).toEqual(['!zap', '!mute', '!ban']);

    // A column of numbers sorts highest first: the most privileged, here.
    await user.click(header('Permission'));
    expect(shown()).toEqual(['!ban', '!mute', '!zap']);

    await user.click(header('Permission'));
    expect(shown()).toEqual(['!zap', '!mute', '!ban']);
  });

  it('filters by name, with or without the !, and by description', async () => {
    const { user } = await setup([
      command('lurk', { description: 'Let chat know you are lurking' }),
      command('flip', { description: 'Flip a coin' }),
    ]);
    const filter = screen.getByPlaceholderText('Filter commands…');

    await user.type(filter, '!LUR');
    expect(shown()).toEqual(['!lurk']);
    expect(screen.getByText('1 of 2 commands')).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, 'coin');
    expect(shown()).toEqual(['!flip']);
  });

  it('says so when nothing matches, rather than that none have loaded', async () => {
    const { user } = await setup([command('lurk')]);

    await user.type(screen.getByPlaceholderText('Filter commands…'), 'nothing');

    expect(screen.getByText('No commands match.')).toBeInTheDocument();
  });

  it("filters by the least privileged level that may run a command, the level it's shown at", async () => {
    const { user } = await setup([
      command('lurk'),
      command('so', { permissions: [MODERATOR, BROADCASTER] }),
    ]);

    await tick(user, 'Permission', 'Moderator');

    expect(shown()).toEqual(['!so']);
  });

  it('keeps only commands that work on every platform ticked', async () => {
    const { user } = await setup([
      command('both', { availableOn: [TWITCH, YOUTUBE] }),
      command('twitchonly', { availableOn: [TWITCH] }),
      command('youtubeonly', { availableOn: [YOUTUBE] }),
    ]);

    await tick(user, 'Platform', 'Twitch');
    expect(shown()).toEqual(['!both', '!twitchonly']);

    await user.click(screen.getByRole('button', { name: /^Platform/ }));
    await user.click(await screen.findByRole('option', { name: 'YouTube' }));

    expect(shown()).toEqual(['!both']);
  });

  it('pages through more than fit on one page', async () => {
    const { user } = await setup(
      Array.from({ length: 60 }, (_, index) => command(`cmd${String(index).padStart(2, '0')}`))
    );
    expect(shown()).toHaveLength(50);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(shown()).toEqual(Array.from({ length: 10 }, (_, index) => `!cmd${50 + index}`));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  it('opens the simulator on a command when its row is clicked', async () => {
    const { user } = await setup([command('bonk')]);

    await user.click(screen.getByText('!bonk'));

    expect(screen.getByLabelText('Command')).toHaveValue('!bonk ');
  });

  it("opens the simulator from a row's menu, without the row's own click", async () => {
    const { user } = await setup([command('bonk')]);

    await user.click(screen.getByRole('button', { name: 'Command actions' }));
    expect(screen.queryByLabelText('Command')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('menuitem', { name: 'Simulate…' }));

    expect(await screen.findByLabelText('Command')).toHaveValue('!bonk ');
  });

  it("copies a command's usage and confirms it", async () => {
    const { user } = await setup([command('bonk')]);

    await user.click(screen.getByRole('button', { name: 'Command actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy usage' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied usage'));
    await expect(navigator.clipboard.readText()).resolves.toBe('!bonk <who>');
  });
});
