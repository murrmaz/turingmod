import type { DataColumnInfo } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

const column = (name: string): DataColumnInfo => ({
  name,
  type: 'TEXT',
  masked: false,
  isTimestamp: false,
  isJson: false,
});

describe('toCsv', () => {
  it('writes a header and one line per row, empty for null', () => {
    const csv = toCsv(
      [column('word'), column('count')],
      [
        { word: 'hello', count: 3 },
        { word: null, count: 0 },
      ]
    );

    expect(csv).toBe('word,count\r\nhello,3\r\n,0');
  });

  it('quotes fields holding commas, quotes or line breaks', () => {
    const csv = toCsv([column('text')], [{ text: 'say "hi", then\nleave' }]);

    expect(csv).toBe('text\r\n"say ""hi"", then\nleave"');
  });

  it.each([
    [
      '=HYPERLINK("https://evil.example","click")',
      '"\'=HYPERLINK(""https://evil.example"",""click"")"',
    ],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tTAB', "'\tTAB"],
  ])('keeps %j from running as a formula', (text, field) => {
    expect(toCsv([column('input')], [{ input: text }])).toBe(`input\r\n${field}`);
  });

  it('leaves numbers alone, negative ones included', () => {
    expect(toCsv([column('n')], [{ n: -5 }])).toBe('n\r\n-5');
  });
});
