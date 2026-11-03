import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { IntegrationName } from '@turingmod/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const STARTUP_TIMEOUT_MS = 30_000;

/** A port nothing is listening on right now. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') {
          done(address.port);
        } else {
          fail(new Error('Could not find a free port'));
        }
      });
    });
  });
}

/**
 * Starts the real build and stops it again. Everything else here runs through Vitest's esbuild, which
 * emits no decorator metadata and loads no discovered modules from dist/, so a class tsyringe can't
 * construct, or a leftover file discovery trips over, only shows up in a build like this one.
 *
 * It runs on an empty database of its own, so no integration starts and no account is touched.
 */
describe('the built backend', () => {
  let directory: string;
  let child: ChildProcess | undefined;
  let port: number;
  let output = '';
  let exit: Promise<number | null>;

  beforeAll(async () => {
    await promisify(execFile)('npm', ['run', 'build'], { cwd: PACKAGE_ROOT });

    directory = mkdtempSync(join(tmpdir(), 'turingmod-smoke-'));
    port = await freePort();
    child = spawn(process.execPath, ['dist/index.js'], {
      cwd: PACKAGE_ROOT,
      // Set rather than inherited, since a variable from the shell beats one from .env, and .env
      // would otherwise choose the database.
      env: {
        ...process.env,
        DB_PATH: join(directory, 'smoke.db'),
        MASTER_PASSWORD: 'smoke-test-only',
        SERVER_PORT: String(port),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info',
      },
    });
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const started = child;
    exit = new Promise((done) => started.once('exit', done));
  }, 120_000);

  afterAll(async () => {
    // Nothing to clean up if the build failed.
    if (child) {
      child.kill('SIGKILL');
      await exit;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it(
    'starts, finds everything, serves, and shuts down cleanly',
    async () => {
      const health = await waitForHealth();
      expect(health, output).toBe(true);

      expect(output).toMatch(/Loaded [1-9]\d* command\(s\)/);
      expect(output).toMatch(/Loaded [1-9]\d* reward handler\(s\)/);
      expect(output).toContain(`Loaded ${Object.values(IntegrationName).length} integration(s)`);

      child?.kill('SIGTERM');
      expect(await exit, output).toBe(0);
      expect(output).toContain('TuringMod stopped successfully');
      expect(output).not.toMatch(/\b(ERROR|FATAL)\b/);
    },
    STARTUP_TIMEOUT_MS + 10_000
  );

  /** Whether /health answered before the process exited or time ran out. */
  async function waitForHealth(): Promise<boolean> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline && child?.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          return true;
        }
      } catch {
        // Not listening yet.
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    return false;
  }
});
