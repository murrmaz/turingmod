import { act, renderHook, waitFor } from '@testing-library/react';
import type { DataCell, DataRowsPage, DataTableInfo } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { switchableConnection } from '@/testing/render-console';
import { useInspectedTable } from './useInspectedTable';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const LOG: DataTableInfo = {
  name: 'activity_log',
  rowCount: 3,
  defaultSort: 'id',
  columns: [{ name: 'id', type: 'TEXT', masked: false, isTimestamp: false, isJson: false }],
};

const rowsOf = (...ids: string[]): DataRowsPage => ({
  rows: ids.map((id): Record<string, DataCell> => ({ id })),
  total: ids.length,
});

function setup(first: DataRowsPage) {
  const query = vi.fn(async () => first);
  const connection = switchableConnection({ data: { queryRows: { query } } });
  const view = renderHook(() => useInspectedTable(LOG), { wrapper: connection.wrapper });
  /** The connection drops and comes back, which reads the rows again. */
  const reconnect = async () => {
    connection.setConnectionState('reconnecting');
    view.rerender();
    connection.setConnectionState('connected');
    await act(async () => view.rerender());
  };
  return { query, reconnect, ...view };
}

describe('useInspectedTable', () => {
  it('keeps the row selected when a new read moves it to another place', async () => {
    const { query, reconnect, result } = setup(rowsOf('b', 'a'));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    const clicked = result.current.rows[1];
    act(() => result.current.select(clicked?.rowKey ?? null));
    expect(result.current.selected?.cells).toEqual({ id: 'a' });

    query.mockResolvedValue(rowsOf('c', 'b', 'a'));
    await reconnect();

    await waitFor(() => expect(result.current.rows).toHaveLength(3));
    expect(result.current.selected?.cells).toEqual({ id: 'a' });
  });

  it('closes the row, rather than showing another, when a new read no longer has it', async () => {
    const { query, reconnect, result } = setup(rowsOf('b', 'a'));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.select(result.current.rows[1]?.rowKey ?? null));

    query.mockResolvedValue(rowsOf('d', 'c'));
    await reconnect();

    await waitFor(() => expect(result.current.rows[0]?.cells).toEqual({ id: 'd' }));
    expect(result.current.selected).toBeNull();
  });

  it('gives two rows that hold the same their own keys', async () => {
    const { result } = setup(rowsOf('same', 'same'));

    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    const [first, second] = result.current.rows;
    expect(first?.rowKey).not.toBe(second?.rowKey);
  });
});
