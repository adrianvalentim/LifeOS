import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readStore, DEMO_STORE_PATH, getState, createTask, updateTask, setTaskPriority, setTaskCompletion,
  trashTask, restoreTask, duplicateTask, reorderTask, captureWebPage, deleteProject, deleteTask,
  mutateStore, writeStore, purgeExpiredTaskTrash } from '../src/lifeos-data.mjs';
import { createCloudTaskService, taskDocumentFromStore } from '../src/cloud-task-service.mjs';
import { withTaskRepository, createOnlineTaskCoordinator } from '../src/task-online.mjs';
import { renderTasks, createTasksUiState } from '../public/tasks.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-online-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  const store = await readStore(DEMO_STORE_PATH); store.tasks.items = [];
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  await createTask({ id: 'fixture-task', title: 'Fixture task', notes: 'Original fixture notes' }, storePath);
  const document = taskDocumentFromStore(await readStore(storePath)); document.phase = 'active';
  let row = { document, revision: 1 }, unavailable = false;
  const repository = {
    async read() { if (unavailable) throw new Error('fixture offline'); return structuredClone(row); },
    async compareAndSwap(revision, document) {
      if (unavailable) throw new Error('fixture offline');
      if (revision !== row.revision) return null;
      row = { revision: revision + 1, document: structuredClone(document) }; return row.revision;
    },
  };
  await writeFile(`${storePath}.task-authority.json`, JSON.stringify({ source: 'cloudflare-d1', phase: 'active', mode: 'online',
    origin: 'https://tasks.example', taskDigest: 'fixture', configFile: path.join(dir, 'private-config.json'),
    workspaceRoot: '/fixture/workspace', databaseId: 'fixture-database', accountId: 'fixture-account' }), { mode: 0o600 });
  const using = callback => withTaskRepository(storePath, repository, callback);
  return { storePath, repository, using, cloud: createCloudTaskService(repository), offline: value => { unavailable = value; }, row: () => row };
}
test('desktop task editing, capture and project-to-Inbox semantics share the same cloud tasks', async t => {
  const f = await fixture(t);
  await f.cloud.edit({ taskId: 'fixture-task', notes: 'Mercury fixture edit' });
  await f.using(async () => {
    const state = await getState(f.storePath);
    assert.equal(state.tasks.items[0].notes, 'Mercury fixture edit'); assert.equal(state.tasks.authority.online, true);
    const html = renderTasks(state.tasks, state.projects, state.domains, createTasksUiState());
    assert.ok(html.includes('data-task-create')); assert.ok(html.includes('shared cloud storage')); assert.ok(!html.includes('editing is paused'));
    await updateTask({ taskId: 'fixture-task', title: 'Desktop fixture edit' }, f.storePath);
    await setTaskPriority({ taskId: 'fixture-task', priority: 'high' }, f.storePath);
    const child = (await createTask({ title: 'Child fixture', parentTaskId: 'fixture-task' }, f.storePath)).task;
    await setTaskCompletion({ taskId: 'fixture-task', completed: true }, f.storePath);
    assert.equal((await f.cloud.get({ taskId: child.id })).task.status, 'completed');
    await trashTask({ taskId: 'fixture-task' }, f.storePath); await restoreTask({ taskId: child.id }, f.storePath);
    const copied = await duplicateTask({ taskId: 'fixture-task' }, f.storePath);
    await reorderTask({ taskId: copied.task.id, parentTaskId: null, beforeTaskId: 'fixture-task' }, f.storePath);
    const captured = await captureWebPage({ url: 'https://example.org/online-fixture', title: 'Fixture web page' }, f.storePath);
    assert.equal(captured.created, true); assert.equal((await f.cloud.get({ taskId: captured.task.id })).task.projectId, captured.project.id);
    assert.equal((await captureWebPage({ url: captured.url, title: 'Ignored retry' }, f.storePath)).created, false);
    await deleteProject({ projectId: captured.project.id }, f.storePath);
    assert.equal((await f.cloud.get({ taskId: captured.task.id })).task.projectId, null);
    assert.ok(!f.row().document.projects && !f.row().document.reading && !f.row().document.timeEntries);
  });
});
test('offline reads use the cache, task writes fail, and unrelated local records can still change', async t => {
  const f = await fixture(t); f.offline(true);
  await f.using(async () => {
    const state = await getState(f.storePath); assert.equal(state.tasks.authority.online, false);
    assert.match(renderTasks(state.tasks, state.projects, state.domains, createTasksUiState()), /Showing cached tasks/);
    const before = await readFile(f.storePath);
    await assert.rejects(createTask({ title: 'Offline unsaved fixture' }, f.storePath), /offline/);
    assert.deepEqual(await readFile(f.storePath), before);
    await mutateStore(store => { store.settings.deepTarget = 0.62; }, f.storePath);
    assert.equal(JSON.parse(await readFile(f.storePath)).settings.deepTarget, 0.62);
  });
});
test('stale snapshots and racing Mercury writes are refused without overwriting either copy', async t => {
  const f = await fixture(t), before = await readFile(f.storePath);
  await f.cloud.edit({ taskId: 'fixture-task', notes: 'Keep the Mercury fixture change' });
  await f.using(async () => {
    await assert.rejects(updateTask({ taskId: 'fixture-task', notes: 'Stale desktop content' }, f.storePath), /changed since its local snapshot/);
    assert.deepEqual(await readFile(f.storePath), before);
    await readStore(f.storePath);
    const original = f.repository.compareAndSwap;
    f.repository.compareAndSwap = async (...args) => {
      f.repository.compareAndSwap = original;
      await f.cloud.edit({ taskId: 'fixture-task', tags: ['Mercury'] });
      return original(...args);
    };
    await assert.rejects(setTaskPriority({ taskId: 'fixture-task', priority: 'high' }, f.storePath), /changed in the cloud/);
    assert.equal(f.row().document.items[0].priority, 'none');
    assert.deepEqual(f.row().document.items[0].tags, ['Mercury']);
    await readStore(f.storePath);
    await setTaskPriority({ taskId: 'fixture-task', priority: 'high' }, f.storePath);
    assert.equal(f.row().document.items[0].notes, 'Keep the Mercury fixture change');
  });
});
test('uncertain cloud success recovers a capture and its local project exactly once', async t => {
  const f = await fixture(t), original = f.repository.compareAndSwap;
  f.repository.compareAndSwap = async (...args) => { f.repository.compareAndSwap = original; await original(...args); throw new Error('lost fixture response'); };
  await f.using(async () => {
    const input = { url: 'https://example.org/interrupted-fixture', title: 'Interrupted fixture capture' };
    await assert.rejects(captureWebPage(input, f.storePath), /could not be confirmed/);
    assert.equal((await stat(`${f.storePath}.task-pending.json`)).mode & 0o777, 0o600);
    // A Mercury edit after the uncertain save must survive local recovery.
    await f.cloud.edit({ taskId: 'fixture-task', notes: 'Mercury after interrupted save' });
    const recovered = await readStore(f.storePath);
    assert.equal(recovered.tasks.items.length, 2); assert.ok(recovered.projects.some(p => p.id === 'web-articles'));
    assert.equal(recovered.tasks.items[0].notes, 'Mercury after interrupted save');
    assert.equal((await captureWebPage(input, f.storePath)).created, false);
    assert.equal(f.row().document.items.length, 2);
    await assert.rejects(stat(`${f.storePath}.task-pending.json`), { code: 'ENOENT' });
  });
});
test('a failed local write retains the recovery journal and restores unrelated local changes after cloud success', async t => {
  const f = await fixture(t); let fail = true;
  const coordinator = createOnlineTaskCoordinator({ storePath: f.storePath, repository: f.repository,
    readLocal: async () => JSON.parse(await readFile(f.storePath)), validateLocal: () => {},
    writeLocal: async store => { if (fail) throw new Error('fixture disk failure'); await writeFile(f.storePath, JSON.stringify(store), { mode: 0o600 }); } });
  await assert.rejects(coordinator.mutate(store => { store.tasks.items[0].notes = 'Cloud committed fixture'; store.settings.deepTarget = 0.64; }), /fixture disk failure/);
  fail = false;
  const recovered = await coordinator.read();
  assert.equal(recovered.store.settings.deepTarget, 0.64); assert.equal(recovered.store.tasks.items[0].notes, 'Cloud committed fixture');
  await assert.rejects(stat(`${f.storePath}.task-pending.json`), { code: 'ENOENT' });
});
test('cloud task paths retain Trash and block permanent deletion and direct snapshot overwrites', async t => {
  const f = await fixture(t);
  await f.using(async () => {
    await trashTask({ taskId: 'fixture-task', now: '2026-01-01T00:00:00Z' }, f.storePath);
    assert.equal((await purgeExpiredTaskTrash({}, f.storePath)).purgedCount, 0);
    await assert.rejects(deleteTask({ taskId: 'fixture-task' }, f.storePath), /Permanent task removal/);
    await assert.rejects(writeStore(await readStore(f.storePath), f.storePath), /direct snapshot writes/);
    assert.equal(f.row().document.items.length, 1);
  });
});
test('an uncertain request that never reached D1 is recovered once without duplicate capture', async t => {
  const f = await fixture(t), original = f.repository.compareAndSwap;
  f.repository.compareAndSwap = async () => { f.repository.compareAndSwap = original; throw new Error('fixture disconnected before commit'); };
  await f.using(async () => {
    const input = { url: 'https://example.org/not-yet-committed-fixture', title: 'Recover once' };
    await assert.rejects(captureWebPage(input, f.storePath), /could not be confirmed/);
    assert.equal(f.row().document.items.length, 1);
    await readStore(f.storePath);
    assert.equal(f.row().document.items.length, 2);
    assert.equal((await captureWebPage(input, f.storePath)).created, false);
  });
});
test('an unapplied interrupted update cannot replay over a later Mercury edit', async t => {
  const f = await fixture(t), original = f.repository.compareAndSwap;
  f.repository.compareAndSwap = async () => { f.repository.compareAndSwap = original; throw new Error('fixture disconnected before commit'); };
  await f.using(async () => {
    await assert.rejects(updateTask({ taskId: 'fixture-task', notes: 'Unapplied desktop fixture' }, f.storePath), /could not be confirmed/);
    await f.cloud.edit({ taskId: 'fixture-task', notes: 'Later Mercury fixture' });
    await assert.rejects(readStore(f.storePath), /interrupted task save conflicted/);
    assert.equal((await readStore(f.storePath)).tasks.items[0].notes, 'Later Mercury fixture');
    assert.equal(f.row().document.items[0].notes, 'Later Mercury fixture');
  });
});
test('pending journal recovery refuses out-of-band unrelated record changes', async t => {
  const f = await fixture(t), original = f.repository.compareAndSwap;
  f.repository.compareAndSwap = async (...args) => { f.repository.compareAndSwap = original; await original(...args); throw new Error('fixture lost response'); };
  await f.using(async () => {
    await assert.rejects(updateTask({ taskId: 'fixture-task', notes: 'Committed fixture' }, f.storePath), /could not be confirmed/);
    const unexpected = JSON.parse(await readFile(f.storePath)); unexpected.settings.deepTarget = 0.69;
    await writeFile(f.storePath, JSON.stringify(unexpected), { mode: 0o600 });
    await assert.rejects(readStore(f.storePath), /Local records changed/);
    assert.equal(JSON.parse(await readFile(f.storePath)).settings.deepTarget, 0.69);
    assert.equal(f.row().document.items[0].notes, 'Committed fixture');
  });
});
test('a task detail draft retains its read timestamp even after the local cache refreshes', async t => {
  const f = await fixture(t), originalTimestamp = f.row().document.items[0].updatedAt;
  // Fix a distinct fixture timestamp so this is independent of clock precision.
  await f.cloud.edit({ taskId: 'fixture-task', notes: 'Fresh Mercury fixture' });
  f.row().document.items[0].updatedAt = '2026-12-01T00:00:00Z';
  await f.using(async () => {
    await readStore(f.storePath);
    await assert.rejects(updateTask({ taskId: 'fixture-task', notes: 'Old browser draft', ifUpdatedAt: originalTimestamp }, f.storePath), /changed since it was read/);
    assert.equal(f.row().document.items[0].notes, 'Fresh Mercury fixture');
  });
});
