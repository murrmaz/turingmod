import type {
  DataQueryRowsPayload,
  DataRowsPayload,
  DataTablesPayload,
  EmptyPayload,
  IWebSocketMessage,
} from '@turingmod/shared';
import { createErrorMessage, createMessage, MessageType, messageOf } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { DataInspector } from '../../database/DataInspector.js';
import { Logger } from '../../utils/Logger.js';

/**
 * Data message handler
 * Serves the console's read-only Data page. Everything it can read, and what it masks, is decided
 * by DataInspector.
 */
@singleton()
export class DataHandler {
  private logger: Logger;

  constructor(
    private inspector: DataInspector,
    logger: Logger
  ) {
    this.logger = logger.child({ component: 'DataHandler' });
  }

  handleListTables(message: IWebSocketMessage<EmptyPayload>): Promise<IWebSocketMessage> {
    return Promise.resolve(
      this.answer(message.id, () =>
        createMessage<DataTablesPayload>(
          MessageType.DATA_TABLES,
          { tables: this.inspector.listTables() },
          message.id
        )
      )
    );
  }

  handleQueryRows(message: IWebSocketMessage<DataQueryRowsPayload>): Promise<IWebSocketMessage> {
    return Promise.resolve(
      this.answer(message.id, () =>
        createMessage<DataRowsPayload>(
          MessageType.DATA_ROWS,
          this.inspector.queryRows(message.payload),
          message.id
        )
      )
    );
  }

  private answer(id: string, read: () => IWebSocketMessage): IWebSocketMessage {
    try {
      return read();
    } catch (error) {
      this.logger.warn('Data inspector request failed', { error: messageOf(error) });
      return createErrorMessage('DATA_QUERY_FAILED', messageOf(error, 'Failed to read data'), id);
    }
  }
}
