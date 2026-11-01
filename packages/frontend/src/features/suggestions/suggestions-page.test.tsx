import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';
import { SuggestionsPage } from './suggestions-page';
import type { Suggestion } from './useSuggestions';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
);
vi.mock('sonner', () => ({ toast }));

function suggestion(id: number, text: string, suggestedBy: string | null = 'ana'): Suggestion {
  return { id, suggestion: text, suggestedBy, createdAt: 1_700_000_000_000 + id };
}

function setup(suggestions: Suggestion[]) {
  const watch = new FakeSubscription<Suggestion[]>();
  renderConsole(<SuggestionsPage />, {
    procedures: {
      suggestions: { watch, delete: { mutate: async () => [] } },
    },
  });
  watch.emit(suggestions);
  return { user: userEvent.setup(), watch };
}

/** Lets a table finish reacting to a change, which it may do a moment later. */
const settled = () => act(async () => {});

/** The suggestions the table is showing, top to bottom. */
function shown(): string[] {
  return screen.queryAllByText(/^idea /).map((cell) => cell.textContent ?? '');
}

const filter = () => screen.getByPlaceholderText('Filter by text or viewer…');

describe('Suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says how to add one when there are none', () => {
    setup([]);

    expect(screen.getByText('No suggestions yet. Viewers can add one with !sg.')).toBeVisible();
  });

  it('shows the newest first, and sorts by what a header asks for', async () => {
    const { user } = setup([suggestion(1, 'idea old', 'zed'), suggestion(2, 'idea new', 'ana')]);
    expect(shown()).toEqual(['idea new', 'idea old']);

    await user.click(screen.getByRole('button', { name: 'From' }));
    expect(shown()).toEqual(['idea new', 'idea old']);

    await user.click(screen.getByRole('button', { name: 'From' }));
    expect(shown()).toEqual(['idea old', 'idea new']);
  });

  it('shows a dash for a suggestion with nobody named', () => {
    setup([suggestion(1, 'idea one', null)]);

    expect(within(screen.getByRole('row', { name: /idea one/ })).getByText('—')).toBeVisible();
  });

  it('filters by text and by viewer', async () => {
    const { user } = setup([suggestion(1, 'idea one', 'ana'), suggestion(2, 'idea two', 'bob')]);

    await user.type(filter(), 'TWO');
    expect(shown()).toEqual(['idea two']);

    await user.clear(filter());
    await user.type(filter(), 'ana');
    expect(shown()).toEqual(['idea one']);
  });

  it('says so when nothing matches, rather than that there are none', async () => {
    const { user } = setup([suggestion(1, 'idea one')]);

    await user.type(filter(), 'nothing');

    expect(screen.getByText('No suggestions match.')).toBeVisible();
  });

  it('pages through more than fit on one page', async () => {
    const { user } = setup(
      Array.from({ length: 60 }, (_, index) => suggestion(index, `idea ${index}`))
    );
    expect(shown()).toHaveLength(50);
    expect(screen.getByText('Page 1 of 2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Next page' }));

    expect(shown()).toHaveLength(10);
    expect(screen.getByText('Page 2 of 2')).toBeVisible();
  });

  describe('on a later page', () => {
    const ideas = Array.from({ length: 120 }, (_, index) => suggestion(index, `idea ${index}`));

    it('stays there when a viewer adds a suggestion', async () => {
      const { user, watch } = setup(ideas);
      await user.click(screen.getByRole('button', { name: 'Next page' }));

      watch.emit([...ideas, suggestion(500, 'idea 500')]);
      await settled();

      expect(screen.getByText('Page 2 of 3')).toBeVisible();
    });

    it('stays there when one is deleted', async () => {
      const { user } = setup(ideas);
      await user.click(screen.getByRole('button', { name: 'Next page' }));

      await user.click(
        screen.getAllByRole('button', { name: 'Delete suggestion' })[0] as HTMLElement
      );
      await settled();

      expect(screen.getByText('Page 2 of 3')).toBeVisible();
    });

    it('moves to the last page left when deleting empties this one', async () => {
      const { user } = setup(ideas.slice(0, 51));
      await user.click(screen.getByRole('button', { name: 'Next page' }));
      expect(shown()).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: 'Delete suggestion' }));
      await settled();

      expect(screen.getByText('Page 1 of 1')).toBeVisible();
      expect(shown()).toHaveLength(50);
    });

    it('goes back to the first page when filtered', async () => {
      const { user } = setup(ideas);
      await user.click(screen.getByRole('button', { name: 'Next page' }));

      await user.type(filter(), 'idea');
      await settled();

      expect(screen.getByText('Page 1 of 3')).toBeVisible();
    });

    it('goes back to the first page when sorted', async () => {
      const { user } = setup(ideas);
      await user.click(screen.getByRole('button', { name: 'Next page' }));

      await user.click(screen.getByRole('button', { name: 'From' }));
      await settled();

      expect(screen.getByText('Page 1 of 3')).toBeVisible();
    });
  });

  it('hides a deleted suggestion at once, with the chance to undo it', async () => {
    const { user } = setup([suggestion(1, 'idea one'), suggestion(2, 'idea two')]);

    await user.click(
      within(screen.getByRole('row', { name: /idea one/ })).getByRole('button', {
        name: 'Delete suggestion',
      })
    );

    expect(shown()).toEqual(['idea two']);
    expect(toast).toHaveBeenCalledWith('Deleting 1 suggestion…', expect.anything());
  });

  it("doesn't select a row when its delete button is clicked", async () => {
    const { user } = setup([suggestion(1, 'idea one'), suggestion(2, 'idea two')]);

    await user.click(
      within(screen.getByRole('row', { name: /idea one/ })).getByRole('button', {
        name: 'Delete suggestion',
      })
    );

    expect(screen.queryByRole('button', { name: /selected$/ })).not.toBeInTheDocument();
  });

  it('selects by clicking a row, and deletes what is selected', async () => {
    const { user } = setup([
      suggestion(1, 'idea one'),
      suggestion(2, 'idea two'),
      suggestion(3, 'idea three'),
    ]);

    await user.click(screen.getByText('idea one'));
    await user.click(screen.getByText('idea two'));
    await user.click(screen.getByRole('button', { name: 'Delete 2 selected' }));

    expect(shown()).toEqual(['idea three']);
    expect(toast).toHaveBeenCalledWith('Deleting 2 suggestions…', expect.anything());
    expect(screen.queryByRole('button', { name: /selected$/ })).not.toBeInTheDocument();
  });

  it('selects all on the page from the header', async () => {
    const { user } = setup([suggestion(1, 'idea one'), suggestion(2, 'idea two')]);

    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));

    expect(screen.getByRole('button', { name: 'Delete 2 selected' })).toBeVisible();
  });

  it('clears the selection', async () => {
    const { user } = setup([suggestion(1, 'idea one')]);
    await user.click(screen.getByText('idea one'));

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(screen.queryByRole('button', { name: /selected$/ })).not.toBeInTheDocument();
  });

  it("never deletes what's selected but filtered out of view", async () => {
    const { user } = setup([suggestion(1, 'idea one'), suggestion(2, 'idea two')]);
    await user.click(screen.getByText('idea one'));
    await user.click(screen.getByText('idea two'));

    await user.type(filter(), 'two');
    await user.click(screen.getByRole('button', { name: 'Delete 1 selected' }));

    await waitFor(() => expect(shown()).toEqual([]));
    expect(toast).toHaveBeenCalledWith('Deleting 1 suggestion…', expect.anything());
    await user.clear(filter());
    expect(shown()).toEqual(['idea one']);
  });
});
