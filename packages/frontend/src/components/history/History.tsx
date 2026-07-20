import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import type { SelectProps } from '@cloudscape-design/components/select';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { ActivityLogEntry } from '@turingmod/shared';
import { ActivityCategory, createActivityQueryMessage } from '@turingmod/shared';
import { useCallback, useEffect, useState } from 'react';
import { getCategoryColor, summarizeActivityEntry } from '../../constants/activityFormat';
import { useWebSocketContext } from '../../context/WebSocketContext';

const PAGE_SIZE = 100;

const CATEGORY_OPTIONS: SelectProps.Option[] = [
  { value: '', label: 'All categories' },
  ...Object.values(ActivityCategory).map((category) => ({ value: category, label: category })),
];

/**
 * History page — persisted, queryable view of commands/events/status/errors.
 * Raw chat is not persisted; see the Dashboard's live tail for that. Naming note: the page is
 * "History" (the look-back view) but the underlying data model stays "activity".
 */
export function History() {
  const { sendAndWaitForResponse } = useWebSocketContext();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [category, setCategory] = useState<ActivityCategory | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadPage = useCallback(
    async (before: number | undefined, replace: boolean) => {
      setLoading(true);
      try {
        const response = await sendAndWaitForResponse<{ entries: ActivityLogEntry[] }>(
          createActivityQueryMessage({
            limit: PAGE_SIZE,
            ...(category !== undefined && { category }),
            ...(before !== undefined && { before }),
          })
        );
        const page = response.payload.entries;
        setEntries((prev) => (replace ? page : [...prev, ...page]));
        setHasMore(page.length === PAGE_SIZE);
      } catch (error) {
        console.error('[History] Failed to query activity log', error);
      } finally {
        setLoading(false);
      }
    },
    [category, sendAndWaitForResponse]
  );

  // Re-query from the top whenever the category filter changes.
  useEffect(() => {
    loadPage(undefined, true);
  }, [loadPage]);

  const loadOlder = () => {
    const oldest = entries[entries.length - 1];
    if (oldest) {
      loadPage(oldest.timestamp, false);
    }
  };

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h1"
            description="Persisted log of commands, events, status changes, and errors"
            actions={
              <Select
                selectedOption={
                  CATEGORY_OPTIONS.find((option) => option.value === (category ?? '')) ?? null
                }
                onChange={({ detail }) =>
                  setCategory(
                    (detail.selectedOption.value || undefined) as ActivityCategory | undefined
                  )
                }
                options={CATEGORY_OPTIONS}
              />
            }
          >
            History
          </Header>
        }
      >
        <Table
          columnDefinitions={[
            {
              id: 'time',
              header: 'Time',
              cell: (item: ActivityLogEntry) => new Date(item.timestamp).toLocaleString(),
            },
            {
              id: 'category',
              header: 'Category',
              cell: (item: ActivityLogEntry) => (
                <Badge color={getCategoryColor(item.category)}>{item.category}</Badge>
              ),
            },
            {
              id: 'event',
              header: 'Event',
              cell: (item: ActivityLogEntry) => item.event,
            },
            {
              id: 'summary',
              header: 'Summary',
              cell: (item: ActivityLogEntry) => summarizeActivityEntry(item),
            },
          ]}
          items={entries}
          loading={loading}
          loadingText="Loading activity..."
          empty={
            <Box textAlign="center" color="inherit">
              <b>No activity recorded</b>
            </Box>
          }
          footer={
            hasMore ? (
              <Box textAlign="center">
                <Button onClick={loadOlder} loading={loading}>
                  Load older
                </Button>
              </Box>
            ) : undefined
          }
        />
      </Container>
    </SpaceBetween>
  );
}
