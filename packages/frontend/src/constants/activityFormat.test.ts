import { ActivityCategory, type ActivityLogEntry } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { summarizeActivityEntry } from './activityFormat';

const commandEntry = (data: Record<string, unknown>): ActivityLogEntry => ({
  id: '1',
  category: ActivityCategory.COMMAND,
  event: 'command.executed',
  data: { command: 'title', username: 'mod', ...data },
  timestamp: 0,
});

describe('summarizeActivityEntry', () => {
  it('marks a successful command', () => {
    expect(summarizeActivityEntry(commandEntry({ success: true }))).toBe('!title by mod ✓');
  });

  it('gives the reason a command failed', () => {
    expect(
      summarizeActivityEntry(commandEntry({ success: false, reason: 'Helix rejected the update' }))
    ).toBe('!title by mod ✗: Helix rejected the update');
  });
});
