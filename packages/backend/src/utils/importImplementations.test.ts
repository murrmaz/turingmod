import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importClasses, importImplementations } from './importImplementations.js';

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

describe('importClasses', () => {
  let root: string;
  let dir: URL;
  let Base: new () => object;

  const isBaseSubclass = (value: unknown): value is new () => object =>
    typeof value === 'function' && value.prototype instanceof Base;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'classes-'));
    await mkdir(join(root, 'implementations', 'beta', 'nested'), { recursive: true });
    // Outside the scanned directory, as an abstract base class must be.
    await writeFile(join(root, 'Base.js'), 'export class Base {}\n');
    ({ Base } = await import(pathToFileURL(join(root, 'Base.js')).href));
    dir = pathToFileURL(`${join(root, 'implementations')}/`);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = (file: string, body: string) =>
    writeFile(join(root, 'implementations', file), body);

  it('finds every exported subclass in subdirectories, whatever the file or export', async () => {
    await write(
      'Alpha.js',
      "import { Base } from '../Base.js';\nexport class Alpha extends Base {}\n"
    );
    await write(
      'beta/BetaThing.js',
      "import { Base } from '../../Base.js';\nexport default class Beta extends Base {}\n"
    );
    await write(
      'beta/nested/gamma.js',
      "import { Base } from '../../../Base.js';\nclass Middle extends Base {}\nexport class Gamma extends Middle {}\n"
    );

    const classes = await importClasses(dir, isBaseSubclass);

    expect(classes.map((c) => c.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('skips helper modules and exports that are not subclasses', async () => {
    await write('helpers.js', 'export const helper = 1;\nexport function parse() {}\n');
    await write('Unrelated.js', 'export default class Unrelated {}\n');
    await write('Alpha.js.map', '{}');

    await expect(importClasses(dir, isBaseSubclass)).resolves.toEqual([]);
  });

  it('returns a class exported from two modules once', async () => {
    await write(
      'Alpha.js',
      "import { Base } from '../Base.js';\nexport class Alpha extends Base {}\n"
    );
    await write('index.js', "export { Alpha } from './Alpha.js';\n");

    const classes = await importClasses(dir, isBaseSubclass);

    expect(classes.map((c) => c.name)).toEqual(['Alpha']);
  });
});
