import type {
  ActivityListPayload,
  CommandListPayload,
  CommandResultPayload,
  DataRowsPayload,
  DataTablesPayload,
  ErrorPayload,
  EventNotificationPayload,
  IntegrationListPayload,
  IntegrationStatusPayload,
  MessageType,
  OAuthAuthUrlResponsePayload,
  OAuthCodeReceivedPayload,
  OAuthExchangeResultPayload,
  PlatformLiveStatePayload,
  YouTubeChatStatePayload,
} from './messages.js';
import type { RequestType } from './requests.js';

/**
 * What the server sends: the payload of each message type it sends, whether as the answer to a
 * request or pushed unasked. The console reads a message's payload by its type through this map.
 */
export interface ServerPayloads {
  [MessageType.COMMAND_RESULT]: CommandResultPayload;
  [MessageType.COMMAND_LIST]: CommandListPayload;
  [MessageType.INTEGRATION_STATUS]: IntegrationStatusPayload;
  [MessageType.INTEGRATION_LIST]: IntegrationListPayload;
  [MessageType.EVENT_NOTIFICATION]: EventNotificationPayload;
  [MessageType.ACTIVITY_LIST]: ActivityListPayload;
  [MessageType.ERROR]: ErrorPayload;
  [MessageType.OAUTH_AUTH_URL_RESPONSE]: OAuthAuthUrlResponsePayload;
  [MessageType.OAUTH_EXCHANGE_RESULT]: OAuthExchangeResultPayload;
  [MessageType.OAUTH_CODE_RECEIVED]: OAuthCodeReceivedPayload;
  [MessageType.YOUTUBE_CHAT_STATE]: YouTubeChatStatePayload;
  [MessageType.PLATFORM_LIVE_STATE]: PlatformLiveStatePayload;
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
  [MessageType.INTEGRATION_START]: MessageType.INTEGRATION_STATUS;
  [MessageType.INTEGRATION_STOP]: MessageType.INTEGRATION_STATUS;
  [MessageType.INTEGRATION_LIST]: MessageType.INTEGRATION_LIST;
  [MessageType.INTEGRATION_CONFIGURE]: MessageType.INTEGRATION_STATUS;
  [MessageType.OAUTH_GET_AUTH_URL]: MessageType.OAUTH_AUTH_URL_RESPONSE;
  [MessageType.OAUTH_EXCHANGE_CODE]: MessageType.OAUTH_EXCHANGE_RESULT;
  [MessageType.ACTIVITY_QUERY]: MessageType.ACTIVITY_LIST;
  [MessageType.YOUTUBE_GO_LIVE]: MessageType.YOUTUBE_CHAT_STATE;
  [MessageType.YOUTUBE_GO_OFFLINE]: MessageType.YOUTUBE_CHAT_STATE;
  [MessageType.YOUTUBE_GET_CHAT_STATE]: MessageType.YOUTUBE_CHAT_STATE;
  [MessageType.PLATFORM_GET_LIVE_STATE]: MessageType.PLATFORM_LIVE_STATE;
  [MessageType.DATA_LIST_TABLES]: MessageType.DATA_TABLES;
  [MessageType.DATA_QUERY_ROWS]: MessageType.DATA_ROWS;
}

/**
 * The payload a request of type `T` is answered with when it succeeds. Indexing by `T` is also the
 * check that every request type has an entry in ResponseTypes, naming a type in ServerPayloads.
 */
export type ResponsePayload<T extends RequestType> = ServerPayloads[ResponseTypes[T]];
