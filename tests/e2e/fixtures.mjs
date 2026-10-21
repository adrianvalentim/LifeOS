// Each test gets its own LifeOS: a fresh copy of the demo store in a temporary
// LIFEOS_DATA_DIR and a dev server on an OS-assigned loopback port. The real
// store, the tracked demo fixture and the agent bridges are never touched.
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { test as base, expect } from '@playwright/test';
import { DEMO_STORE, ROOT, STORES_DIR } from './environment.mjs';

const execFileAsync = promisify(execFile);

export { expect };

export const test = base.extend({
  // A running, isolated LifeOS with helpers to read what it saved.
  app: async ({ page }, use, testInfo) => {
    await mkdir(STORES_DIR, { recursive: true });
    const dataDir = await mkdtemp(path.join(STORES_DIR, 'run-'));
    const storePath = path.join(dataDir, 'lifeos.json');
    await copyFile(DEMO_STORE, storePath);
    const env = { ...process.env, LIFEOS_DATA_DIR: dataDir, PORT: '0' };
    delete env.LIFEOS_BACKUP_DIR;
    delete env.LIFEOS_ACTOR;
    delete env.LIFEOS_SOURCE;

    let server = await startServer(env);
    // Tests stay offline and exercise LifeOS itself: nothing leaves loopback,
    // book covers (which the server would fetch from Open Library) are
    // missing, and the agent rail's routes, which would start the installed
    // Codex or Claude Code on the person's account, answer as unavailable.
    const origin = new URL(server.url).origin;
    await page.route((url) => url.origin !== origin, (route) => route.abort('blockedbyclient'));
    await page.route(/\/api\/reading\/books\/[^/]+\/cover$/, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(/\/api\/(codex|claude)\//, (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Agents are off during browser tests.' }),
    }));
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    const app = {
      url: server.url,
      dataDir,
      /** Open a route and wait until the app is loaded and live. */
      async goto(route = '/') {
        await page.goto(`${server.url}${route}`);
        await expect(page.locator('.masthead .conn')).toHaveClass(/is-live/);
      },
      /** The saved store, read from disk. */
      async store() {
        return JSON.parse(await readFile(storePath, 'utf8'));
      },
      async task(title) {
        return (await app.store()).tasks.items.find((task) => task.title === title) || null;
      },
      async state() {
        const response = await fetch(`${server.url}/api/state`);
        return response.json();
      },
      /** Kill the server the way a crash would, then start a new one on the same port, as the desktop shell does. */
      async restartServer() {
        await server.kill();
        server = await startServer({ ...env, PORT: new URL(server.url).port });
      },
      /** Run the LifeOS CLI against this store, the way an agent would. */
      async cli(args, { actor } = {}) {
        const { stdout } = await execFileAsync(process.execPath, [path.join(ROOT, 'cli', 'lifeos.mjs'), ...args], {
          cwd: ROOT,
          env: { ...env, ...(actor ? { LIFEOS_ACTOR: actor } : {}) },
        });
        return stdout.trim() ? JSON.parse(stdout) : null;
      },
    };

    await use(app);

    await page.close();
    await server.stop();
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('server.log', { body: server.log(), contentType: 'text/plain' });
    }
    await rm(dataDir, { recursive: true, force: true });
    expect(pageErrors.map((error) => error.message), 'uncaught errors in the page').toEqual([]);
  },
});

async function startServer(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.mjs')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { output += chunk; });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LifeOS did not start in time.\n${output}`)), 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/LifeOS running at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`LifeOS exited (${code}) before it was ready.\n${output}`)); });
  });
  return {
    url,
    log: () => output,
    async stop() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
      await exited;
      clearTimeout(timer);
    },
    async kill() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    },
  };
}
