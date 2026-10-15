import { describe, expect, it } from 'vitest';
import { ConfigurationError, parseEnvironment, requireMasterPassword } from './Config.js';

const ENV_FILE = '/repo/.env';

describe('requireMasterPassword', () => {
  it('returns the password as given', () => {
    expect(requireMasterPassword(' hunter2 ', { path: ENV_FILE, exists: true })).toBe(' hunter2 ');
  });

  it('asks for a .env file when there is none', () => {
    const attempt = () => requireMasterPassword(undefined, { path: ENV_FILE, exists: false });

    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow(`TuringMod needs a .env file, and there is none at ${ENV_FILE}.`);
    expect(attempt).toThrow('cp .env.example .env');
  });

  it('names the .env file when it exists but has no MASTER_PASSWORD', () => {
    expect(() => requireMasterPassword(undefined, { path: ENV_FILE, exists: true })).toThrow(
      `MASTER_PASSWORD is not set. Set it in ${ENV_FILE}`
    );
  });

  it('refuses an empty or blank password, as .env.example leaves it', () => {
    for (const blank of ['', '   ']) {
      expect(() => requireMasterPassword(blank, { path: ENV_FILE, exists: true })).toThrow(
        'MASTER_PASSWORD is empty.'
      );
    }
  });
});

describe('parseEnvironment', () => {
  const envFile = { path: ENV_FILE, exists: true };
  const parse = (env: NodeJS.ProcessEnv) =>
    parseEnvironment({ MASTER_PASSWORD: 'hunter2', ...env }, envFile);

  it('uses the defaults for variables that are unset or blank', () => {
    for (const env of [{}, { SERVER_PORT: '', HOST: ' ', LOG_LEVEL: '', DB_PATH: '' }]) {
      const config = parse(env);
      expect(config).toMatchObject({ serverPort: 8080, host: '127.0.0.1', logLevel: 'info' });
      expect(config.dbPath).toMatch(/turingmod\.db$/);
    }
  });

  it('reads the variables that are set', () => {
    expect(
      parse({
        SERVER_PORT: '9090',
        HOST: 'localhost',
        LOG_LEVEL: 'debug',
        DB_PATH: '/data/tm.db',
        FRONTEND_DIST_PATH: '/srv/dist',
      })
    ).toEqual({
      serverPort: 9090,
      host: 'localhost',
      logLevel: 'debug',
      dbPath: '/data/tm.db',
      frontendDistPath: '/srv/dist',
      masterPassword: 'hunter2',
    });
  });

  it('refuses a port that is not a whole number rather than falling back to the default', () => {
    for (const port of ['abc', '3000x', '80.5', '-1']) {
      expect(() => parse({ SERVER_PORT: port })).toThrow(
        `SERVER_PORT is "${port}": must be a whole number from 1 to 65535.`
      );
    }
  });

  it('refuses a port out of range', () => {
    for (const port of ['0', '65536']) {
      expect(() => parse({ SERVER_PORT: port })).toThrow(
        `SERVER_PORT is "${port}": must be from 1 to 65535.`
      );
    }
  });

  it('refuses a log level pino does not have', () => {
    expect(() => parse({ LOG_LEVEL: 'verbose' })).toThrow(
      'LOG_LEVEL is "verbose": must be one of fatal, error, warn, info, debug, trace, silent.'
    );
  });

  it('refuses a host that is not loopback', () => {
    expect(() => parse({ HOST: '0.0.0.0' })).toThrow(
      'HOST is "0.0.0.0": must be 127.0.0.1 or localhost'
    );
  });

  it('refuses the old WS_PORT name', () => {
    expect(() => parse({ WS_PORT: '9090' })).toThrow('WS_PORT has been renamed to SERVER_PORT');
  });

  it('reports every problem at once, as a ConfigurationError', () => {
    const attempt = () => parseEnvironment({ SERVER_PORT: 'abc', LOG_LEVEL: 'verbose' }, envFile);

    expect(attempt).toThrow(ConfigurationError);
    expect(attempt).toThrow('SERVER_PORT is "abc"');
    expect(attempt).toThrow('LOG_LEVEL is "verbose"');
    expect(attempt).toThrow('MASTER_PASSWORD is not set.');
  });
});
