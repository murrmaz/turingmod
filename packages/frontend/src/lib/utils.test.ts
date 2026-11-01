import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it("keeps a size from index.css beside a colour, since they don't conflict", () => {
    expect(cn('text-data text-muted-foreground')).toBe('text-data text-muted-foreground');
  });

  it('lets a size from index.css override an earlier size', () => {
    expect(cn('text-xs', 'text-caption')).toBe('text-caption');
  });

  it("lets the sheet's width override an earlier width", () => {
    expect(cn('sm:max-w-sm', 'sm:max-w-sheet')).toBe('sm:max-w-sheet');
  });
});
