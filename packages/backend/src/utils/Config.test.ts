import { describe, expect, it } from 'vitest';
import { ConfigurationError, requireMasterPassword } from './Config.js';

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
