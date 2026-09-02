import { describe, expect, it } from 'vitest';
import { JsonFrameParser } from './parseJsonFrames.js';

/**
 * Feed a body one chunk at a time and collect every frame it yields. Chunk boundaries are the whole
 * point of these tests, so nothing here may assume a chunk is a frame.
 */
function collect(chunks: string[]): unknown[] {
  const parser = new JsonFrameParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
}

/** Split a string into fixed-width chunks, so a boundary lands in a different place each time. */
function chunked(body: string, width: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += width) {
    parts.push(body.slice(i, i + width));
  }
  return parts;
}

describe('JsonFrameParser', () => {
  describe('framing', () => {
    const frames = [
      { items: [{ id: 'a' }], nextPageToken: 'p1' },
      { items: [{ id: 'b' }], nextPageToken: 'p2' },
    ];

    // The wire framing of the transcoded server-streaming response is not something we can verify
    // without a live broadcast, so every plausible shape must decode to the same frames.
    const bodies = {
      'a JSON array': `[${JSON.stringify(frames[0])},${JSON.stringify(frames[1])}]`,
      'a pretty-printed JSON array': JSON.stringify(frames, null, 2),
      'newline-delimited objects': frames.map((f) => JSON.stringify(f)).join('\n'),
      'bare concatenated objects': frames.map((f) => JSON.stringify(f)).join(''),
      'an unterminated array (stream still open)': `[${JSON.stringify(frames[0])},${JSON.stringify(
        frames[1]
      )}`,
    };

    for (const [label, body] of Object.entries(bodies)) {
      it(`decodes ${label} in one chunk`, () => {
        expect(collect([body])).toEqual(frames);
      });

      // One character at a time puts a boundary between every pair of characters, which covers
      // splits mid-key, mid-value, mid-string and between a backslash and what it escapes.
      it(`decodes ${label} one character at a time`, () => {
        expect(collect(chunked(body, 1))).toEqual(frames);
      });

      it(`decodes ${label} in ragged chunks`, () => {
        expect(collect(chunked(body, 7))).toEqual(frames);
      });
    }
  });

  describe('content that looks structural', () => {
    it('ignores braces inside message text', () => {
      const frame = { items: [{ snippet: { displayMessage: 'gg }{{ }} wp' } }] };
      expect(collect([JSON.stringify(frame)])).toEqual([frame]);
    });

    it('ignores an escaped quote followed by a brace', () => {
      const frame = { items: [{ snippet: { displayMessage: 'he said "}" and left' } }] };
      expect(collect(chunked(JSON.stringify(frame), 1))).toEqual([frame]);
    });

    it('ignores a trailing backslash before the closing quote', () => {
      const frame = { items: [{ snippet: { displayMessage: 'path\\' } }] };
      expect(collect(chunked(JSON.stringify(frame), 1))).toEqual([frame]);
    });

    it('does not treat nested arrays as frame boundaries', () => {
      const frame = { items: [{ a: [1, [2, [3]]] }, { b: [] }] };
      expect(collect(chunked(JSON.stringify(frame), 3))).toEqual([frame]);
    });
  });

  describe('incremental delivery', () => {
    it('yields nothing until a frame closes', () => {
      const parser = new JsonFrameParser();

      expect(parser.push('[{"items":[],')).toEqual([]);
      expect(parser.push('"nextPageToken":"p1"')).toEqual([]);
      expect(parser.push('}')).toEqual([{ items: [], nextPageToken: 'p1' }]);
    });

    it('yields each frame on the chunk that completes it, not at the end', () => {
      const parser = new JsonFrameParser();

      expect(parser.push('[{"id":1},{"id":2},{"id":')).toEqual([{ id: 1 }, { id: 2 }]);
      expect(parser.push('3}]')).toEqual([{ id: 3 }]);
    });

    it('yields several frames from a single chunk', () => {
      const parser = new JsonFrameParser();
      expect(parser.push('{"id":1}{"id":2}{"id":3}')).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });
  });

  describe('failure', () => {
    it('throws on malformed JSON rather than skipping the frame', () => {
      const parser = new JsonFrameParser();
      expect(() => parser.push('{"items": [,]}')).toThrow();
    });

    it('does not grow its buffer while frames keep closing', () => {
      const parser = new JsonFrameParser();
      const frame = `{"items":[{"id":"${'x'.repeat(1000)}"}]}`;

      // Far more than the frame cap in total, but no single frame approaches it. If consumed input
      // were retained this would throw.
      for (let i = 0; i < 20_000; i += 1) {
        parser.push(frame);
      }

      expect(parser.push('{"id":1}')).toEqual([{ id: 1 }]);
    });

    it('throws when one frame never closes', () => {
      const parser = new JsonFrameParser();
      const chunk = `{"items":[{"id":"${'x'.repeat(100_000)}"},`;

      expect(() => {
        for (let i = 0; i < 200; i += 1) {
          parser.push(chunk);
        }
      }).toThrow(/without closing/);
    });
  });
});
