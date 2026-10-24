import type {
  ActivityListPayload,
  ActivityQueryPayload,
  ErrorPayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { createActivityListMessage, createErrorMessage, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { ActivityLogRepository } from '../../database/repositories/ActivityLogRepository.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Activity message handler
 * Handles activity log query requests (History page + live-tail backfill)
 */
@singleton()
export class ActivityHandler {
  private logger: Logger;

  constructor(
    private repo: ActivityLogRepository,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'ActivityHandler' });
  }

  handleQuery(
    message: IWebSocketMessage<ActivityQueryPayload>
  ): Promise<IWebSocketMessage<ActivityListPayload | ErrorPayload>> {
    try {
      const entries = this.repo.findRecent(message.payload);
      return Promise.resolve(createActivityListMessage(entries, message.id));
    } catch (error) {
      this.logger.error('Failed to query activity log', error);
      return Promise.resolve(
        createErrorMessage(
          'ACTIVITY_QUERY_FAILED',
          messageOf(error, 'Failed to query activity log'),
          message.id
        )
      );
    }
  }
}
