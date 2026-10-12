import { readdir } from 'node:fs/promises';

// biome-ignore lint/suspicious/noExplicitAny: constructor param types vary per implementation; tsyringe resolves them from decorator metadata.
export type InjectableClass<T> = new (...args: any[]) => T;

/**
 * Import the default-exported class of every module in an implementations directory.
 *
 * Convention: each file has a default export of its class, decorated with @injectable() so
 * tsyringe can construct it from its typed constructor parameters alone. Only the default export
 * is returned — other exports from the same file (helpers, types) are ignored. The caller resolves
 * the classes; this only finds them.
 *
 * Every non-test file is imported, so a file without a default export is a hard startup
 * failure, not a silently skipped file.
 *
 * @param dir - The directory as a file URL, with a trailing slash so files resolve inside it.
 * @param kind - What the files hold ("Command", "Reward handler"), for error messages.
 * @param allowMissing - Treat a missing directory as empty. `tsc` emits no directory for a
 *   source directory with no files in it, so a set that is legitimately still empty has none.
 */
export async function importImplementations<T>(
  dir: URL,
  kind: string,
  { allowMissing = false }: { allowMissing?: boolean } = {}
): Promise<InjectableClass<T>[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  // Deduplicate: prefer .ts, fall back to .js (dev and production both run from dist/ now,
  // but this keeps the loader correct if it's ever pointed at a raw src/ directory again)
  const moduleFiles = new Map<string, string>();
  for (const file of files) {
    if (file.endsWith('.d.ts') || file.endsWith('.map')) continue;
    // Tests live beside their subjects (repo convention), but these directories are imported
    // wholesale at startup — importing a suite would run vitest outside the test runner and
    // abort boot. Skip them rather than relocating the tests away from their subjects.
    if (/\.test\.[cm]?[jt]s$/.test(file)) continue;
    if (file.endsWith('.ts')) {
      moduleFiles.set(file.slice(0, -3), file);
    } else if (file.endsWith('.js') && !moduleFiles.has(file.slice(0, -3))) {
      moduleFiles.set(file.slice(0, -3), file);
    }
  }

  const classes: InjectableClass<T>[] = [];
  for (const file of moduleFiles.values()) {
    const mod: { default?: InjectableClass<T> } = await import(new URL(file, dir).href);

    if (typeof mod.default !== 'function') {
      throw new Error(`${kind} file '${file}' has no default export`);
    }

    classes.push(mod.default);
  }
  return classes;
}
