import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listCommands, registry, runCommand } from '../src/commands/index.mjs';
import { DEMO_STORE_PATH, createTask, readStore } from '../src/lifeos-data.mjs';
import { historyPath, readHistory } from '../src/lifeos-history.mjs';
import { readWorkspace } from '../src/lifeos-workspace.mjs';
import { createLifeOS } from '../src/sdk.mjs';
import { taskDocumentFromStore } from '../src/cloud-task-service.mjs';
import { withTaskRepository } from '../src/task-online.mjs';

async function storeCopy(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-commands-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'lifeos.json');
  await writeFile(storePath, await readFile(DEMO_STORE_PATH), { mode: 0o600 });
  const run = (name, input = {}, extra = {}) => runCommand(name, input, { storePath, source: 'test', ...extra });
  return { dir, storePath, run };
}

test('every command has a schema, a description and a unique MCP-safe tool name', () => {
  const commands = listCommands();
  assert.ok(commands.length >= 75, `expected the full surface, found ${commands.length}`);
  const toolNames = new Set();
  for (const command of commands) {
    assert.ok(command.description.length > 20, `${command.name} needs a useful description`);
    assert.equal(command.inputSchema.type, 'object', `${command.name} input must be an object schema`);
    const tool = command.name.replace('.', '_');
    assert.match(tool, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.ok(!toolNames.has(tool));
    toolNames.add(tool);
  }
  // The person's capabilities in the app all exist as commands.
  for (const name of ['tasks.create', 'tasks.update', 'tasks.complete', 'tasks.trash', 'tasks.restore', 'tasks.reorder', 'tasks.bulk',
    'projects.create', 'projects.update', 'projects.delete', 'time.log', 'time.update', 'time.delete', 'timer.start', 'timer.stop',
    'reading.add', 'reading.move', 'reading.update', 'creation.create', 'creation.update', 'creation.delete',
    'settings.update', 'domains.create', 'milestones.create', 'challenge.set', 'views.create', 'workspace.update',
    'history.undo', 'history.redo', 'ui.navigate', 'ui.open']) {
    assert.ok(registry.has(name), `missing ${name}`);
  }
});

test('writes are journaled with source and wording, and undo/redo restore exact records', async (t) => {
  const { storePath, run } = await storeCopy(t);
  const created = await run('tasks.create', { title: 'Journal me', project: 'Portia', tags: ['film'] });
  assert.equal(created.label, 'Added “Journal me”');
  assert.match(created.operationId, /^op_/);
  const taskId = created.result.task.id;
  const before = (await readStore(storePath)).tasks.items.find((task) => task.id === taskId);

  const completed = await run('tasks.complete', { taskId });
  assert.equal(completed.label, 'Completed “Journal me”');
  const undone = await run('history.undo', {});
  assert.equal(undone.label, 'Undid: Completed “Journal me”');
  assert.deepEqual((await readStore(storePath)).tasks.items.find((task) => task.id === taskId), before);

  await run('history.redo', {});
  assert.equal((await readStore(storePath)).tasks.items.find((task) => task.id === taskId).status, 'completed');
  await run('history.undo', {});
  assert.equal((await readStore(storePath)).tasks.items.find((task) => task.id === taskId).status, 'open');

  const entries = await readHistory(storePath, { limit: 10 });
  assert.equal(entries[0].source, 'test');
  assert.ok(entries.some((entry) => entry.label === 'Completed “Journal me”' && entry.undoneBy));
  assert.deepEqual(entries.find((entry) => entry.label === 'Added “Journal me”').targets[0], { kind: 'task', id: taskId, label: 'Journal me' });
});

test('undo refuses to overwrite a record that changed afterwards', async (t) => {
  const { run } = await storeCopy(t);
  const { result } = await run('tasks.create', { title: 'Conflict' });
  const renamed = await run('tasks.update', { taskId: result.task.id, title: 'Renamed once' });
  await run('tasks.update', { taskId: result.task.id, priority: 'high' });
  await assert.rejects(run('history.undo', { operationId: renamed.operationId }), (error) => error.status === 409 && /cannot be undone/.test(error.message));
});

test('deleting records is reversible: projects, entries, ideas and their linked tasks come back intact', async (t) => {
  const { storePath, run } = await storeCopy(t);
  const before = await readStore(storePath);
  await run('projects.delete', { project: 'Vulcano' });
  const afterDelete = await readStore(storePath);
  assert.ok(!afterDelete.projects.some((project) => project.id === 'vulcano'));
  await run('history.undo', {});
  const restored = await readStore(storePath);
  assert.deepEqual(restored.projects.find((project) => project.id === 'vulcano'), before.projects.find((project) => project.id === 'vulcano'));
  assert.deepEqual(restored.tasks.items.filter((task) => task.projectId === 'vulcano').map((task) => task.id).sort(),
    before.tasks.items.filter((task) => task.projectId === 'vulcano').map((task) => task.id).sort());

  const idea = await run('creation.create', { title: 'Linked short', type: 'short', date: '2026-08-30' });
  const taskId = idea.result.idea.taskId;
  assert.ok(taskId);
  await run('creation.delete', { ideaId: idea.result.idea.id });
  assert.ok((await readStore(storePath)).tasks.items.find((task) => task.id === taskId).trashedAt);
  await run('history.undo', {});
  const back = await readStore(storePath);
  assert.equal(back.creation.ideas[0].title, 'Linked short');
  assert.equal(back.tasks.items.find((task) => task.id === taskId).trashedAt, null);
});

test('management commands create and edit projects, entries, planning and milestones', async (t) => {
  const { storePath, run } = await storeCopy(t);
  const project = await run('projects.create', { name: 'Atlas Doc', domain: 'research', categories: ['Infinitamente'], priority: 4, deadline: '2026-12-01' });
  assert.equal(project.result.project.id, 'atlas-doc');
  await run('projects.update', { project: 'Atlas Doc', progress: 0.4, plannedHours: 5, nextAction: 'Outline chapter one', status: 'doing' });
  let store = await readStore(storePath);
  const saved = store.projects.find((item) => item.id === 'atlas-doc');
  assert.equal(saved.progress, 0.4);
  assert.equal(saved.status, 'doing');
  assert.ok(saved.statusChangedAt);
  assert.equal(store.categories[saved.categoryIds[0]].label, 'Infinitamente');
  await assert.rejects(run('projects.create', { name: 'atlas doc' }), /already exists/);

  const logged = await run('time.log', { durationMinutes: 50, projectId: 'atlas-doc', activityType: 'research', description: 'Archive pass', date: '2026-08-20', time: '09:00' });
  await run('time.update', { entryId: logged.result.entry.id, durationMinutes: 65, activityType: 'deep_work' });
  store = await readStore(storePath);
  assert.equal(store.timeEntries.find((entry) => entry.id === logged.result.entry.id).durationMinutes, 65);
  await run('time.delete', { entryId: logged.result.entry.id });
  assert.ok(!(await readStore(storePath)).timeEntries.some((entry) => entry.id === logged.result.entry.id));

  const general = await run('time.log', { durationMinutes: 20, projectId: null, description: 'Portia inbox triage', activityType: 'admin' });
  assert.equal(general.result.entry.projectId, null, 'an explicit null never infers a project from the text');

  await run('settings.update', { defaultDailyPlanHours: 6, deepTarget: 0.7, health: { attentionInactiveDays: 3 } });
  const domain = await run('domains.create', { label: 'Writing', color: '#336699', weeklyHours: 4 });
  await run('milestones.create', { text: 'Atlas pitch accepted', date: '2026-08-21' });
  await run('challenge.set', { text: 'Three Atlas sessions', projectId: 'atlas-doc', startDate: '2026-08-17', endDate: '2026-08-23', target: 3 });
  store = await readStore(storePath);
  assert.equal(store.settings.defaultDailyPlanHours, 6);
  assert.equal(store.settings.weeklyPlanByDomain[domain.result.domain.id], 4);
  assert.ok(store.milestones.every((milestone) => milestone.id));
  assert.equal(store.challenge.projectId, 'atlas-doc');
  await assert.rejects(run('domains.delete', { domainId: 'research' }), /still used/);
});

test('workspace views, layout and pins are journaled and undoable', async (t) => {
  const { storePath, run } = await storeCopy(t);
  const view = await run('views.create', { name: 'Writing week', icon: 'pen', filter: { tags: ['writing'], due: 'next7' }, groupBy: 'due' });
  assert.equal(view.result.view.filter.due, 'next7');
  await run('pins.set', { kind: 'view', id: view.result.view.id });
  await run('workspace.update', { theme: { mode: 'dark' }, nav: [{ id: 'tasks' }, { id: 'today' }, { id: 'almanac', hidden: true }] });
  let workspace = await readWorkspace(storePath);
  assert.equal(workspace.theme.mode, 'dark');
  assert.deepEqual(workspace.nav.slice(0, 2).map((item) => item.id), ['tasks', 'today']);
  assert.equal(workspace.nav.find((item) => item.id === 'almanac').hidden, true);
  assert.equal(workspace.nav.length, 7, 'missing sections are appended');
  await run('history.undo', {});
  workspace = await readWorkspace(storePath);
  assert.equal(workspace.theme.mode, 'system');
  assert.equal(workspace.pinned[0].id, view.result.view.id);
  await run('views.delete', { viewId: 'Writing week' });
  assert.equal((await readWorkspace(storePath)).pinned.length, 0, 'deleting a view unpins it');
});

test('bulk edits change many tasks in one undoable step', async (t) => {
  const { storePath, run } = await storeCopy(t);
  const store = await readStore(storePath);
  const ids = store.tasks.items.filter((task) => !task.parentTaskId && task.status === 'open').slice(0, 3).map((task) => task.id);
  const result = await run('tasks.bulk', { taskIds: ids, action: 'due', value: '2026-09-01' });
  assert.equal(result.label, 'Rescheduled 3 tasks');
  assert.ok((await readStore(storePath)).tasks.items.filter((task) => ids.includes(task.id)).every((task) => task.schedule.dueDate === '2026-09-01'));
  await run('history.undo', {});
  const after = await readStore(storePath);
  for (const id of ids) {
    assert.equal(after.tasks.items.find((task) => task.id === id).schedule.dueDate, store.tasks.items.find((task) => task.id === id).schedule.dueDate);
  }
});

test('the SDK exposes commands as methods and names resolve like the CLI', async (t) => {
  const { storePath } = await storeCopy(t);
  const lifeos = createLifeOS({ storePath, source: 'test', actor: 'sdk test' });
  const { task } = await lifeos.tasks.create({ title: 'From code', project: 'Substack', priority: 'medium' });
  assert.equal(task.projectId, 'substack');
  assert.equal(lifeos.lastOperation.label, 'Added “From code”');
  const overview = await lifeos.overview();
  assert.ok(overview.tasks.open >= 1);
  await assert.rejects(lifeos.tasks.complete({ task: 'no such task anywhere' }), /Task not found/);
  await assert.rejects(lifeos.tasks.create({ title: 'x', project: 'Nope Project' }), /Project not found/);
  assert.equal(lifeos.tasks.nonexistent, undefined);
});

test('undoing a task creation under cloud authority moves it to recoverable Trash instead of deleting it', async (t) => {
  const { dir, storePath, run } = await storeCopy(t);
  const store = await readStore(storePath);
  store.tasks.items = [];
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  await createTask({ id: 'cloud-fixture', title: 'Cloud fixture' }, storePath);
  const document = taskDocumentFromStore(await readStore(storePath));
  document.phase = 'active';
  let row = { document, revision: 1 };
  const repository = {
    async read() { return structuredClone(row); },
    async compareAndSwap(revision, next) {
      if (revision !== row.revision) return null;
      row = { revision: revision + 1, document: structuredClone(next) };
      return row.revision;
    },
  };
  await writeFile(`${storePath}.task-authority.json`, JSON.stringify({ source: 'cloudflare-d1', phase: 'active', mode: 'online',
    origin: 'https://tasks.example', taskDigest: 'fixture', configFile: path.join(dir, 'private.json'),
    workspaceRoot: '/fixture', databaseId: 'db', accountId: 'acct' }), { mode: 0o600 });
  await withTaskRepository(storePath, repository, async () => {
    const created = await run('tasks.create', { title: 'Cloud created' });
    await run('history.undo', { operationId: created.operationId });
    const task = row.document.items.find((item) => item.id === created.result.task.id);
    assert.ok(task, 'the cloud record is retained');
    assert.ok(task.trashedAt, 'and moved to Trash');
  });
});

test('the journal stays bounded and survives a torn final line', async (t) => {
  const { storePath, run } = await storeCopy(t);
  await run('tasks.create', { title: 'One' });
  await writeFile(historyPath(storePath), `${await readFile(historyPath(storePath), 'utf8')}{"kind":"op","id":"op_torn`, 'utf8');
  const entries = await readHistory(storePath);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Added “One”');
});
