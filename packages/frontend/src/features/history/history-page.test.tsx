import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActivityLogEntry } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityHistoryQuery } from '@/hooks/useActivityHistory';
import { renderConsole } from '@/testing/renderConsole';
import { HistoryPage } from './history-page';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

function command(name: string, timestamp = Date.now()): ActivityLogEntry {
  return {
    id: `command-${name}`,
    event: 'command.executed',
    timestamp,
    data: { command: name, args: [], success: true, message: '', username: 'ana' },
  };
}

type Page = { entries: ActivityLogEntry[]; total: number };

function setup(answer: (query: ActivityHistoryQuery) => Promise<Page>, route = '/history') {
  const history = vi.fn((query: ActivityHistoryQuery, _options: unknown) => answer(query));
  renderConsole(<HistoryPage />, {
    route,
    procedures: { activity: { history: { query: history } } },
  });
  /** What History asked for most recently. */
  const lastQuery = () => history.mock.lastCall?.[0];
  return { user: userEvent.setup(), history, lastQuery };
}

describe('History', () => {
  it('shows the stored entries the backend answers with, newest first', async () => {
    setup(async () => ({ entries: [command('bonk'), command('lurk')], total: 2 }));

    expect(await screen.findByText('!bonk')).toBeInTheDocument();
    expect(screen.getByText('!lurk')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
  });

  it('asks for the first page of everything to start with', async () => {
    const { lastQuery } = setup(async () => ({ entries: [], total: 0 }));

    await waitFor(() => expect(lastQuery()).toEqual({ page: 0, pageSize: 50 }));
  });

  it("asks for a category's events, from the first page", async () => {
    const { user, lastQuery } = setup(async () => ({ entries: [command('bonk')], total: 120 }));
    await user.click(await screen.findByRole('button', { name: 'Next page' }));

    await user.click(screen.getByRole('tab', { name: 'Viewers' }));

    await waitFor(() =>
      expect(lastQuery()).toEqual({
        page: 0,
        pageSize: 50,
        events: ['twitch.follow', 'twitch.subscribe', 'twitch.raid', 'twitch.cheer'],
      })
    );
  });

  it('searches for what the link it was opened from asks for', async () => {
    const { lastQuery } = setup(async () => ({ entries: [], total: 0 }), '/history?q=ana');

    await waitFor(() => expect(lastQuery()).toMatchObject({ search: 'ana' }));
    expect(screen.getByPlaceholderText('Search events, users…')).toHaveValue('ana');
  });

  it('searches for what is typed, once typing pauses', async () => {
    const { user, lastQuery } = setup(async () => ({ entries: [], total: 0 }));

    await user.type(screen.getByPlaceholderText('Search events, users…'), 'raid');

    await waitFor(() => expect(lastQuery()).toMatchObject({ search: 'raid', page: 0 }));
  });

  it('pages through the log', async () => {
    const { user, lastQuery } = setup(async () => ({ entries: [command('bonk')], total: 120 }));

    await user.click(await screen.findByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 1 }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('shows why the log could not be read in place of the entries', async () => {
    setup(() => Promise.reject(new Error('Stored activity log entry x is invalid')));

    expect(await screen.findByText('Stored activity log entry x is invalid')).toBeInTheDocument();
  });
});
