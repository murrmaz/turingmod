import type {
  ActivityListPayload,
  CommandListPayload,
  CommandResultPayload,
  DataRowsPayload,
  DataTablesPayload,
  ErrorPayload,
  EventNotificationPayload,
  MessageType,
  OAuthAuthUrlResponsePayload,
  OAuthResultPayload,
} from './messages.js';
import type { RequestType } from './requests.js';

/**
 * What the server sends: the payload of each message type it sends, whether as the answer to a
 * request or pushed unasked. The console reads a message's payload by its type through this map.
 */
export interface ServerPayloads {
  [MessageType.COMMAND_RESULT]: CommandResultPayload;
  [MessageType.COMMAND_LIST]: CommandListPayload;
  [MessageType.EVENT_NOTIFICATION]: EventNotificationPayload;
  [MessageType.ACTIVITY_LIST]: ActivityListPayload;
  [MessageType.ERROR]: ErrorPayload;
  [MessageType.OAUTH_AUTH_URL_RESPONSE]: OAuthAuthUrlResponsePayload;
  [MessageType.OAUTH_RESULT]: OAuthResultPayload;
  [MessageType.DATA_TABLES]: DataTablesPayload;
  [MessageType.DATA_ROWS]: DataRowsPayload;
}

/** A message type the server sends. */
export type ServerMessageType = keyof ServerPayloads;

/**
 * The message type each request is answered with, under the request's id. A request that fails
 * is answered with an ERROR instead.
 */
export interface ResponseTypes {
  [MessageType.COMMAND_SIMULATE]: MessageType.COMMAND_RESULT;
  [MessageType.COMMAND_LIST]: MessageType.COMMAND_LIST;
  [MessageType.OAUTH_GET_AUTH_URL]: MessageType.OAUTH_AUTH_URL_RESPONSE;
  [MessageType.ACTIVITY_QUERY]: MessageType.ACTIVITY_LIST;
  [MessageType.DATA_LIST_TABLES]: MessageType.DATA_TABLES;
  [MessageType.DATA_QUERY_ROWS]: MessageType.DATA_ROWS;
}

/**
 * The payload a request of type `T` is answered with when it succeeds. Indexing by `T` is also the
 * check that every request type has an entry in ResponseTypes, naming a type in ServerPayloads.
 */
export type ResponsePayload<T extends RequestType> = ServerPayloads[ResponseTypes[T]];
