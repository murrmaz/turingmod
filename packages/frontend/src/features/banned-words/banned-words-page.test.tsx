import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';
import { BannedWordsPage } from './banned-words-page';
import type { BannedWord } from './useBannedWords';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
);
vi.mock('sonner', () => ({ toast }));

const DAY = 24 * 60 * 60 * 1000;

function banned(word: string, changes: Partial<BannedWord> = {}): BannedWord {
  const bannedAt = Date.now() - DAY;
  return {
    word,
    bannedBy: 'viewer',
    bannedAt,
    expiresAt: bannedAt + 30 * DAY,
    wholeWord: false,
    ...changes,
  };
}

const lapsed = (word: string) => banned(word, { expiresAt: Date.now() - DAY });

function setup(words: BannedWord[]) {
  const watch = new FakeSubscription<BannedWord[]>();
  const procedures = {
    watch,
    add: { mutate: vi.fn(async (_: { word: string; wholeWord: boolean }) => words) },
    update: {
      mutate: vi.fn(async (_: { word: string; newWord: string; wholeWord: boolean }) => words),
    },
    renew: { mutate: vi.fn(async (_: { word: string }) => words) },
    delete: { mutate: vi.fn(async (_: { words: string[] }) => words) },
  };
  renderConsole(<BannedWordsPage />, { procedures: { bannedWords: procedures } });
  act(() => watch.emit(words));
  return { user: userEvent.setup(), ...procedures };
}

const row = (word: string) => {
  const found = screen.getByText(word).closest('tr');
  if (!found) {
    throw new Error(`No row for ${word}`);
  }
  return within(found);
};

async function chooseAction(
  user: ReturnType<typeof userEvent.setup>,
  word: string,
  action: string
) {
  await user.click(row(word).getByRole('button', { name: `Actions for ${word}` }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
}

describe('Banned Words', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says how to start when there are none', () => {
    setup([]);

    expect(screen.getByText(/No banned words yet/)).toBeVisible();
  });

  it('says how long a ban lasts, from the duration the backend uses', () => {
    setup([]);

    expect(screen.getByText(/A ban lasts 30 days/)).toBeVisible();
  });

  it('marks each word active or lapsed, and names who banned it', () => {
    setup([banned('cheese', { bannedBy: null }), lapsed('crackers')]);

    expect(row('cheese').getByText('Active')).toBeVisible();
    expect(row('cheese').getByText('You')).toBeVisible();
    expect(row('crackers').getByText('Lapsed')).toBeVisible();
    expect(row('crackers').getByText('viewer')).toBeVisible();
  });

  it('shows a ban lapsing while the page is open, which the backend sends nothing about', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    setup([banned('cheese', { expiresAt: Date.now() + 30_000 })]);
    expect(row('cheese').getByText('Active')).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(row('cheese').getByText('Lapsed')).toBeVisible();
  });

  it('filters by word or by viewer', async () => {
    const { user } = setup([
      banned('cheese', { bannedBy: 'alice' }),
      banned('crackers', { bannedBy: 'bob' }),
    ]);
    const filter = screen.getByPlaceholderText(/Filter by word or viewer/);

    await user.type(filter, 'CHEE');
    expect(screen.getByText('cheese')).toBeVisible();
    expect(screen.queryByText('crackers')).toBeNull();

    await user.clear(filter);
    await user.type(filter, 'bob');
    expect(screen.getByText('crackers')).toBeVisible();
    expect(screen.queryByText('cheese')).toBeNull();

    await user.type(filter, 'nobody');
    expect(screen.getByText('No banned words match.')).toBeVisible();
  });

  it('adds a word in the form it will be saved in, and shows the answer', async () => {
    const { user, add } = setup([]);
    add.mutate.mockResolvedValue([banned('dont', { bannedBy: null })]);

    await user.click(screen.getByRole('button', { name: 'Add word' }));
    await user.type(screen.getByLabelText('Word'), "Don't!");
    expect(screen.getByText(/Saved as dont/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(add.mutate).toHaveBeenCalledWith({ word: 'dont', wholeWord: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('dont')).toBeVisible();
  });

  it('shows how each word matches', () => {
    setup([banned('hell', { wholeWord: true }), banned('spider')]);

    expect(row('hell').getByText('Whole word')).toBeVisible();
    expect(row('spider').getByText('Partial')).toBeVisible();
  });

  it("sets a new word's matching by its length, until it's chosen", async () => {
    const { user, add } = setup([]);
    await user.click(screen.getByRole('button', { name: 'Add word' }));
    const wholeWord = screen.getByRole('checkbox', { name: 'Whole word only' });
    const field = screen.getByLabelText('Word');

    await user.type(field, 'hell');
    expect(wholeWord).toBeChecked();
    await user.type(field, 'ish');
    expect(wholeWord).not.toBeChecked();

    await user.click(wholeWord);
    await user.clear(field);
    await user.type(field, 'therefore{Enter}');

    expect(wholeWord).toBeChecked();
    expect(add.mutate).toHaveBeenCalledWith({ word: 'therefore', wholeWord: true });
  });

  it("changes an existing word's matching, whatever its length", async () => {
    const { user, update } = setup([banned('cat', { wholeWord: true })]);

    await user.click(screen.getByText('cat'));
    const wholeWord = screen.getByRole('checkbox', { name: 'Whole word only' });
    expect(wholeWord).toBeChecked();
    await user.click(wholeWord);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(update.mutate).toHaveBeenCalledWith({ word: 'cat', newWord: 'cat', wholeWord: false });
  });

  it('saves on Enter', async () => {
    const { user, add } = setup([]);

    await user.click(screen.getByRole('button', { name: 'Add word' }));
    await user.type(screen.getByLabelText('Word'), 'cheese{Enter}');

    expect(add.mutate).toHaveBeenCalledWith({ word: 'cheese', wholeWord: false });
  });

  it('refuses more than one word, and says why', async () => {
    const { user, add } = setup([]);

    await user.click(screen.getByRole('button', { name: 'Add word' }));
    await user.type(screen.getByLabelText('Word'), 'two words{Enter}');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('One word only.')).toBeVisible();
    expect(add.mutate).not.toHaveBeenCalled();
  });

  it('edits a word when its row is clicked', async () => {
    const { user, update } = setup([banned('chese')]);

    await user.click(screen.getByText('chese'));
    const field = screen.getByLabelText('Word');
    expect(field).toHaveValue('chese');
    await user.clear(field);
    await user.type(field, 'cheese{Enter}');

    expect(update.mutate).toHaveBeenCalledWith({
      word: 'chese',
      newWord: 'cheese',
      wholeWord: false,
    });
  });

  it('keeps the dialog and its text when saving fails', async () => {
    const { user, update } = setup([banned('chese')]);
    update.mutate.mockRejectedValue(new Error('"cheese" is already on the list.'));

    await user.click(screen.getByText('chese'));
    const field = screen.getByLabelText('Word');
    await user.clear(field);
    await user.type(field, 'cheese{Enter}');

    expect(await screen.findByText('"cheese" is already on the list.')).toBeVisible();
    expect(screen.getByLabelText('Word')).toHaveValue('cheese');
  });

  it('renews an active word without opening it', async () => {
    const { user, renew } = setup([banned('cheese')]);

    await chooseAction(user, 'cheese', 'Renew');

    expect(renew.mutate).toHaveBeenCalledWith({ word: 'cheese' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers to ban a lapsed word again, or delete it', async () => {
    const { user, renew } = setup([lapsed('cheese')]);

    await user.click(row('cheese').getByRole('button', { name: 'Actions for cheese' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Ban again' }));

    expect(renew.mutate).toHaveBeenCalledWith({ word: 'cheese' });
  });

  it('reports a renewal that fails', async () => {
    const { user, renew } = setup([banned('cheese')]);
    renew.mutate.mockRejectedValue(new Error('nope'));

    await chooseAction(user, 'cheese', 'Renew');

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Couldn\'t renew "cheese"', { description: 'nope' })
    );
  });

  it('hides an unbanned word at once, sending it only when Undo lapses', async () => {
    const { user, delete: remove } = setup([banned('cheese')]);

    await chooseAction(user, 'cheese', 'Unban');

    expect(screen.queryByText('cheese')).toBeNull();
    expect(remove.mutate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Deleting 1 banned word…', expect.anything());

    const options = toast.mock.lastCall?.[1] as { onAutoClose: () => void };
    act(() => options.onAutoClose());

    expect(remove.mutate).toHaveBeenCalledWith({ words: ['cheese'] });
  });

  it('brings an unbanned word back on Undo', async () => {
    const { user, delete: remove } = setup([banned('cheese')]);

    await chooseAction(user, 'cheese', 'Unban');
    const options = toast.mock.lastCall?.[1] as { action: { onClick: () => void } };
    act(() => options.action.onClick());

    expect(screen.getByText('cheese')).toBeVisible();
    expect(remove.mutate).not.toHaveBeenCalled();
  });
});
