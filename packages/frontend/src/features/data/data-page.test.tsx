import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DataCell, DataRowsPage, DataRowsQuery, DataTableInfo } from '@turingmod/shared';
import { MAX_DATA_PAGE_SIZE } from '@turingmod/shared';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { links, PAGES, routePattern } from '@/constants/pages';
import { MAX_EXPORT_ROWS } from '@/hooks/useTableExport';
import { renderConsole } from '@/testing/render-console';
import { DataPage } from './data-page';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() })
);
vi.mock('sonner', () => ({ toast }));

const LOG: DataTableInfo = {
  name: 'activity_log',
  rowCount: 3,
  defaultSort: 'timestamp',
  columns: [
    { name: 'id', type: 'TEXT', masked: false, isTimestamp: false, isJson: false },
    {
      name: 'event',
      type: 'TEXT',
      masked: false,
      isTimestamp: false,
      isJson: false,
      enumValues: ['twitch.follow', 'twitch.raid'],
    },
    { name: 'data', type: 'TEXT', masked: false, isTimestamp: false, isJson: true },
    { name: 'timestamp', type: 'INTEGER', masked: false, isTimestamp: true, isJson: false },
  ],
};

function row(n: number): Record<string, DataCell> {
  return {
    id: `row-${n}`,
    event: n % 2 ? 'twitch.raid' : 'twitch.follow',
    data: JSON.stringify({ viewers: n }),
    timestamp: 1_700_000_000_000 + n,
  };
}

/** Rows `from`…`to` (inclusive), as many as the page holds, out of `total`. */
function pageOf(query: DataRowsQuery, total: number): DataRowsPage {
  const start = query.page * query.pageSize;
  const count = Math.max(0, Math.min(query.pageSize, total - start));
  return { rows: Array.from({ length: count }, (_, i) => row(start + i + 1)), total };
}

function setup(answer: (query: DataRowsQuery) => Promise<DataRowsPage>) {
  const queryRows = vi.fn((query: DataRowsQuery, _options?: unknown) => answer(query));
  const data = PAGES.find((page) => page.id === 'data');
  renderConsole(
    <Routes>
      <Route path={data ? routePattern(data) : ''} element={<DataPage />} />
    </Routes>,
    {
      route: links.dataTable(LOG.name),
      procedures: {
        data: { listTables: { query: async () => [LOG] }, queryRows: { query: queryRows } },
      },
    }
  );
  /** What the page asked for most recently, for the rows it shows (not an export). */
  const lastQuery = () => queryRows.mock.lastCall?.[0];
  return { user: userEvent.setup(), queryRows, lastQuery };
}

/** The control in the table (a column header) with this name. */
function inTable(role: 'button', name: string): HTMLElement {
  return within(screen.getByRole('table')).getByRole(role, { name });
}

/** The control above or below the table with this name or, for a select, showing this value. */
function outsideTable(role: 'button' | 'combobox', name: string): HTMLElement {
  const found = screen
    .getAllByRole(role)
    .find(
      (element) =>
        !element.closest('table') &&
        (element.textContent?.trim() === name || element.getAttribute('aria-label') === name)
    );
  if (!found) {
    throw new Error(`No ${role} "${name}" outside the table`);
  }
  return found;
}

/** What was downloaded, by file name. */
let downloads: Map<string, Promise<string>>;

beforeEach(() => {
  vi.clearAllMocks();
  downloads = new Map();
  let file: Blob | undefined;
  URL.createObjectURL = (blob) => {
    file = blob instanceof Blob ? blob : undefined;
    return 'blob:download';
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.set(this.download, file?.text() ?? Promise.resolve(''));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Data page', () => {
  it("shows the table's rows, and how many match out of how many there are", async () => {
    setup(async (query) => pageOf(query, query.search ? 1 : 3));

    expect(await screen.findByText('row-1')).toBeInTheDocument();
    expect(screen.getByText('3 rows')).toBeInTheDocument();
  });

  it('starts from the first page of the whole table, in its own order', async () => {
    const { lastQuery } = setup(async (query) => pageOf(query, 3));

    await waitFor(() => expect(lastQuery()).toEqual({ table: LOG.name, page: 0, pageSize: 50 }));
  });

  it('searches once typing pauses, from the first page', async () => {
    const { user, lastQuery } = setup(async (query) => pageOf(query, query.search ? 1 : 120));
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ page: 1 }));

    await user.type(screen.getByPlaceholderText('Search data…'), 'raid');

    await waitFor(() => expect(lastQuery()).toMatchObject({ search: 'raid', page: 0 }));
    expect(await screen.findByText('1 row of 3')).toBeInTheDocument();
  });

  it('sorts by a column, newest first for a number, then the other way, from the first page', async () => {
    const { user, lastQuery } = setup(async (query) => pageOf(query, 120));
    await user.click(await screen.findByRole('button', { name: 'Next page' }));

    await user.click(inTable('button', 'timestamp'));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        sort: { column: 'timestamp', direction: 'desc' },
        page: 0,
      })
    );

    await user.click(inTable('button', 'timestamp'));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ sort: { column: 'timestamp', direction: 'asc' } })
    );
  });

  it("filters by an enum column's values, from the first page", async () => {
    const { user, lastQuery } = setup(async (query) => pageOf(query, 120));
    await user.click(await screen.findByRole('button', { name: 'Next page' }));

    await user.click(outsideTable('button', 'event'));
    await user.click(await screen.findByRole('option', { name: /twitch\.raid/ }));

    await waitFor(() =>
      expect(lastQuery()).toMatchObject({ filters: { event: ['twitch.raid'] }, page: 0 })
    );
  });

  it('reads only a recent time range, from the first page', async () => {
    const { user, lastQuery } = setup(async (query) => pageOf(query, 120));
    await user.click(await screen.findByRole('button', { name: 'Next page' }));

    await user.click(outsideTable('combobox', 'All time'));
    await user.click(await screen.findByRole('option', { name: 'Last 7 days' }));

    await waitFor(() => expect(lastQuery()).toMatchObject({ since: expect.any(Number), page: 0 }));
  });

  it("opens a row's details beside the table, and closes them", async () => {
    const { user } = setup(async (query) => pageOf(query, 3));

    await user.click(await screen.findByText('row-2'));
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('heading', { name: 'twitch.follow' })).toBeInTheDocument();
    expect(within(panel).getByText(/"viewers": 2/)).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('exports every matching row as CSV, reading as many pages as that takes', async () => {
    const total = MAX_DATA_PAGE_SIZE + 50;
    const { user, queryRows } = setup(async (query) => pageOf(query, total));

    await user.click(await screen.findByRole('button', { name: 'Export' }));

    await waitFor(() => expect(downloads.has('activity_log.csv')).toBe(true));
    const csv = await downloads.get('activity_log.csv');
    const lines = csv?.split('\r\n') ?? [];
    expect(lines[0]).toBe('id,event,data,timestamp');
    expect(lines).toHaveLength(total + 1);
    expect(queryRows).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: MAX_DATA_PAGE_SIZE })
    );
  });

  it('says so when an export fails', async () => {
    const { user, queryRows } = setup(async (query) => pageOf(query, 3));
    await screen.findByText('row-1');
    queryRows.mockRejectedValueOnce(new Error('database is locked'));

    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/export/i), {
        description: 'database is locked',
      })
    );
    expect(downloads.size).toBe(0);
  });

  it('exports as many rows as it may, and says so when more match', async () => {
    const total = MAX_EXPORT_ROWS + 5;
    const { user } = setup(async (query) => pageOf(query, total));

    await user.click(await screen.findByRole('button', { name: 'Export' }));

    await waitFor(() => expect(downloads.has('activity_log.csv')).toBe(true));
    expect((await downloads.get('activity_log.csv'))?.split('\r\n')).toHaveLength(
      MAX_EXPORT_ROWS + 1
    );
    expect(toast.warning).toHaveBeenCalledWith(
      `Exported the first ${MAX_EXPORT_ROWS.toLocaleString()} rows`,
      expect.anything()
    );
  });

  it('closes the open row when the search changes, since its place now holds another row', async () => {
    const { user } = setup(async (query) => pageOf(query, 3));
    await user.click(await screen.findByText('row-2'));
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search data…'), 'r');

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('leaves a closed row closed when the search goes back to what it was', async () => {
    const { user } = setup(async (query) => pageOf(query, 3));
    await user.click(await screen.findByText('row-2'));

    await user.type(screen.getByPlaceholderText('Search data…'), 'r{Backspace}');

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('closes the open row on another page, and leaves it closed on coming back', async () => {
    const { user } = setup(async (query) => pageOf(query, 120));
    await user.click(await screen.findByText('row-2'));

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
