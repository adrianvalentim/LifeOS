import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readStore, DEMO_STORE_PATH, createTask, mutateStore, writeStore, getState, buildState } from '../src/lifeos-data.mjs';
import { prepareTaskCutover, fenceTaskCutover, verifyCutoverManifest, markTaskCutoverActive, digest } from '../src/task-cutover.mjs';
import { readTaskAuthority } from '../src/task-authority.mjs';
import { renderTasksScreen } from './ui-harness.mjs';
import { createTaskService } from '../src/task-service.mjs';
import { withTaskRepository } from '../src/task-online.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-cutover-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  const store = await readStore(DEMO_STORE_PATH); store.tasks.items = [];
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  await createTask({ id: 'fixture-task', title: 'Preserve this fixture', notes: 'Multiline\nfixture', now: '2026-10-10T00:00:00Z' }, storePath);
  const prepare = () => prepareTaskCutover({ storePath, artifactDir: path.join(dir, 'private-backup'), origin: 'https://tasks.example' });
  return { dir, storePath, prepare };
}
test('cutover verifies a full byte-identical private backup and exports tasks only without writing the source', async t => {
  const { storePath, prepare } = await fixture(t), before = await readFile(storePath);
  const manifest = await prepare();
  assert.equal(manifest.backupSha256, digest(before)); assert.deepEqual(await readFile(manifest.backupPath), before);
  assert.equal((await stat(manifest.backupPath)).mode & 0o777, 0o600);
  const doc = await verifyCutoverManifest(manifest);
  assert.equal(doc.items[0].id, 'fixture-task'); assert.equal(doc.items[0].notes, 'Multiline\nfixture');
  assert.ok(!doc.projects && !doc.reading && !doc.entries);
  assert.deepEqual(await readFile(storePath), before); assert.equal(await readTaskAuthority(storePath), null);
});
test('cutover rejects local edits made after backup rather than freezing or overwriting them', async t => {
  const { storePath, prepare } = await fixture(t), manifest = await prepare();
  await createTask({ id: 'new-local', title: 'A concurrent edit' }, storePath);
  await assert.rejects(fenceTaskCutover(manifest), /Local tasks changed/);
  assert.equal(await readTaskAuthority(storePath), null);
  assert.equal((await readStore(storePath)).tasks.items.length, 2);
});
test('pending task fence blocks task rewrites but preserves unrelated local writes and labels the transfer', async t => {
  const { storePath, prepare } = await fixture(t), manifest = await prepare();
  await fenceTaskCutover(manifest, { mode: 'online', configFile: '/private/fixture-config.json', workspaceRoot: '/fixture/workspace', databaseId: 'fixture', accountId: 'fixture' });
  await assert.rejects(createTaskService({ storePath }).list(), /Task authority/);
  const before = await readFile(storePath);
  await assert.rejects(createTask({ title: 'Must not fork authority' }, storePath), /Task authority/);
  const candidate = await readStore(storePath); candidate.tasks.items[0].notes = 'overwrite';
  await assert.rejects(writeStore(candidate, storePath), /Task authority/);
  assert.deepEqual(await readFile(storePath), before);
  const unrelated = await mutateStore(store => { store.settings.deepTarget = 0.61; }, storePath);
  assert.equal(buildState(unrelated.store).tasks.authority.phase, 'pending');
  assert.ok(!JSON.parse(await readFile(storePath, 'utf8')).tasks.authority);
  assert.equal((await readStore(storePath)).settings.deepTarget, 0.61);
  assert.equal((await readStore(storePath)).tasks.items[0].notes, 'Multiline\nfixture');
  await markTaskCutoverActive(manifest, 2);
  const state = await withTaskRepository(storePath, { read: async () => ({ revision: 2, document: { ...JSON.parse(await readFile(manifest.documentPath)), phase: 'active' } }) }, () => getState(storePath));
  assert.equal(state.tasks.authority.phase, 'active');
  const html = renderTasksScreen(state);
  assert.ok(html.includes('data-quick-add')); assert.ok(html.includes('Preserve this fixture')); assert.ok(!html.includes('Task transfer pending'));
});
test('tampered backup/import artifacts prevent cutover', async t => {
  const { prepare } = await fixture(t), manifest = await prepare();
  await writeFile(manifest.documentPath, '{}');
  await assert.rejects(fenceTaskCutover(manifest), /artifact changed/);
});
