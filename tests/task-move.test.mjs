import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { taskDocumentFromStore } from '../src/cloud-task-service.mjs';
import { DEMO_STORE_PATH, readStore } from '../src/lifeos-data.mjs';
import { moveTasksToDurableStore } from '../src/task-move.mjs';

const TARGET = { origin: 'https://lifeos-cloud.example', accountId: 'fixture-lifeos-account', keychainService: 'lifeos-cloud-device' };

function memoryRepository(initial) {
  let row = initial ? structuredClone(initial) : null;
  const calls = [];
  return {
    calls, row: () => row, set: value => { row = structuredClone(value); },
    async read() { calls.push('read'); return structuredClone(row); },
    async compareAndSwap(revision, document) {
      calls.push('swap');
      if (!row || row.revision !== revision) return null;
      row = { revision: revision + 1, document: structuredClone(document) };
      return row.revision;
    },
    async importTasks(revision, document, expectedRevision = null) {
      calls.push('import');
      if (expectedRevision === null && row) throw new Error('Cloud tasks already exist here.');
      if (expectedRevision !== null && row?.revision !== expectedRevision) throw new Error('Cloud tasks changed before this import.');
      row = { revision, document: structuredClone(document) };
      return revision;
    },
  };
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-move-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  const artifacts = path.join(dir, 'artifacts');
  await mkdir(artifacts, { mode: 0o700 });
  const store = await readStore(DEMO_STORE_PATH);
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  const authority = { source: 'cloudflare-d1', phase: 'active', mode: 'online', origin: 'https://tasks.example', taskDigest: 'fixture',
    configFile: path.join(dir, 'd1.json'), workspaceRoot: '/fixture/workspace', databaseId: 'fixture-database', accountId: 'fixture-main-account' };
  await writeFile(`${storePath}.task-authority.json`, JSON.stringify(authority), { mode: 0o600 });
  const document = { ...taskDocumentFromStore(store), phase: 'active' };
  const d1 = memoryRepository({ revision: 33, document });
  const durable = memoryRepository(null);
  const move = (overrides = {}) => moveTasksToDurableStore({ storePath, artifactDir: artifacts, from: d1, to: durable, target: TARGET,
    now: new Date('2026-11-04T23:00:00Z'), ...overrides });
  const readAuthority = async () => JSON.parse(await readFile(`${storePath}.task-authority.json`, 'utf8'));
  return { storePath, artifacts, document, d1, durable, move, readAuthority, storeBefore: await readFile(storePath, 'utf8') };
}

test('moves tasks to the Durable Object, fences D1 and points the desktop at the new store', async t => {
  const f = await fixture(t);
  const result = await f.move();
  assert.deepEqual({ tasks: result.tasks, revision: result.revision }, { tasks: f.document.items.length, revision: 34 });
  assert.equal(f.d1.row().document.phase, 'staged');
  assert.equal(f.d1.row().revision, 34);
  assert.deepEqual(f.durable.row(), { revision: 34, document: f.document });
  const authority = await f.readAuthority();
  assert.equal(authority.source, 'cloudflare-do');
  assert.equal(authority.origin, TARGET.origin);
  assert.equal(authority.accountId, TARGET.accountId);
  assert.equal(authority.previous.databaseId, 'fixture-database');
  assert.equal(authority.previous.fencedRevision, 34);
  assert.equal(await readFile(f.storePath, 'utf8'), f.storeBefore); // local records untouched
  const files = await readdir(f.artifacts);
  assert.equal(files.length, 3);
  assert.equal(await readFile(path.join(f.artifacts, files.find(name => name.startsWith('lifeos-before-move'))), 'utf8'), f.storeBefore);
  await assert.rejects(f.move({ now: new Date('2026-11-04T23:05:00Z') }), /already live in the LifeOS cloud store/);
});

test('a cloud edit racing the fence moves nothing', async t => {
  const f = await fixture(t);
  const original = f.d1.compareAndSwap;
  f.d1.compareAndSwap = async (revision, document) => { f.d1.set({ ...f.d1.row(), revision: 35 }); return original(revision, document); };
  await assert.rejects(f.move(), /changed during the move\. Nothing moved/);
  assert.equal(f.d1.row().document.phase, 'active');
  assert.equal(f.durable.row(), null);
  assert.equal((await f.readAuthority()).source, 'cloudflare-d1');
});

test('a failed copy reopens D1 and keeps the D1 authority', async t => {
  const f = await fixture(t);
  f.durable.importTasks = async () => { throw new Error('LifeOS cloud request failed (500).'); };
  await assert.rejects(f.move(), /request failed \(500\)\. The D1 store was reopened/);
  assert.equal(f.d1.row().document.phase, 'active');
  assert.equal(f.d1.row().revision, 35);
  assert.equal((await f.readAuthority()).source, 'cloudflare-d1');
});

test('a copy that reads back differently reopens D1', async t => {
  const f = await fixture(t);
  const importTasks = f.durable.importTasks;
  f.durable.importTasks = async (revision, document, expected) => importTasks(revision, { ...document, timezone: 'Etc/GMT+1' }, expected);
  await assert.rejects(f.move(), /could not be verified.*reopened/);
  assert.equal(f.d1.row().document.phase, 'active');
  assert.equal((await f.readAuthority()).source, 'cloudflare-d1');
});

test('a retried move replaces an older partial copy, never a newer store', async t => {
  const f = await fixture(t);
  f.durable.set({ revision: 20, document: { ...f.document, items: [] } });
  assert.equal((await f.move()).revision, 34);
  assert.deepEqual(f.durable.row(), { revision: 34, document: f.document });

  const g = await fixture(t);
  g.durable.set({ revision: 90, document: g.document });
  await assert.rejects(g.move(), /newer than D1.*reopened/);
  assert.equal(g.d1.row().document.phase, 'active');
});

test('the move waits for an interrupted cloud save to be recovered first', async t => {
  const f = await fixture(t);
  await writeFile(`${f.storePath}.task-pending.json`, '{}', { mode: 0o600 });
  await assert.rejects(f.move(), /awaiting recovery/);
  assert.deepEqual(f.d1.calls, []);
  assert.equal((await f.readAuthority()).source, 'cloudflare-d1');
});
