import {
  type ArduinoConfig,
  ArduinoConfigSchema,
  IntegrationName,
  IntegrationStatus,
  messageOf,
} from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { type RawData, WebSocket } from 'ws';
import { EventBus } from '../../../core/EventBus.js';
import { Logger } from '../../../utils/Logger.js';
import { BaseIntegration } from '../../BaseIntegration.js';
import { ReconnectBackoff } from '../../ReconnectBackoff.js';
import {
  type ArduinoDevice,
  DeviceMessageSchema,
  helloMessage,
  parseFrame,
  readHello,
} from './arduinoProtocol.js';

/** How long the board has to accept the connection, and then to answer `hello`. */
const CONNECT_TIMEOUT_MS = 5_000;
const HELLO_TIMEOUT_MS = 5_000;

/** A ping this often; a board that hasn't answered the previous one by the next is gone. */
const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * The most frames a second that are handled; the rest of that second's are dropped. Far above
 * what the protocol needs (gesture replies, button presses), so it only bites on a firmware bug
 * that would otherwise flood the bus, the console's feed and the log.
 */
const MAX_FRAMES_PER_SECOND = 20;

/**
 * The connection to a Wi-Fi Arduino (an ESP32 or similar) running TuringMod firmware.
 *
 * The board runs the WebSocket server and TuringMod connects to it, since TuringMod only listens
 * on localhost. It is CONNECTED only once the board has answered `hello`, so a socket to
 * something that isn't TuringMod firmware never looks like a working device; anything else the
 * board sends before that answer is ignored. While started it keeps reconnecting, like OBS: a
 * board reboots, loses Wi-Fi, or is switched on after TuringMod. Firmware speaking another
 * protocol version, or answering `hello` with something unreadable, is ERROR instead, since only
 * reflashing fixes it.
 *
 * Everything the board sends after `hello` is published as `arduino.message`.
 */
@singleton()
export class ArduinoIntegration extends BaseIntegration {
  readonly name = IntegrationName.ARDUINO;

  private config: ArduinoConfig = ArduinoConfigSchema.parse({});
  private socket: WebSocket | null = null;
  /** The board on the other end, once it has answered `hello`. */
  private device: ArduinoDevice | null = null;
  /** Bumped by `start()` and `stop()`, so an attempt or retry that outlives either is dropped. */
  private generation = 0;
  private readonly backoff = new ReconnectBackoff();
  /** The current one-second window of the frame rate limit. */
  private frameWindowStart = 0;
  private framesInWindow = 0;
  /** Whether this connection has already warned about a frame it couldn't read. */
  private warnedUnreadable = false;

  constructor(
    private eventBus: EventBus,
    logger: Logger
  ) {
    super(logger, { component: 'ArduinoIntegration' });
  }

  override initialize(stored: unknown): Promise<void> {
    this.config = this.parseConfig(ArduinoConfigSchema, stored);
    this.logger.debug('Arduino integration initialized', { url: this.config.url });
    return Promise.resolve();
  }

  /** The board's address, so the setup dialog can show the one in use. */
  override getAddress(): string {
    return this.config.url;
  }

  /**
   * Connect to the board. Resolves once it has answered `hello`, or once it has turned out to be
   * unreachable and a retry is scheduled (status CONNECTING); rejects only for firmware that
   * retrying can't fix.
   */
  async start(): Promise<void> {
    this.logger.debug('Starting Arduino integration');
    const generation = ++this.generation;
    this.backoff.reset();
    this.closeSocket();
    this.setStatus(IntegrationStatus.CONNECTING);
    await this.connect(generation);
  }

  stop(): Promise<void> {
    this.logger.debug('Stopping Arduino integration');
    this.generation++;
    this.backoff.cancel();
    this.closeSocket();
    this.setStatus(IntegrationStatus.DISCONNECTED);
    return Promise.resolve();
  }

  /** The connected board as it described itself, or null when none is connected. */
  getDevice(): ArduinoDevice | null {
    return this.device;
  }

  /**
   * One connection attempt, settled once the board has answered `hello` or the attempt has
   * failed. A failure retrying can fix schedules the next attempt; one it can't is reported as
   * ERROR and rejected.
   */
  private connect(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.url, { handshakeTimeout: CONNECT_TIMEOUT_MS });
      this.socket = socket;
      this.warnedUnreadable = false;
      /** Why the socket is closing, when this side decided it. */
      let closeReason: unknown;
      /** Set for a failure only reflashing fixes; the close then reports it instead of retrying. */
      let unrecoverable: string | null = null;
      let helloTimer: NodeJS.Timeout | null = null;
      let heartbeat: NodeJS.Timeout | null = null;
      let answeredPing = true;

      const fail = (reason: string) => {
        closeReason = new Error(reason);
        socket.terminate();
      };

      socket.on('open', () => {
        socket.send(helloMessage());
        helloTimer = setTimeout(() => {
          fail(`it didn't answer hello within ${HELLO_TIMEOUT_MS / 1000}s`);
        }, HELLO_TIMEOUT_MS);
      });

      socket.on('message', (raw, isBinary) => {
        if (generation !== this.generation) {
          return;
        }
        answeredPing = true;
        if (!this.withinRateLimit()) {
          return;
        }
        const text = isBinary ? undefined : decode(raw);
        const frame = text === undefined ? undefined : parseFrame(text);
        if (this.device) {
          this.publish(text, frame);
          return;
        }

        const device = readHello(frame);
        if (device === null) {
          this.logger.debug('Ignored a message from the Arduino before its hello reply', {
            message: excerpt(text),
          });
          return;
        }
        if (helloTimer) {
          clearTimeout(helloTimer);
          helloTimer = null;
        }
        if (typeof device === 'string') {
          unrecoverable = device;
          socket.terminate();
          return;
        }

        this.device = device;
        this.backoff.connected();
        heartbeat = setInterval(() => {
          if (!answeredPing) {
            fail(`it stopped answering pings for ${HEARTBEAT_INTERVAL_MS / 1000}s`);
            return;
          }
          answeredPing = false;
          socket.ping();
        }, HEARTBEAT_INTERVAL_MS);
        this.setStatus(IntegrationStatus.CONNECTED);
        this.logger.info(
          `Connected to ${device.name} (firmware ${device.firmware}, ${device.servos} servos)`
        );
        resolve();
      });

      socket.on('pong', () => {
        answeredPing = true;
      });

      // Always followed by 'close', which decides what to do.
      socket.on('error', (error) => {
        closeReason ??= error;
      });

      socket.on('close', () => {
        if (helloTimer) {
          clearTimeout(helloTimer);
        }
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        if (generation !== this.generation) {
          resolve(); // stopped or restarted meanwhile; that call reports its own state
          return;
        }
        const wasConnected = this.device !== null;
        this.socket = null;
        this.device = null;

        if (unrecoverable) {
          this.logger.error(unrecoverable);
          this.setStatus(IntegrationStatus.ERROR, unrecoverable);
          reject(new Error(unrecoverable));
          return;
        }
        if (wasConnected) {
          this.logger.warn('Arduino connection lost', { reason: messageOf(closeReason, '') });
          this.backoff.disconnected();
        }
        this.scheduleRetry(closeReason, wasConnected);
        resolve();
      });
    });
  }

  /**
   * Whether another frame fits in this second's allowance. Says so once per second when it
   * doesn't.
   */
  private withinRateLimit(): boolean {
    const now = Date.now();
    if (now - this.frameWindowStart >= 1_000) {
      this.frameWindowStart = now;
      this.framesInWindow = 0;
    }
    this.framesInWindow++;
    if (this.framesInWindow === MAX_FRAMES_PER_SECOND + 1) {
      this.logger.warn(
        `The Arduino is sending more than ${MAX_FRAMES_PER_SECOND} messages a second; ` +
          "dropping the rest of this second's"
      );
    }
    return this.framesInWindow <= MAX_FRAMES_PER_SECOND;
  }

  /**
   * Publish a message from a connected board, dropping any that isn't a typed JSON object. The
   * first such frame on a connection is a warning, and any after it only debug, so a firmware bug
   * can't fill the log.
   */
  private publish(text: string | undefined, frame: unknown): void {
    const message = DeviceMessageSchema.safeParse(frame);
    if (!message.success) {
      const note = 'Ignored a message from the Arduino that is not a JSON object with a type';
      const detail = { message: excerpt(text) };
      if (this.warnedUnreadable) {
        this.logger.debug(note, detail);
      } else {
        this.logger.warn(note, detail);
        this.warnedUnreadable = true;
      }
      return;
    }
    this.logger.debug('Message from the Arduino', message.data);
    this.eventBus.emit('arduino.message', message.data);
  }

  /**
   * Report the board as unreachable, or as lost when it was connected, and try again after a
   * delay that doubles each time.
   */
  private scheduleRetry(error: unknown, lost: boolean): void {
    const generation = this.generation;
    const delayMs = this.backoff.schedule(() => {
      // A failure here has already been reported as this integration's status.
      this.connect(generation).catch(() => {});
    });
    const reason = messageOf(error, '');
    const message =
      `${lost ? 'Lost the connection to' : "Can't reach"} the Arduino at ${this.config.url}` +
      `${reason ? ` (${reason})` : ''}; retrying in ${delayMs / 1000}s`;
    this.logger.debug(message);
    this.setStatus(IntegrationStatus.CONNECTING, message);
  }

  /** Drop the current socket, if any. Its 'close' is ignored, since the generation has moved on. */
  private closeSocket(): void {
    this.socket?.terminate();
    this.socket = null;
    this.device = null;
  }
}

/** A text frame's contents. */
function decode(raw: RawData): string {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString();
  }
  return (raw instanceof ArrayBuffer ? Buffer.from(raw) : raw).toString();
}

/** The start of a frame, for a log line. */
function excerpt(text: string | undefined): string {
  return text === undefined ? '(binary)' : text.slice(0, 200);
}
