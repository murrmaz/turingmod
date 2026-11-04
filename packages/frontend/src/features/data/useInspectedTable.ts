import type { SortingState } from '@tanstack/react-table';
import type { DataCell, DataTableInfo } from '@turingmod/shared';
import { useCallback, useMemo, useState } from 'react';
import { useDateRange } from '@/hooks/useDateRange';
import { useDebounced } from '@/hooks/useDebounced';
import { usePagedView } from '@/hooks/usePagedView';
import { type DataRowsQuery, useDataRows } from './useDataRows';

/**
 * A row of the page shown, keyed by what it holds, since a table need not have an id column. Its
 * place won't do: a row logged meanwhile moves everything down, so a read could put another row
 * in the place that's selected.
 */
export interface InspectedRow {
  rowKey: string;
  cells: Record<string, DataCell>;
}

/** What the Data page reads of a table, every page but which one. */
export type InspectorQuery = Omit<DataRowsQuery, 'page' | 'pageSize'>;

/**
 * One table on the Data page: what's read of it (search, the values each enum column is narrowed
 * to, a time range and a sort), the page of rows that reads, and the row selected. Changing what's
 * read leaves nothing selected, at once rather than when typing pauses.
 */
export function useInspectedTable(info: DataTableInfo) {
  const [search, setSearch] = useState('');
  const [facets, setFacets] = useState<Record<string, ReadonlySet<string>>>({});
  const { range, since, setRange } = useDateRange();
  const [sorting, setSorting] = useState<SortingState>([]);
  const settledSearch = useDebounced(search.trim());
  const filters = Object.fromEntries(
    Object.entries(facets)
      .filter(([, values]) => values.size > 0)
      .map(([column, values]) => [column, [...values]])
  );
  const { page, pageSize, selected, select, pagination } = usePagedView({
    search,
    filters,
    range,
    sorting,
  });

  const setFacet = useCallback((column: string, values: ReadonlySet<string>) => {
    setFacets((current) => ({ ...current, [column]: values }));
  }, []);

  const sort = sorting[0];
  const query: InspectorQuery = {
    table: info.name,
    ...(sort ? { sort: { column: sort.id, direction: sort.desc ? 'desc' : 'asc' } } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
    ...(settledSearch ? { search: settledSearch } : {}),
    ...(since === undefined ? {} : { since }),
  };
  const { rows, total, loading, error } = useDataRows({ ...query, page, pageSize });

  const keyed = useMemo<InspectedRow[]>(() => {
    const seen = new Map<string, number>();
    return rows.map((cells) => {
      const content = JSON.stringify(cells);
      // Two rows can hold the same, and a key has to be unique.
      const repeat = seen.get(content) ?? 0;
      seen.set(content, repeat + 1);
      return { cells, rowKey: `${repeat}:${content}` };
    });
  }, [rows]);

  return {
    query,
    /** Narrowed by a search, a filter or a time range. */
    filtered: Object.keys(filters).length > 0 || settledSearch !== '' || since !== undefined,
    rows: keyed,
    total,
    loading,
    error,
    search,
    setSearch,
    facets,
    setFacet,
    range,
    setRange,
    sorting,
    setSorting,
    pagination: pagination(total, error !== null),
    selected: keyed.find((row) => row.rowKey === selected) ?? null,
    selectedKey: selected,
    select,
  };
}
