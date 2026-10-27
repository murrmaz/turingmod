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
 * Every module is imported, so a file without a default export is a hard startup failure, not a
 * silently skipped file. Tests are never among them: the build leaves them out of dist/.
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

  const moduleFiles = files.filter((file) => file.endsWith('.js'));

  const classes: InjectableClass<T>[] = [];
  for (const file of moduleFiles) {
    const mod: { default?: InjectableClass<T> } = await import(new URL(file, dir).href);

    if (typeof mod.default !== 'function') {
      throw new Error(`${kind} file '${file}' has no default export`);
    }

    classes.push(mod.default);
  }
  return classes;
}
