import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_SERVER_PORT } from '@turingmod/shared';
import type { LevelWithSilent } from 'pino';
import { singleton } from 'tsyringe';
import { z } from 'zod';
import { ENV_FILE } from './paths.js';

/**
 * A configuration problem the streamer has to fix before TuringMod can start. Its message is the
 * whole explanation, so the entry point prints it without a stack trace.
 */
export class ConfigurationError extends Error {}

/**
 * The master password, which the stored integration credentials are encrypted with. Required, with
 * no default: a default password is in the source for anyone to read, so credentials encrypted with
 * it are as good as plain text to whoever gets a copy of the database.
 *
 * @param envFile Where `.env` is expected, and whether it exists, for the message when it's missing.
 */
export function requireMasterPassword(
  value: string | undefined,
  envFile: { path: string; exists: boolean }
): string {
  if (value !== undefined && value.trim() !== '') {
    return value;
  }

  const why =
    'MASTER_PASSWORD encrypts the credentials TuringMod stores for its integrations. Choose it ' +
    'before connecting any of them: changing it later makes the stored credentials unreadable, ' +
    'and each integration then has to be set up again.';

  if (!envFile.exists) {
    throw new ConfigurationError(
      [
        `TuringMod needs a .env file, and there is none at ${envFile.path}.`,
        '',
        'Create it from the template in the repository root, then set MASTER_PASSWORD in it:',
        '',
        '  cp .env.example .env',
        '',
        why,
      ].join('\n')
    );
  }
  throw new ConfigurationError(
    [
      `MASTER_PASSWORD is ${value === undefined ? 'not set' : 'empty'}. Set it in ${envFile.path}`,
      '(see .env.example for every setting).',
      '',
      why,
    ].join('\n')
  );
}

/** Environment variables that are set but blank count as unset, as `.env` files write "default". */
function blankAsUnset(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** Pino's levels, which is what LOG_LEVEL is handed to. */
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * The environment variables TuringMod reads. Not strict: the environment holds every other
 * variable of the shell too. A value that is set must be valid; only an unset one gets the default.
 */
const EnvironmentSchema = z.object({
  SERVER_PORT: z.preprocess(
    blankAsUnset,
    z
      .string()
      .regex(/^\d+$/, 'must be a whole number from 1 to 65535')
      .transform(Number)
      .pipe(z.int().min(1, 'must be from 1 to 65535').max(65535, 'must be from 1 to 65535'))
      .optional()
  ),
  HOST: z.preprocess(
    blankAsUnset,
    z
      .enum(
        ['127.0.0.1', 'localhost'],
        'must be 127.0.0.1 or localhost: TuringMod only listens locally'
      )
      .optional()
  ),
  DB_PATH: z.preprocess(blankAsUnset, z.string().optional()),
  LOG_LEVEL: z.preprocess(
    blankAsUnset,
    z.enum(LOG_LEVELS, `must be one of ${LOG_LEVELS.join(', ')}`).optional()
  ),
  FRONTEND_DIST_PATH: z.preprocess(blankAsUnset, z.string().optional()),
});

export interface Configuration {
  serverPort: number;
  host: string;
  dbPath: string;
  logLevel: LevelWithSilent;
  masterPassword: string;
  frontendDistPath: string;
}

/**
 * Read TuringMod's configuration from environment variables. Every problem is reported together, in
 * one ConfigurationError naming each variable and the value it has, so a typo is never silently
 * replaced by a default (a wrong SERVER_PORT would otherwise break every OAuth redirect URI).
 *
 * @param envFile Where `.env` is expected, and whether it exists, for the MASTER_PASSWORD message.
 */
export function parseEnvironment(
  env: NodeJS.ProcessEnv,
  envFile: { path: string; exists: boolean }
): Configuration {
  const problems: string[] = [];

  if (env.WS_PORT !== undefined && env.SERVER_PORT === undefined) {
    // Renamed because it was never only the WebSocket's port. Refuse rather than ignore it, so
    // a customized port can't silently fall back to the default.
    problems.push('WS_PORT has been renamed to SERVER_PORT; set SERVER_PORT instead.');
  }

  const parsed = EnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]);
      problems.push(`${name} is ${JSON.stringify(env[name])}: ${issue.message}.`);
    }
  }

  let masterPassword = '';
  try {
    masterPassword = requireMasterPassword(env.MASTER_PASSWORD, envFile);
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    problems.push(error.message);
  }

  if (!parsed.success || problems.length > 0) {
    throw new ConfigurationError(problems.join('\n\n'));
  }

  const vars = parsed.data;
  const dirname = fileURLToPath(new URL('.', import.meta.url));
  return {
    serverPort: vars.SERVER_PORT ?? DEFAULT_SERVER_PORT,
    host: vars.HOST ?? DEFAULT_HOST,
    dbPath: vars.DB_PATH ?? join(process.cwd(), 'turingmod.db'),
    logLevel: vars.LOG_LEVEL ?? 'info',
    masterPassword,
    frontendDistPath:
      vars.FRONTEND_DIST_PATH ?? join(dirname, '..', '..', '..', 'frontend', 'dist'),
  };
}

@singleton()
export class TuringModConfig implements Configuration {
  /**
   * The port the backend listens on: the HTTP server, the WebSocket endpoint it hosts, and the
   * OAuth redirect URIs, which providers send the browser back to.
   */
  readonly serverPort: number;

  /** Server host: loopback only */
  readonly host: string;

  /** Database file: DB_PATH, or `turingmod.db` in the working directory */
  readonly dbPath: string;

  /** Log level */
  readonly logLevel: LevelWithSilent;

  /** Master password the stored integration credentials are encrypted with (required) */
  readonly masterPassword: string;

  /** Frontend static files directory (for production) */
  readonly frontendDistPath: string;

  constructor() {
    const config = parseEnvironment(process.env, { path: ENV_FILE, exists: existsSync(ENV_FILE) });
    this.serverPort = config.serverPort;
    this.host = config.host;
    this.dbPath = config.dbPath;
    this.logLevel = config.logLevel;
    this.masterPassword = config.masterPassword;
    this.frontendDistPath = config.frontendDistPath;
  }
}
