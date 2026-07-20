import type { ActivityLogEntry } from '@turingmod/shared';
import { ActivityCategory } from '@turingmod/shared';

export type ActivityBadgeColor = 'blue' | 'green' | 'red' | 'grey';

/**
 * Badge color per activity category. Shared between the live tail and the History table so
 * a category always reads the same regardless of which surface it's viewed from.
 */
export function getCategoryColor(category: ActivityCategory): ActivityBadgeColor {
  switch (category) {
    case ActivityCategory.CHAT:
      return 'grey';
    case ActivityCategory.COMMAND:
      return 'blue';
    case ActivityCategory.EVENT:
      return 'green';
    case ActivityCategory.STATUS:
      return 'blue';
    case ActivityCategory.ERROR:
      return 'red';
    default:
      return 'grey';
  }
}

/**
 * One-line human summary of an activity entry, rendered per category:
 * chat -> `user: message`; command -> `!cmd by user ✓/✗`; event/status/error -> a brief summary.
 */
export function summarizeActivityEntry(entry: ActivityLogEntry): string {
  const { category, event, data } = entry;

  switch (category) {
    case ActivityCategory.CHAT: {
      const username = typeof data.username === 'string' ? data.username : 'unknown';
      const message = typeof data.message === 'string' ? data.message : '';
      return `${username}: ${message}`;
    }
    case ActivityCategory.COMMAND: {
      const command = typeof data.command === 'string' ? data.command : event;
      const username = typeof data.username === 'string' ? data.username : 'unknown';
      const outcome = data.success ? '✓' : '✗';
      return `!${command} by ${username} ${outcome}`;
    }
    case ActivityCategory.STATUS: {
      const name = typeof data.name === 'string' ? data.name : event;
      const status = typeof data.status === 'string' ? data.status : '';
      return `${name} → ${status}`;
    }
    case ActivityCategory.ERROR: {
      const name = typeof data.name === 'string' ? data.name : event;
      const message = typeof data.message === 'string' ? data.message : '';
      return `${name}: ${message}`;
    }
    default:
      return event;
  }
}
