import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { DatabaseManager } from './DatabaseManager.js';

describe('DatabaseManager', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turingmod-db-test-'));
    dbPath = join(dir, 'test.sqlite');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeManager(): DatabaseManager {
    return new DatabaseManager(dbPath, new Logger({ level: 'silent' }));
  }

  it('creates a new database file and allows writes/reads', async () => {
    const db = makeManager();
    await db.initialize();

    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    const result = db.run('INSERT INTO users (name) VALUES (?)', ['alice']);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1);

    const row = db.queryOne<{ id: number; name: string }>('SELECT * FROM users WHERE id = ?', [1]);
    expect(row).toEqual({ id: 1, name: 'alice' });

    await db.close();
  });

  it('persists writes durably across close/reopen with no explicit flush', async () => {
    const db = makeManager();
    await db.initialize();
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    db.run('INSERT INTO users (name) VALUES (?)', ['bob']);
    await db.close();

    const reopened = makeManager();
    await reopened.initialize();
    const rows = reopened.query<{ id: number; name: string }>('SELECT * FROM users');
    expect(rows).toEqual([{ id: 1, name: 'bob' }]);
    await reopened.close();
  });

  it('rolls back a failed transaction', async () => {
    const db = makeManager();
    await db.initialize();
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO users (name) VALUES (?)', ['carol']);
        throw new Error('boom');
      })
    ).toThrow('boom');

    expect(db.query('SELECT * FROM users')).toEqual([]);
    await db.close();
  });

  it('commits a successful transaction', async () => {
    const db = makeManager();
    await db.initialize();
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

    db.transaction(() => {
      db.run('INSERT INTO users (name) VALUES (?)', ['dave']);
    });

    expect(db.query('SELECT * FROM users')).toHaveLength(1);
    await db.close();
  });

  it('rolls back, rather than commit early, when the callback is async', async () => {
    const db = makeManager();
    await db.initialize();
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');

    expect(() =>
      // biome-ignore lint/suspicious/useAwait: the mistake under test
      db.transaction(async () => {
        db.run('INSERT INTO users (name) VALUES (?)', ['erin']);
      })
    ).toThrow('synchronous');

    expect(db.query('SELECT * FROM users')).toEqual([]);
    await db.close();
  });

  it('throws when used before initialize', () => {
    const db = makeManager();
    expect(() => db.exec('SELECT 1')).toThrow('Database not initialized');
  });
});
