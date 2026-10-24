import type {
  DataQueryRowsPayload,
  DataRowsPayload,
  DataTablesPayload,
  EmptyPayload,
  ErrorPayload,
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

  handleListTables(
    message: IWebSocketMessage<EmptyPayload>
  ): Promise<IWebSocketMessage<DataTablesPayload | ErrorPayload>> {
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

  handleQueryRows(
    message: IWebSocketMessage<DataQueryRowsPayload>
  ): Promise<IWebSocketMessage<DataRowsPayload | ErrorPayload>> {
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

  private answer<T>(
    id: string,
    read: () => IWebSocketMessage<T>
  ): IWebSocketMessage<T | ErrorPayload> {
    try {
      return read();
    } catch (error) {
      this.logger.warn('Data inspector request failed', { error: messageOf(error) });
      return createErrorMessage('DATA_QUERY_FAILED', messageOf(error, 'Failed to read data'), id);
    }
  }
}
