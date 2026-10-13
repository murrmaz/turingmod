import type {
  ActivityListPayload,
  ActivityQueryPayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { createActivityListMessage, createErrorMessage } from '@turingmod/shared';
import { injectable, singleton } from 'tsyringe';
import { ActivityLogRepository } from '../../database/repositories/ActivityLogRepository.js';
import { Logger } from '../../utils/Logger.js';
import { isActivityQueryPayload } from '../validation.js';

/**
 * Activity message handler
 * Handles activity log query requests (History page + live-tail backfill)
 */
@injectable()
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
  ): Promise<IWebSocketMessage<ActivityListPayload> | IWebSocketMessage> {
    if (!isActivityQueryPayload(message.payload)) {
      return Promise.resolve(
        createErrorMessage('INVALID_PAYLOAD', 'Malformed activity.query payload', message.id)
      );
    }

    const payload = message.payload ?? {};

    try {
      const entries = this.repo.findRecent(payload);
      return Promise.resolve(createActivityListMessage(entries, message.id));
    } catch (error) {
      this.logger.error('Failed to query activity log', error);
      return Promise.resolve(
        createErrorMessage(
          'ACTIVITY_QUERY_FAILED',
          error instanceof Error ? error.message : 'Failed to query activity log',
          message.id
        )
      );
    }
  }
}
