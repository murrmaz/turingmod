import { fileURLToPath } from 'node:url';

/**
 * The repository root's `.env`, located from this file rather than the working directory: npm runs
 * workspace scripts from `packages/backend`, while the README (and `.env.example`) put it at the
 * root, where the frontend's Vite config reads it too.
 */
export const ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

/**
 * Load `.env` into `process.env`, if there is one. Variables already set in the environment take
 * precedence over the file. Imported for its side effect, first, by each entry point, so it runs
 * before anything reads configuration.
 */
function loadEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    // No .env is fine: everything has a default or comes from the shell.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

loadEnv();
