import { ENV_FILE } from './paths.js';

/**
 * Load `.env` into `process.env`, if there is one. Variables already set in the environment take
 * precedence over the file. Imported for its side effect, first, by each entry point, so it runs
 * before anything reads configuration.
 */
function loadEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    // A missing .env isn't an error here: everything can come from the shell instead, and
    // TuringModConfig names the file when something required (MASTER_PASSWORD) is missing.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

loadEnv();
