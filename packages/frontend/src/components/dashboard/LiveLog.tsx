import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ToggleButton from '@cloudscape-design/components/toggle-button';
import { ActivityCategory } from '@turingmod/shared';
import { useEffect, useRef } from 'react';
import { getCategoryColor, summarizeActivityEntry } from '../../constants/activityFormat';
import { useLiveLog } from '../../hooks/useLiveLog';

const CATEGORIES = Object.values(ActivityCategory);

/**
 * Live activity tail.
 * Ephemeral, client-side feed of chat/commands/events/status/errors as they happen.
 * See the History page for a persisted, queryable view (chat excluded there).
 */
export function LiveLog() {
  const { entries, categoryFilter, toggleCategory } = useLiveLog();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest entry (bottom) as the feed grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on every new entry to keep the view pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length]);

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Real-time feed of chat, commands, and events"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {CATEGORIES.map((category) => (
                <ToggleButton
                  key={category}
                  pressed={categoryFilter.has(category)}
                  onChange={() => toggleCategory(category)}
                >
                  {category}
                </ToggleButton>
              ))}
            </SpaceBetween>
          }
        >
          Live Activity
        </Header>
      }
    >
      <div
        ref={scrollRef}
        style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {entries.length === 0 ? (
          <Box textAlign="center" color="inherit">
            <Box padding={{ vertical: 'l' }} variant="p" color="inherit">
              No activity yet.
            </Box>
          </Box>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                padding: '2px 0',
                fontSize: 13,
              }}
            >
              <Box color="text-status-inactive" variant="span">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </Box>
              <Badge color={getCategoryColor(entry.category)}>{entry.category}</Badge>
              <Box variant="span">{summarizeActivityEntry(entry)}</Box>
            </div>
          ))
        )}
      </div>
    </Container>
  );
}
