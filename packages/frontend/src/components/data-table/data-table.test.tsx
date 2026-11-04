import { type ColumnDef, useTable } from '@tanstack/react-table';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type ConsoleFeatures, consoleFeatures } from '@/lib/tableFeatures';
import { DataTable } from './data-table';

interface Row {
  id: string;
}

const ROWS: Row[] = Array.from({ length: 500 }, (_, index) => ({ id: `row-${index}` }));
const COLUMNS: ColumnDef<ConsoleFeatures, Row>[] = [{ id: 'id', accessorKey: 'id', header: 'Id' }];

function Rows({ divider }: { divider: () => null }) {
  const table = useTable({
    features: consoleFeatures,
    data: ROWS,
    columns: COLUMNS,
    getRowId: (row) => row.id,
    manualFiltering: true,
    manualPagination: true,
  });
  return <DataTable table={table} divider={divider} virtualize empty="None" />;
}

describe('DataTable', () => {
  it("doesn't work out its dividers again for scrolling, only for new rows", async () => {
    const divider = vi.fn(() => null);
    render(<Rows divider={divider} />);
    await act(async () => {});
    divider.mockClear();

    const scroller = screen.getByRole('table').parentElement as HTMLElement;
    for (const scrollTop of [400, 800, 1200]) {
      fireEvent.scroll(scroller, { target: { scrollTop } });
      // The virtualizer renders for a scroll a moment later.
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    }

    expect(divider).not.toHaveBeenCalled();
  });
});
