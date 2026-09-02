/**
 * Incremental splitter for a server-streamed JSON response body.
 *
 * `liveChat.messages.stream` is a server-streaming RPC exposed over HTTP transcoding, so its body
 * is a sequence of `LiveChatMessageListResponse` objects delivered over a long-lived connection
 * rather than one document. Discovery declares the response as a single object — that is a
 * code-generator artifact (the generator emits `response.$ref` identically for unary and streaming
 * methods), so it tells us the shape of one frame but nothing about how frames are delimited.
 *
 * Rather than bet on a delimiter we can't verify without a live broadcast, this scans for balanced
 * top-level objects and ignores whatever sits between them. That treats a chunked JSON array
 * (`[{..},{..}`), newline-delimited objects, and bare concatenated objects identically. Chunk
 * boundaries may fall anywhere — mid-key, mid-string, even between a backslash and the character it
 * escapes — so all scanner state persists across `push()` calls.
 */

/**
 * Cap on a single in-progress frame. A frame that never closes means we are not looking at the
 * response we think we are; fail loudly instead of buffering the whole stream into memory.
 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export class JsonFrameParser {
  private buffer = '';
  /** How much of `buffer` the scanner has already examined. */
  private scanned = 0;
  /** Brace depth. Zero means we are between frames. */
  private depth = 0;
  private inString = false;
  private escaped = false;
  /** Index into `buffer` where the in-progress frame began, or -1 between frames. */
  private frameStart = -1;

  /**
   * Feed the next chunk of the body and get back every frame it completed.
   *
   * @throws if a frame's JSON is malformed, or if one frame exceeds {@link MAX_FRAME_BYTES}.
   */
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const frames: unknown[] = [];

    for (let i = this.scanned; i < this.buffer.length; i++) {
      const char = this.buffer[i];

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (char === '\\') {
          this.escaped = true;
        } else if (char === '"') {
          this.inString = false;
        }
        continue;
      }

      if (char === '"') {
        this.inString = true;
      } else if (char === '{') {
        if (this.depth === 0) {
          this.frameStart = i;
        }
        this.depth += 1;
      } else if (char === '}') {
        // A stray closer between frames isn't ours to interpret; skipping it keeps depth honest.
        if (this.depth === 0) {
          continue;
        }
        this.depth -= 1;
        if (this.depth === 0 && this.frameStart >= 0) {
          frames.push(JSON.parse(this.buffer.slice(this.frameStart, i + 1)));
          this.frameStart = -1;
        }
      }
      // Everything else is either structural padding between frames (whitespace, ',', '[', ']') or
      // ordinary content inside one. Brackets never affect depth, so nested arrays need no case.
    }

    this.scanned = this.buffer.length;

    // Release what can no longer be part of a frame: everything before the in-progress one, or the
    // whole buffer when we're between frames. Without this the buffer would grow for the life of
    // the stream.
    const keepFrom = this.frameStart >= 0 ? this.frameStart : this.buffer.length;
    if (keepFrom > 0) {
      this.buffer = this.buffer.slice(keepFrom);
      this.scanned -= keepFrom;
      if (this.frameStart >= 0) {
        this.frameStart = 0;
      }
    }

    if (this.buffer.length > MAX_FRAME_BYTES) {
      throw new Error(
        `YouTube chat stream frame exceeded ${MAX_FRAME_BYTES} bytes without closing; ` +
          'the response body is not the expected sequence of JSON objects'
      );
    }

    return frames;
  }
}
