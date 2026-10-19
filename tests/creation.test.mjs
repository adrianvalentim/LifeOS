import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createCreationIdea, updateCreationIdea, readStore, DEMO_STORE_PATH, migrateStore, validateStore,
  createTask, reorderTask, setTaskCompletion, setTaskPriority, updateTask, trashTask } from '../src/lifeos-data.mjs';
import creationScreen, { formatSelection as formatMarkdownSelection, visibleIdeas } from '../public/app/screens/creation.js';
import { store } from '../public/app/store.js';
import { taskDocumentFromStore } from '../src/cloud-task-service.mjs';
import { withTaskRepository } from '../src/task-online.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lifeos-creation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  const store = await readStore(DEMO_STORE_PATH);
  store.tasks.items = [];
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  const add = input => createCreationIdea({ title: 'Por que o céu é escuro?', ...input }, storePath);
  const edit = (idea, input) => updateCreationIdea({ ideaId: idea.id, expectedUpdatedAt: idea.updatedAt, ...input }, storePath);
  return { dir, storePath, add, edit };
}

test('version 10 migrates without changing existing records and version 11 validates Creation', async () => {
  const old = JSON.parse(await readFile(DEMO_STORE_PATH, 'utf8')); old.meta.schemaVersion = 10; delete old.creation;
  const before = structuredClone(old), migrated = migrateStore(old);
  assert.deepEqual(old, before); assert.equal(migrated.meta.schemaVersion, 11);
  assert.deepEqual(migrated.creation, { ideas: [] }); assert.deepEqual(migrated.tasks, old.tasks);
  validateStore(migrated);
  delete migrated.creation; assert.throws(() => validateStore(migrated), /creation.ideas/);
});

test('only dated shorts create one task and repeat submissions are idempotent', async t => {
  const f = await fixture(t), id = randomUUID();
  const { idea, state } = await f.add({ id, type: 'Shorts', date: '2026-10-21', markdown: '# Roteiro\n\nAção, emoção. 🔭' });
  assert.equal(idea.type, 'short'); assert.equal(state.tasks.items.length, 1);
  assert.equal(state.tasks.items[0].id, idea.taskId); assert.equal(state.tasks.items[0].schedule.dueDate, idea.date);
  assert.equal(state.tasks.items[0].notes, ''); assert.equal(state.tasks.items[0].projectId, null);
  assert.deepEqual(state.tasks.items[0].tags, ['Creation', 'Shorts']);
  await f.add({ id, title: 'Retry must preserve title' });
  await f.add({ type: 'Long vídeo', date: '2026-10-22' });
  await f.add({ type: 'short' }); await f.add({ type: 'Essay', date: '2026-10-22' });
  const store = await readStore(f.storePath);
  assert.equal(store.tasks.items.length, 1); assert.equal(store.creation.ideas.length, 4);
  assert.equal(store.creation.ideas[0].title, idea.title); assert.equal(store.creation.ideas[1].type, 'long_video');
});

test('short scheduling updates preserve task identity, notes, priority and child completion rules', async t => {
  const f = await fixture(t);
  let { idea } = await f.add({ type: 'short', date: '2026-10-21' });
  const id = idea.taskId;
  await setTaskPriority({ taskId: id, priority: 'high' }, f.storePath);
  await updateTask({ taskId: id, notes: 'Keep user task notes' }, f.storePath);
  const child = (await createTask({ title: 'Film', parentTaskId: id }, f.storePath)).task;
  ({ idea } = await f.edit(idea, { title: 'Uma nova pergunta', date: '2026-11-02', status: 'done' }));
  let store = await readStore(f.storePath), task = store.tasks.items.find(t => t.id === id);
  assert.equal(task.title, 'Uma nova pergunta'); assert.equal(task.schedule.dueDate, '2026-11-02');
  assert.equal(task.priority, 'high'); assert.equal(task.notes, 'Keep user task notes');
  assert.equal(task.status, 'completed'); assert.equal(store.tasks.items.find(t => t.id === child.id).status, 'completed');
  ({ idea } = await f.edit(idea, { status: 'doing' }));
  store = await readStore(f.storePath); assert.equal(store.tasks.items[0].status, 'open'); assert.equal(store.tasks.items[1].status, 'completed');
  await setTaskCompletion({ taskId: id, completed: true }, f.storePath);
  ({ idea } = await f.edit(idea, { markdown: 'Only the script changed' }));
  store = await readStore(f.storePath); assert.equal(store.tasks.items[0].status, 'completed'); assert.equal(idea.taskId, id);
});

test('removing date, changing type, or dropping recovers the same task through Trash', async t => {
  const f = await fixture(t);
  let { idea } = await f.add({ date: '2026-10-22' }); const id = idea.taskId;
  for (const patch of [{ date: null }, { type: 'long_video' }, { status: 'dropped' }]) {
    ({ idea } = await f.edit(idea, patch));
    assert.ok((await readStore(f.storePath)).tasks.items[0].trashedAt);
    ({ idea } = await f.edit(idea, { date: '2026-10-23', type: 'short', status: 'next_up' }));
    const store = await readStore(f.storePath);
    assert.equal(store.tasks.items.length, 1); assert.equal(store.tasks.items[0].id, id);
    assert.equal(store.tasks.items[0].trashedAt, null);
  }
  await trashTask({ taskId: id }, f.storePath);
  ({ idea } = await f.edit(idea, { markdown: 'Do not resurrect a manually trashed task' }));
  assert.ok((await readStore(f.storePath)).tasks.items[0].trashedAt);
});

test('rescheduling a completed Short reopens completed ancestors when restoring its task', async t => {
  const f = await fixture(t);
  let { idea } = await f.add({ date: '2026-10-22', status: 'done' });
  const parent = (await createTask({ title: 'Production' }, f.storePath)).task;
  await reorderTask({ taskId: idea.taskId, parentTaskId: parent.id, beforeTaskId: null }, f.storePath);
  ({ idea } = await f.edit(idea, { date: null }));
  await setTaskCompletion({ taskId: parent.id, completed: true }, f.storePath);
  ({ idea } = await f.edit(idea, { date: '2026-10-23', status: 'doing' }));
  const store = await readStore(f.storePath);
  assert.equal(store.tasks.items.find(task => task.id === idea.taskId).trashedAt, null);
  assert.equal(store.tasks.items.find(task => task.id === idea.taskId).status, 'open');
  assert.equal(store.tasks.items.find(task => task.id === parent.id).status, 'open');
});

test('stale saves and invalid payloads preserve the disk and independent concurrent edits', async t => {
  const f = await fixture(t); const { idea } = await f.add({ markdown: 'Original' });
  const next = await f.edit(idea, { markdown: 'Saved elsewhere' });
  const before = await readFile(f.storePath);
  await assert.rejects(f.edit(idea, { markdown: 'Stale' }), /changed elsewhere/);
  for (const patch of [{ date: '2026-02-30' }, { status: 'paused' }, { title: '' }, { type: '' }, { markdown: 'x'.repeat(200001) }]) {
    await assert.rejects(f.edit(next.idea, patch));
  }
  assert.deepEqual(await readFile(f.storePath), before);
  const first = await f.add({ title: 'First' }), second = await f.add({ title: 'Second' });
  await Promise.all([f.edit(first.idea, { markdown: 'First survives' }), f.edit(second.idea, { markdown: 'Second survives' })]);
  const store = await readStore(f.storePath);
  assert.equal(store.creation.ideas.find(i => i.id === first.idea.id).markdown, 'First survives');
  assert.equal(store.creation.ideas.find(i => i.id === second.idea.id).markdown, 'Second survives');
});

test('Creation participates in the existing cloud task transaction, and offline task failures are atomic', async t => {
  const f = await fixture(t);
  const document = taskDocumentFromStore(await readStore(f.storePath)); document.phase = 'active';
  let row = { revision: 1, document }, offline = false;
  const repository = { async read() { if (offline) throw new Error('offline'); return structuredClone(row); },
    async compareAndSwap(revision, document) { if (revision !== row.revision) return null; row = { revision: revision + 1, document: structuredClone(document) }; return row.revision; } };
  await writeFile(`${f.storePath}.task-authority.json`, JSON.stringify({ source: 'cloudflare-d1', phase: 'active', mode: 'online', origin: 'https://tasks.example', taskDigest: 'fixture', configFile: path.join(f.dir, 'fixture.json'), workspaceRoot: '/fixture', databaseId: 'fixture', accountId: 'fixture' }));
  await withTaskRepository(f.storePath, repository, async () => {
    let { idea } = await f.add({ date: '2026-10-21', markdown: 'Private script' });
    assert.equal(row.document.items[0].id, idea.taskId); assert.equal(row.document.items[0].notes, '');
    assert.equal(row.document.creation, undefined); assert.ok(!JSON.stringify(row.document).includes('Private script'));
    offline = true;
    ({ idea } = await f.edit(idea, { markdown: 'Offline script edit' }));
    const before = await readFile(f.storePath);
    await assert.rejects(f.edit(idea, { date: '2026-10-22' }), /offline/);
    assert.deepEqual(await readFile(f.storePath), before);
    offline = false;
    ({ idea } = await f.edit(idea, { date: '2026-10-22' }));
    assert.equal(row.document.items[0].schedule.dueDate, '2026-10-22');
  });
});

test('board, list, type filters and sorts share the same records and escape user input', () => {
  const ideas = [
    { id: 'one', title: '<script>bad</script>', markdown: 'Body', type: 'short', status: 'doing', sortOrder: 1, date: null, updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'two', title: 'A film', markdown: '', type: 'long_video', status: 'done', sortOrder: 2, date: '2026-10-21', updatedAt: '2026-10-02T00:00:00Z' },
    { id: 'three', title: 'Essay', markdown: '', type: 'Essay', status: 'dropped', sortOrder: 3, date: '2026-10-20', updatedAt: '2026-10-03T00:00:00Z' },
  ];
  store.state = { meta: { today: '2026-10-18' }, creation: { ideas }, tasks: { items: [] } };
  store.ui.filter = '';
  Object.assign(store.prefs.creation, { view: 'board', type: 'all', status: 'all', sort: 'manual', editorMode: 'edit' });
  const view = (params = '', id = null) => { store.ui.route = { section: 'creation', id, params: new URLSearchParams(params) }; return String(creationScreen.render()); };
  const html = view('view=board');
  for (const status of ['to_do', 'next_up', 'doing', 'done', 'dropped']) assert.ok(html.includes(`data-idea-drop="${status}"`));
  assert.ok(!html.includes('<script>bad')); assert.ok(html.includes('&lt;script&gt;bad'));
  store.prefs.creation.type = 'short'; assert.deepEqual(visibleIdeas().map(i => i.id), ['one']);
  store.prefs.creation.type = 'all'; store.prefs.creation.sort = 'date'; assert.deepEqual(visibleIdeas().map(i => i.id), ['three', 'two', 'one']);
  store.ui.filter = 'body'; assert.equal(visibleIdeas().length, 1);
  store.ui.filter = ''; assert.ok(view('view=list').includes('<table'));
  assert.ok(view('', 'one').includes('data-idea-field="markdown"'));
});

test('Markdown formatting preserves selected text, Unicode, and multiline lists', () => {
  assert.equal(formatMarkdownSelection('Olá mundo', 0, 3, 'bold').value, '**Olá** mundo');
  assert.equal(formatMarkdownSelection('one\ntwo', 0, 7, 'check').value, '- [ ] one\n- [ ] two\n');
  assert.equal(formatMarkdownSelection('α\nβ', 0, 3, 'number').value, '1. α\n2. β\n');
  assert.equal(formatMarkdownSelection('', 0, 0, 'block').value, '```\ncode\n```\n');
});
