import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS } from './index.js';
import type { Migration } from './MigrationRunner.js';

const MIGRATIONS = new URL('./', import.meta.url);

const migrationFiles = () =>
  readdirSync(MIGRATIONS).filter((file) => /^\d+_.*\.ts$/.test(file) && !file.endsWith('.test.ts'));

describe('ALL_MIGRATIONS', () => {
  it('lists every migration file, since one left out would never run', async () => {
    const files = migrationFiles();
    const found = await Promise.all(
      files.map(async (file) => {
        const module = await import(new URL(file, MIGRATIONS).href);
        return Object.values(module) as Migration[];
      })
    );

    expect(files).not.toEqual([]); // the pattern still finds them
    expect(found.flat().sort((a, b) => a.version - b.version)).toEqual(ALL_MIGRATIONS);
  });

  it('numbers each file by its version, with no version used twice', () => {
    const numbers = migrationFiles().map((file) => Number.parseInt(file, 10));

    expect(new Set(numbers).size).toBe(numbers.length);
    // Two migrations sharing a version would skip the second as already applied.
    expect(ALL_MIGRATIONS.map(({ version }) => version)).toEqual(numbers.sort((a, b) => a - b));
  });
});
