import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseOrThrow } from './parseOrThrow.js';

describe('parseOrThrow', () => {
  const schema = z.strictObject({ port: z.number(), host: z.string() });

  it('returns what the schema parses', () => {
    expect(parseOrThrow(schema, { port: 1, host: 'a' }, 'Bad')).toEqual({ port: 1, host: 'a' });
  });

  it('says what it was parsing, and names every field that was wrong', () => {
    const parsing = () => parseOrThrow(schema, { port: 'x' }, 'Invalid config');

    expect(parsing).toThrow(/^Invalid config:\n/);
    expect(parsing).toThrow(/port/);
    expect(parsing).toThrow(/host/);
  });
});
