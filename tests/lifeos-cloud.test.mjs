import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHttpTaskRepository, deviceKeyHash, generateDeviceKey } from '../src/cloud-task-http.mjs';
import { createCloudTaskService, taskDocumentFromStore } from '../src/cloud-task-service.mjs';
import { createTask, DEMO_STORE_PATH, getState, readStore } from '../src/lifeos-data.mjs';
import { readTaskAuthority } from '../src/task-authority.mjs';
import { withTaskRepository } from '../src/task-online.mjs';

const ORIGIN = 'https://lifeos-cloud.example';
const KEY = generateDeviceKey();
const bundle = build({ entryPoints: ['workers/lifeos/worker.mjs'], bundle: true, write: false,
  format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:workers'], target: 'es2022', logLevel: 'silent' });

async function worker(t, { configured = true } = {}) {
  const script = (await bundle).outputFiles[0].text;
  const miniflare = new Miniflare(convertV4MiniflareOptions({ modules: true, script, compatibilityDate: '2026-10-09',
    compatibilityFlags: ['global_fetch_strictly_public'], kvNamespaces: ['OAUTH_KV'],
    durableObjects: { LIFEOS_STORE: { className: 'LifeOSStore', useSQLite: true } },
    bindings: { MCP_ORIGIN: ORIGIN, OWNER_GITHUB_ID: '12345', ...(configured ? { DEVICE_KEY_SHA256: deviceKeyHash(KEY) } : {}) } }));
  t.after(() => miniflare.dispose());
  await miniflare.ready;
  const request = (route, init = {}) => miniflare.dispatchFetch(new URL(route, ORIGIN).href, init);
  const repository = createHttpTaskRepository({ origin: ORIGIN, key: async () => KEY,
    fetchImpl: (url, init) => miniflare.dispatchFetch(url, init) });
  return { miniflare, request, repository, script };
}

const emptyDocument = () => ({ schemaVersion: 1, phase: 'active', timezone: 'Etc/UTC', projectIds: ['fixture-project'], items: [] });
const authorized = { Authorization: `Bearer ${KEY}` };

test('device API fails closed without the device key, from browsers and on other hosts', async t => {
  const { request, miniflare, script } = await worker(t);
  for (const headers of [{}, { Authorization: 'Bearer invented-key-that-is-long-enough-to-look-real-0000' }, { Authorization: KEY }]) {
    const response = await request('/device/v1/status', { headers });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /lifeos-device/);
  }
  assert.equal((await request('/device/v1/status', { headers: { ...authorized, Origin: ORIGIN } })).status, 403);
  assert.equal((await miniflare.dispatchFetch('https://hostile.example/device/v1/status', { headers: authorized })).status, 403);
  assert.equal((await request('/device/v1/status?x=1', { headers: authorized })).status, 400);
  assert.equal((await request('/device/v1/anything', { headers: authorized })).status, 404);
  assert.equal((await request('/device/v1/tasks/swap', { method: 'POST', headers: authorized, body: '{}' })).status, 415);
  // The Worker refuses an oversized body before reading it. Locally the client
  // may see that as a closed connection (EPIPE) instead of the 413; both refuse it.
  const huge = JSON.stringify({ revision: 1, document: { padding: 'x'.repeat(2_200_000) } });
  const oversized = await request('/device/v1/tasks/swap', { method: 'POST', headers: { ...authorized, 'Content-Type': 'application/json' }, body: huge })
    .catch(error => error);
  if (oversized instanceof Error) assert.match(oversized.cause?.code || '', /EPIPE|ECONNRESET/);
  else assert.equal(oversized.status, 413);
  assert.doesNotMatch(script, /Application Support\/LifeOS|DEFAULT_STORE_PATH|readStore|node:fs|lifeos\.json/);
  const health = await (await request('/')).json();
  assert.equal(health.access, 'authenticated'); assert.ok(!('taskCount' in health));
});

test('device API refuses every call until a key hash is configured', async t => {
  const { request } = await worker(t, { configured: false });
  assert.equal((await request('/device/v1/status', { headers: authorized })).status, 503);
});

test('Durable Object store imports once, swaps by revision and validates every document', async t => {
  const { repository } = await worker(t);
  assert.deepEqual(await repository.status(), { initialized: false, tasks: null, phase: null, revision: null });
  assert.equal(await repository.read(), null);
  assert.equal(await repository.compareAndSwap(1, emptyDocument()), null);

  const document = emptyDocument();
  assert.equal(await repository.importTasks(7, document), 7);
  assert.equal(await repository.importTasks(7, document), 7); // repeating the same import is harmless
  await assert.rejects(repository.importTasks(8, { ...document, timezone: 'America/Sao_Paulo' }), /already exist/);
  await assert.rejects(repository.importTasks(7, { ...document, phase: 'staged' }), /must be active/);
  assert.deepEqual(await repository.read(), { revision: 7, document });

  const service = createCloudTaskService(repository);
  const created = await service.create({ title: 'Durable fixture', notes: 'Line one\nLine two', projectId: 'fixture-project', tags: ['A', 'a'] });
  assert.equal(created.revision, 8);
  assert.equal((await service.edit({ taskId: created.task.id, title: 'Edited', ifUpdatedAt: created.task.updatedAt })).revision, 9);
  assert.equal((await service.complete({ taskId: created.task.id, completed: true })).task.status, 'completed');

  const row = await repository.read();
  assert.equal(row.revision, 10);
  assert.equal(await repository.compareAndSwap(9, row.document), null); // a stale save never lands
  await assert.rejects(repository.compareAndSwap(10, { ...row.document, items: [{ id: 'broken' }] }), /Task record is invalid/);
  await assert.rejects(repository.compareAndSwap(10, { ...row.document, phase: 'staged' }), /must stay active/);
  assert.deepEqual(await repository.read(), row);

  // Replacing needs the exact current revision and a newer one.
  await assert.rejects(repository.importTasks(11, document, 9), /changed before this import/);
  await assert.rejects(repository.importTasks(10, document, 10), /must move forward/);
  assert.equal(await repository.importTasks(12, document, 10), 12);
  assert.deepEqual(await repository.status(), { initialized: true, tasks: 0, phase: 'active', revision: 12 });
});

test('the desktop reads and saves tasks through the Durable Object with the device authority', async t => {
  const { repository } = await worker(t);
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-cloud-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  const store = await readStore(DEMO_STORE_PATH); store.tasks.items = [];
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  const document = taskDocumentFromStore(store); document.phase = 'active';
  await repository.importTasks(3, document);
  await writeFile(`${storePath}.task-authority.json`, JSON.stringify({ mode: 'online', source: 'cloudflare-do', phase: 'active',
    origin: ORIGIN, accountId: 'fixture-account', keychainService: 'lifeos-cloud-device', taskDigest: 'fixture', revision: 3 }), { mode: 0o600 });

  await withTaskRepository(storePath, repository, async () => {
    const created = await createTask({ title: 'Saved from the desktop' }, storePath);
    const state = await getState(storePath);
    assert.equal(state.tasks.authority.online, true);
    assert.equal(state.tasks.authority.source, 'cloudflare-do');
    assert.ok(state.tasks.items.some(task => task.id === created.task.id));
  });
  const row = await repository.read();
  assert.equal(row.revision, 4);
  assert.deepEqual(row.document.items.map(task => task.title), ['Saved from the desktop']);
});

test('task authority accepts a complete Durable Object connection only', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-authority-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  const write = record => writeFile(`${storePath}.task-authority.json`, JSON.stringify(record), { mode: 0o600 });
  const complete = { mode: 'online', source: 'cloudflare-do', phase: 'active', origin: ORIGIN, accountId: 'fixture-account',
    keychainService: 'lifeos-cloud-device', taskDigest: 'fixture' };
  await write(complete);
  assert.equal((await readTaskAuthority(storePath)).source, 'cloudflare-do');
  for (const broken of [{ keychainService: undefined }, { accountId: '' }, { origin: `${ORIGIN}/path` }, { mode: 'archive' }, { phase: 'pending' }, { source: 'elsewhere' }]) {
    await write({ ...complete, ...broken });
    await assert.rejects(readTaskAuthority(storePath), /invalid|private connection/);
  }
});
