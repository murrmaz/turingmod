import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importImplementations } from './importImplementations.js';

describe('importImplementations', () => {
  let root: string;
  let dir: URL;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'impls-'));
    await mkdir(join(root, 'implementations'));
    dir = pathToFileURL(`${join(root, 'implementations')}/`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = (file: string, body: string) =>
    writeFile(join(root, 'implementations', file), body);

  it("returns each module's default-exported class, skipping maps and declarations", async () => {
    await write('Alpha.js', 'export default class Alpha {}\nexport const helper = 1;\n');
    await write('Alpha.js.map', '{}');
    await write('Alpha.d.ts', 'export default class Alpha {}\n');

    const classes = await importImplementations(dir, 'Thing');

    expect(classes.map((c) => c.name)).toEqual(['Alpha']);
  });

  it('fails on a module without a default export', async () => {
    await write('Broken.js', 'export class Broken {}\n');

    await expect(importImplementations(dir, 'Thing')).rejects.toThrow(
      "Thing file 'Broken.js' has no default export"
    );
  });

  it('treats a missing directory as empty only when allowed', async () => {
    const missing = pathToFileURL(`${join(root, 'nothing-here')}/`);

    await expect(importImplementations(missing, 'Thing', { allowMissing: true })).resolves.toEqual(
      []
    );
    await expect(importImplementations(missing, 'Thing')).rejects.toThrow(/ENOENT/);
  });
});
