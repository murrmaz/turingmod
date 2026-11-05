import type { ColumnDef } from '@tanstack/react-table';
import { BAN_DURATION_MS } from '@turingmod/shared';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { actionsColumn, RowActionsMenu } from '@/components/data-table/actions-column';
import { DataTableColumnHeader } from '@/components/data-table/column-header';
import { DataTable } from '@/components/data-table/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { LoadFailure } from '@/components/load-failure';
import { PageHeader } from '@/components/page-header';
import { PageLayout } from '@/components/page-layout';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useClientTable } from '@/hooks/useClientTable';
import { useNow } from '@/hooks/useNow';
import { plural } from '@/lib/plural';
import type { ConsoleFeatures } from '@/lib/tableFeatures';
import { formatDateTime } from '@/lib/time';
import { BannedWordDialog } from './banned-word-dialog';
import { type BannedWord, useBannedWords } from './useBannedWords';

const BAN_DAYS = BAN_DURATION_MS / (24 * 60 * 60 * 1000);

/** How often lapsed words are worked out again: a ban lapsing sends nothing from the backend. */
const LAPSE_CHECK_MS = 60_000;

function DateCell({ timestamp }: { timestamp: number }) {
  return (
    <span className="font-mono text-data text-muted-foreground">{formatDateTime(timestamp)}</span>
  );
}

export function BannedWordsPage() {
  const { words, status, add, update, renew, remove } = useBannedWords();
  /** What the dialog is open on, if it is: a word being edited, or a new one. */
  const [dialog, setDialog] = useState<BannedWord | 'new' | null>(null);
  const now = useNow(LAPSE_CHECK_MS);

  const columns = useMemo<ColumnDef<ConsoleFeatures, BannedWord>[]>(
    () => [
      {
        id: 'word',
        accessorKey: 'word',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Word" />,
        meta: { grow: true, cellClassName: 'whitespace-normal break-words py-2' },
      },
      {
        id: 'status',
        header: 'Status',
        size: 90,
        cell: ({ row }) =>
          row.original.expiresAt < now ? (
            <Badge variant="outline">Lapsed</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          ),
      },
      {
        id: 'wholeWord',
        accessorFn: (word) => word.wholeWord,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Match" />,
        size: 120,
        cell: ({ row }) => (
          <span className="text-soft-foreground">
            {row.original.wholeWord ? 'Whole word' : 'Partial'}
          </span>
        ),
      },
      {
        id: 'bannedBy',
        accessorFn: (word) => word.bannedBy ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Banned by" />,
        size: 170,
        cell: ({ row }) => (
          <span className="text-soft-foreground">{row.original.bannedBy ?? 'You'}</span>
        ),
      },
      {
        id: 'bannedAt',
        accessorKey: 'bannedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Banned" />,
        size: 180,
        cell: ({ row }) => <DateCell timestamp={row.original.bannedAt} />,
      },
      {
        id: 'expiresAt',
        accessorKey: 'expiresAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expires" />,
        size: 180,
        cell: ({ row }) => <DateCell timestamp={row.original.expiresAt} />,
      },
      actionsColumn(({ row }) => {
        const { word, expiresAt } = row.original;
        const lapsed = expiresAt < now;
        return (
          <RowActionsMenu label={`Actions for ${word}`}>
            <DropdownMenuItem onSelect={() => setDialog(row.original)}>Edit…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => renew(word)}>
              {lapsed ? 'Ban again' : 'Renew'}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => remove([word])}>
              {lapsed ? 'Delete' : 'Unban'}
            </DropdownMenuItem>
          </RowActionsMenu>
        );
      }),
    ],
    [now, renew, remove]
  );

  const { table, filter, setFilter, shown, pagination } = useClientTable({
    data: words,
    columns,
    getRowId: (word) => word.word,
    initialSort: [{ id: 'bannedAt', desc: true }],
    matches: (word, needle) =>
      word.word.includes(needle) || (word.bannedBy ?? '').toLowerCase().includes(needle),
  });

  return (
    <PageLayout>
      <PageHeader
        title="Banned Words"
        description={`Saying one of these in chat gets a viewer timed out. A ban lasts ${BAN_DAYS} days, whether you add it or a viewer does with the Ban A Word reward.`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setDialog('new')}>
          <Plus />
          Add word
        </Button>
        <SearchInput
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by word or viewer…"
          className="w-72"
        />
      </div>
      <LoadFailure status={status} />
      <DataTable
        framed
        table={table}
        rowHeight={45}
        loading={status.state !== 'live'}
        onRowClick={setDialog}
        rowClassName={(word) => (word.expiresAt < now ? 'opacity-60' : undefined)}
        empty={
          words.length === 0
            ? 'No banned words yet. Add one, or wait for a viewer to redeem Ban A Word.'
            : 'No banned words match.'
        }
      />
      <DataTablePagination
        {...pagination}
        summary={`${shown} of ${plural(words.length, 'word')}`}
      />
      {dialog !== null && (
        <BannedWordDialog
          {...(dialog === 'new' ? {} : { initial: dialog })}
          onSave={async (word, wholeWord) => {
            await (dialog === 'new' ? add(word, wholeWord) : update(dialog.word, word, wholeWord));
            setDialog(null);
          }}
          onDismiss={() => setDialog(null)}
        />
      )}
    </PageLayout>
  );
}
