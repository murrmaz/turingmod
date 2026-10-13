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

  it('creates a new integration config on first upsert', () => {
    const config = repo.upsert('twitch', { clientId: 'abc' }, true);

    expect(config.name).toBe('twitch');
    expect(config.enabled).toBe(true);
    expect(config.lastStatus).toBe(IntegrationStatus.DISCONNECTED);
    expect(config.config).not.toContain('abc'); // stored encrypted
  });

  it('updates an existing integration config on subsequent upsert', () => {
    const created = repo.upsert('twitch', { clientId: 'abc' }, true);
    const updated = repo.upsert('twitch', { clientId: 'xyz' }, false);

    expect(updated.id).toBe(created.id);
    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    const all = repo.findAll();
    expect(all).toHaveLength(1);
  });

  it('returns null for a name that has not been configured', () => {
    expect(repo.findByName('missing')).toBeNull();
  });

  it('finds all configs and only enabled configs', () => {
    repo.upsert('twitch', {}, true);
    repo.upsert('spotify', {}, false);

    const all = repo.findAll();
    expect(all.map((c) => c.name)).toEqual(['spotify', 'twitch']);

    const enabled = repo.findAllEnabled();
    expect(enabled.map((c) => c.name)).toEqual(['twitch']);
  });

  it('updates status, setting lastConnectedAt only when CONNECTED', () => {
    repo.upsert('twitch', {}, true);

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

  it('updates the enabled flag independently of config/status', () => {
    repo.upsert('twitch', {}, true);
    repo.updateEnabled('twitch', false);

    const config = repo.findByName('twitch');
    expect(config?.enabled).toBe(false);
  });

  it('round-trips the decrypted config', () => {
    repo.upsert('twitch', { clientId: 'abc', clientSecret: 'shh' }, true);

    const decrypted = repo.getDecryptedConfig('twitch');
    expect(decrypted).toEqual({ clientId: 'abc', clientSecret: 'shh' });
  });

  it('returns null decrypted config for a name that has not been configured', () => {
    expect(repo.getDecryptedConfig('missing')).toBeNull();
  });
});
