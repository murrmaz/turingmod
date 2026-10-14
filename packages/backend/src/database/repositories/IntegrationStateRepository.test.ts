import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegrationStatus } from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Encryption } from '../../utils/Encryption.js';
import { Logger } from '../../utils/Logger.js';
import { DatabaseManager } from '../DatabaseManager.js';
import { initialSchema } from '../migrations/001_initial_schema.js';
import { IntegrationStateRepository } from './IntegrationStateRepository.js';

describe('IntegrationStateRepository', () => {
  let dir: string;
  let db: DatabaseManager;
  let repo: IntegrationStateRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-integration-repo-test-'));
    db = new DatabaseManager(join(dir, 'test.sqlite'), new Logger({ level: 'silent' }));
    await db.initialize();
    initialSchema.up(db);
    const encryption = new Encryption('test-master-password', randomBytes(32));
    repo = new IntegrationStateRepository(db, encryption);
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('stores a new config encrypted, and disabled', () => {
    repo.saveConfig('twitch', { clientId: 'abc' });

    const state = repo.findByName('twitch');
    expect(state?.enabled).toBe(false);
    expect(state?.lastStatus).toBe(IntegrationStatus.DISCONNECTED);
    expect(state?.config).not.toContain('abc'); // stored encrypted
  });

  it('replaces a config without changing whether it is enabled', () => {
    repo.saveConfig('twitch', { clientId: 'abc' });
    repo.setEnabled('twitch', true);
    const before = repo.findByName('twitch');

    repo.saveConfig('twitch', { clientId: 'xyz' });

    const after = repo.findByName('twitch');
    expect(after?.id).toBe(before?.id);
    expect(after?.enabled).toBe(true);
    expect(repo.getDecryptedConfig('twitch')).toEqual({ clientId: 'xyz' });
    expect(repo.findAll()).toHaveLength(1);
  });

  it('enables an integration that has no config', () => {
    repo.setEnabled('obs', true);

    expect(repo.findByName('obs')?.enabled).toBe(true);
    expect(repo.getDecryptedConfig('obs')).toBeNull();
  });

  it('disables without touching the config', () => {
    repo.saveConfig('twitch', { clientId: 'abc' });
    repo.setEnabled('twitch', true);
    repo.setEnabled('twitch', false);

    expect(repo.findByName('twitch')?.enabled).toBe(false);
    expect(repo.getDecryptedConfig('twitch')).toEqual({ clientId: 'abc' });
  });

  it('returns null for a name that has not been configured', () => {
    expect(repo.findByName('missing')).toBeNull();
  });

  it('finds all configs and only enabled configs', () => {
    repo.setEnabled('twitch', true);
    repo.setEnabled('spotify', false);

    const all = repo.findAll();
    expect(all.map((c) => c.name)).toEqual(['spotify', 'twitch']);

    const enabled = repo.findAllEnabled();
    expect(enabled.map((c) => c.name)).toEqual(['twitch']);
  });

  it('updates status, setting lastConnectedAt only when CONNECTED', () => {
    repo.setEnabled('twitch', true);

    repo.updateStatus('twitch', IntegrationStatus.ERROR, 'boom');
    let config = repo.findByName('twitch');
    expect(config?.lastStatus).toBe(IntegrationStatus.ERROR);
    expect(config?.lastError).toBe('boom');
    expect(config?.lastConnectedAt).toBeUndefined();

    repo.updateStatus('twitch', IntegrationStatus.CONNECTED);
    config = repo.findByName('twitch');
    expect(config?.lastStatus).toBe(IntegrationStatus.CONNECTED);
    expect(config?.lastError).toBeUndefined();
    expect(config?.lastConnectedAt).toBeTypeOf('number');
  });

  it('round-trips the decrypted config', () => {
    repo.saveConfig('twitch', { clientId: 'abc', clientSecret: 'shh' });

    const decrypted = repo.getDecryptedConfig('twitch');
    expect(decrypted).toEqual({ clientId: 'abc', clientSecret: 'shh' });
  });

  it('returns null decrypted config for a name that has not been configured', () => {
    expect(repo.getDecryptedConfig('missing')).toBeNull();
  });
});
