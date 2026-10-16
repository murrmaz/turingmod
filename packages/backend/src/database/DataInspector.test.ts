import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TuringModConfig } from '../utils/Config.js';
import type { DatabaseManager } from './DatabaseManager.js';
import { DataInspector } from './DataInspector.js';
import { createTestDatabase } from './repositories/testDatabase.js';

describe('DataInspector', () => {
  let db: DatabaseManager;
  let cleanup: () => Promise<void>;
  let inspector: DataInspector;

  beforeEach(async () => {
    const test = await createTestDatabase();
    db = test.db;
    cleanup = test.cleanup;
    inspector = new DataInspector({ dbPath: test.path } as TuringModConfig);

    db.run(
      'INSERT INTO integration_state (id, name, enabled, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['1', 'twitch-auth', 1, 'c2VjcmV0LWNpcGhlcnRleHQ=', 1, 2]
    );
    db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
      'encryption_salt',
      'c2FsdA==',
      5,
    ]);
    db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['breaks', '{}', 6]);
    for (let i = 0; i < 5; i++) {
      db.run(
        'INSERT INTO activity_log (id, category, event, data, timestamp) VALUES (?, ?, ?, ?, ?)',
        [`a${i}`, i % 2 ? 'command' : 'event', `event_${i}`, `{"n":${i}}`, 1000 + i]
      );
    }
  });

  afterEach(async () => {
    inspector.close();
    await cleanup();
  });

  it('lists only allowed tables, with row counts and column info', () => {
    const tables = inspector.listTables();
    const names = tables.map((table) => table.name);

    expect(names).toContain('activity_log');
    expect(names).toContain('migrations');
    const activity = tables.find((table) => table.name === 'activity_log');
    expect(activity?.rowCount).toBe(5);
    expect(activity?.columns.find((column) => column.name === 'category')?.enumValues).toContain(
      'command'
    );
    expect(
      tables
        .find((table) => table.name === 'integration_state')
        ?.columns.find((column) => column.name === 'config')?.masked
    ).toBe(true);
  });

  it('never returns encrypted config, only its size', () => {
    const { rows } = inspector.queryRows({ table: 'integration_state', page: 0, pageSize: 10 });

    expect(rows[0]?.config).toBe('encrypted · 24 B');
    expect(rows[0]?.name).toBe('twitch-auth');
  });

  it('hides the encryption salt but not other settings', () => {
    const { rows } = inspector.queryRows({ table: 'settings', page: 0, pageSize: 10 });

    expect(rows.find((row) => row.key === 'encryption_salt')).toEqual({
      key: 'encryption_salt',
      value: 'hidden · 8 B',
      updated_at: 5,
    });
    expect(rows.find((row) => row.key === 'breaks')?.value).toBe('{}');
  });

  it('leaves the salt out of any query that could test its value', () => {
    const keys = (
      request: Omit<Parameters<DataInspector['queryRows']>[0], 'table' | 'page' | 'pageSize'>
    ) =>
      inspector
        .queryRows({ table: 'settings', page: 0, pageSize: 10, ...request })
        .rows.map((row) => row.key);

    expect(keys({ search: 'c2Fs' })).toEqual([]);
    expect(keys({ search: 'salt' })).toEqual([]);
    expect(keys({ filters: { value: ['c2FsdA=='] } })).toEqual([]);
    expect(keys({ sort: { column: 'value', direction: 'asc' } })).toEqual(['breaks']);
    // Looking only at keys still lists it, value hidden.
    expect(keys({ filters: { key: ['encryption_salt'] } })).toEqual(['encryption_salt']);
  });

  it('refuses to sort by an encrypted column', () => {
    expect(() =>
      inspector.queryRows({
        table: 'integration_state',
        page: 0,
        pageSize: 10,
        sort: { column: 'config', direction: 'asc' },
      })
    ).toThrow("can't be sorted");
  });

  it('sorts timestamped tables newest first and pages', () => {
    const page = inspector.queryRows({ table: 'activity_log', page: 1, pageSize: 2 });

    expect(page.total).toBe(5);
    expect(page.rows.map((row) => row.id)).toEqual(['a2', 'a1']);
  });

  it('filters by value, text and time', () => {
    expect(
      inspector.queryRows({
        table: 'activity_log',
        page: 0,
        pageSize: 10,
        filters: { category: ['command'] },
      }).total
    ).toBe(2);
    expect(
      inspector.queryRows({ table: 'activity_log', page: 0, pageSize: 10, search: 'event_3' })
        .rows[0]?.id
    ).toBe('a3');
    expect(
      inspector.queryRows({ table: 'activity_log', page: 0, pageSize: 10, since: 1003 }).total
    ).toBe(2);
  });

  it('treats LIKE wildcards in a search as text', () => {
    expect(
      inspector.queryRows({ table: 'activity_log', page: 0, pageSize: 10, search: '%' }).total
    ).toBe(0);
  });

  it('refuses tables and columns it does not know', () => {
    expect(() => inspector.queryRows({ table: 'sqlite_master', page: 0, pageSize: 10 })).toThrow(
      'Unknown table'
    );
    expect(() => inspector.queryRows({ table: 'constructor', page: 0, pageSize: 10 })).toThrow(
      'Unknown table'
    );
    expect(() =>
      inspector.queryRows({
        table: 'activity_log',
        page: 0,
        pageSize: 10,
        sort: { column: 'id; DROP TABLE activity_log', direction: 'asc' },
      })
    ).toThrow('Unknown column');
    expect(() =>
      inspector.queryRows({
        table: 'integration_state',
        page: 0,
        pageSize: 10,
        filters: { config: ['x'] },
      })
    ).toThrow("can't be filtered");
  });

  it('cannot write', () => {
    inspector.listTables();
    const connection = (inspector as unknown as { connection: { exec(sql: string): void } })
      .connection;
    expect(() => connection.exec('DELETE FROM activity_log')).toThrow();
  });
});
