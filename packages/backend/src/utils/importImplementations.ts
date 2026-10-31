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
  const classes: InjectableClass<T>[] = [];
  for (const { file, exports } of await importModules(dir, { allowMissing })) {
    if (typeof exports.default !== 'function') {
      throw new Error(`${kind} file '${file}' has no default export`);
    }
    classes.push(exports.default as InjectableClass<T>);
  }
  return classes;
}

/**
 * Import every module in a directory and its subdirectories, and return every class any of them
 * exports that `isMatch` accepts, in module path order.
 *
 * Unlike importImplementations(), what a class is decides whether it is kept, not where it is
 * exported or what its file is called, so helper modules can sit beside the classes. Each class is
 * returned once, however many modules export it.
 *
 * @param dir - The directory as a file URL, with a trailing slash so files resolve inside it.
 * @param isMatch - Whether an export is one of the classes wanted; called on every export.
 */
export async function importClasses<T>(
  dir: URL,
  isMatch: (value: unknown) => value is InjectableClass<T>
): Promise<InjectableClass<T>[]> {
  const classes = new Set<InjectableClass<T>>();
  for (const { exports } of await importModules(dir, { recursive: true })) {
    for (const value of Object.values(exports)) {
      if (isMatch(value)) {
        classes.add(value);
      }
    }
  }
  return [...classes];
}

/** One imported module: its path relative to the directory, and what it exports. */
interface ImportedModule {
  file: string;
  exports: Record<string, unknown>;
}

/**
 * Import every compiled module (`.js`) in a directory, and in its subdirectories with
 * `recursive`, in path order. The order is only so the result is the same on every run
 * (readdir's order isn't guaranteed); callers must not depend on it.
 */
async function importModules(
  dir: URL,
  { allowMissing = false, recursive = false }: { allowMissing?: boolean; recursive?: boolean }
): Promise<ImportedModule[]> {
  let files: string[];
  try {
    files = await readdir(dir, { recursive });
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const modules: ImportedModule[] = [];
  for (const file of files.filter((name) => name.endsWith('.js')).sort()) {
    modules.push({ file, exports: await import(new URL(file, dir).href) });
  }
  return modules;
}
