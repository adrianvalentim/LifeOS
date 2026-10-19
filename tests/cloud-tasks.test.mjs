import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readStore, DEMO_STORE_PATH, createTask, editTask, setTaskCompletion, trashTask, restoreTask } from '../src/lifeos-data.mjs';
import { taskDocumentFromStore, validateTaskDocument, applyTaskOperation, createCloudTaskService } from '../src/cloud-task-service.mjs';

async function storeFixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-cloud-model-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await readStore(DEMO_STORE_PATH); store.tasks.items = [];
  const file = path.join(dir, 'lifeos.json'); await writeFile(file, JSON.stringify(store));
  return { store, file };
}

test('portable cloud operations preserve local task lifecycle and content exactly', async t => {
  const { store, file } = await storeFixture(t);
  const doc = taskDocumentFromStore(store); doc.projectIds = store.projects.map(p => p.id); doc.phase = 'active';
  const steps = [
    ['create', { title: ' Parent\t title ', id: 'root', notes: 'One\r\nTwo', tags: ['Writing', 'writing', 'Extra'], priority: 'high' }],
    ['create', { title: 'Child', id: 'child', parentTaskId: 'root', projectId: null, dueDate: '2026-10-10', startTime: '13:00' }],
    ['create', { title: 'Grandchild', id: 'grandchild', parentTaskId: 'child' }],
    ['edit', { taskId: 'root', title: 'Updated', notes: 'Preserved\nmultiline', tags: ['One', 'one', 'Two'] }],
    ['complete', { taskId: 'root', completed: true }],
    ['complete', { taskId: 'child', completed: false }],
    ['trash', { taskId: 'root' }],
    ['restore', { taskId: 'child' }],
  ];
  const local = { create: createTask, edit: editTask, complete: setTaskCompletion, trash: trashTask, restore: restoreTask };
  for (let index = 0; index < steps.length; index++) {
    const [action, input] = steps[index], now = new Date(Date.UTC(2026, 9, 10, 0, 0, index)).toISOString();
    const { state, ...expected } = await local[action]({ ...input, now }, file);
    const result = applyTaskOperation(doc, action, input, { now, id: input.id });
    assert.deepEqual(result, expected);
    assert.deepEqual(doc.items, (await readStore(file)).tasks.items);
    validateTaskDocument(doc);
  }
});

test('cloud validation rejects bad references, cycles, schedule, tags and stale edits without changing input', async t => {
  const { store } = await storeFixture(t);
  const doc = taskDocumentFromStore(store); doc.phase = 'active';
  applyTaskOperation(doc, 'create', { title: 'Task' }, { id: 'root', now: '2026-10-10T00:00:00Z' });
  assert.throws(() => applyTaskOperation(structuredClone(doc), 'edit', { taskId: 'root', notes: 'stale', ifUpdatedAt: '2020-01-01T00:00:00Z' }), /Task changed/);
  for (const alter of [d => d.items[0].parentTaskId = 'root', d => d.items[0].projectId = 'unknown',
    d => d.items[0].schedule.startTime = '12:00', d => d.items[0].tags = ['A', 'a']]) {
    const invalid = structuredClone(doc); alter(invalid); assert.throws(() => validateTaskDocument(invalid));
  }
  const fields = Object.keys(doc).sort();
  assert.deepEqual(fields, ['items', 'phase', 'projectIds', 'schemaVersion', 'timezone']);
});

test('revision CAS preserves simultaneous edits and rejects stale task edits', async t => {
  const { store } = await storeFixture(t);
  const initial = taskDocumentFromStore(store); initial.phase = 'active';
  applyTaskOperation(initial, 'create', { title: 'Task' }, { id: 'root', now: '2026-10-10T00:00:00Z' });
  let row = { document: initial, revision: 1 }, collisions = 0;
  const repository = {
    async read() { return structuredClone(row); },
    async compareAndSwap(revision, document) {
      await new Promise(resolve => setImmediate(resolve));
      if (revision !== row.revision) { collisions++; return null; }
      row = { document: structuredClone(document), revision: revision + 1 }; return row.revision;
    },
  };
  const service = createCloudTaskService(repository);
  await Promise.all([service.edit({ taskId: 'root', notes: 'new notes' }), service.edit({ taskId: 'root', tags: ['important'] })]);
  assert.ok(collisions > 0); assert.equal(row.revision, 3);
  const result = await service.get({ taskId: 'root' });
  assert.equal(result.task.notes, 'new notes'); assert.deepEqual(result.task.tags, ['important']);
  await assert.rejects(service.edit({ taskId: 'root', title: 'lost', ifUpdatedAt: '2026-10-10T00:00:00Z' }), /Task changed/);
  assert.equal(row.revision, 3);
});

test('uninitialized/staged cloud data fails closed and no cloud operation purges expired Trash', async t => {
  const { store } = await storeFixture(t), doc = taskDocumentFromStore(store);
  await assert.rejects(createCloudTaskService({ read: async () => null }).list(), /not initialized/);
  await assert.rejects(createCloudTaskService({ read: async () => ({ document: doc, revision: 1 }) }).list(), /not active/);
  doc.phase = 'active'; applyTaskOperation(doc, 'create', { title: 'Old trash' }, { id: 'old', now: '2020-01-01T00:00:00Z' });
  applyTaskOperation(doc, 'trash', { taskId: 'old' }, { now: '2020-01-02T00:00:00Z' });
  const service = createCloudTaskService({ read: async () => ({ document: structuredClone(doc), revision: 1 }) });
  assert.equal((await service.list({ scope: 'trash' })).total, 0); assert.equal(doc.items.length, 1);
  assert.deepEqual(Object.keys(service).sort(), ['complete', 'create', 'edit', 'get', 'list', 'restore', 'trash']);
});
