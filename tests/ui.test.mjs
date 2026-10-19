// The browser interface rendered in Node from real derived state: task
// scopes and grouping, accessible rows and drop targets, sheets, project and
// reading views, settings, agent context and natural-language capture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildState, DEMO_STORE_PATH, readStore } from '../src/lifeos-data.mjs';
import { defaultWorkspace } from '../src/lifeos-workspace.mjs';
import { store } from '../public/app/store.js';
import { attr, html, raw } from '../public/app/dom.js';
import { canReorder, groupTasks, lingering, matchesViewFilter, sortTasks, taskScope } from '../public/app/task-model.js';
import { renderTaskGroups, renderTaskRow } from '../public/app/components/task-list.js';
import { renderTaskSheet } from '../public/app/components/task-sheet.js';
import { contextFor, messageWithContext } from '../public/app/agent-context.js';
import { parseCapture } from '../public/app/nlp.js';
import tasksScreen from '../public/app/screens/tasks.js';
import projectsScreen from '../public/app/screens/projects.js';
import readingScreen, { finishedInYear, renderBookSheet } from '../public/app/screens/reading.js';
import creationScreen, { formatSelection } from '../public/app/screens/creation.js';
import todayScreen from '../public/app/screens/today.js';
import insightsScreen from '../public/app/screens/insights.js';
import almanacScreen from '../public/app/screens/almanac.js';
import settingsScreen from '../public/app/screens/settings.js';

const NOW = '2026-08-22T15:00:00Z';
const TODAY = '2026-08-22';
const demo = await readStore(DEMO_STORE_PATH);

function state(mutate) {
  const copy = structuredClone(demo);
  mutate?.(copy);
  return { ...buildState(copy, { now: NOW }), workspace: defaultWorkspace() };
}

function mount(next, { section = 'tasks', id = null, params = '' } = {}) {
  store.state = next;
  store.ui.route = { section, id, params: new URLSearchParams(params) };
  store.ui.filter = '';
  store.ui.selection = new Set();
  store.ui.sheet = null;
  store.ui.focusId = null;
  store.ui.editing = null;
  store.ui.drafts = {};
  store.ui.idea = null;
  return next;
}

const render = (screen) => String(screen.render());
const find = (s, title) => s.tasks.items.find((task) => task.title === title);

test('task scopes keep Inbox, smart lists, tags and lifecycles apart', () => {
  const s = mount(state((copy) => {
    copy.tasks.items.find((task) => task.title === 'Renew passport').schedule.dueDate = '2026-08-20';
  }));
  assert.deepEqual(taskScope('inbox', s).items.map((task) => task.title), ['Renew passport']);
  assert.deepEqual(taskScope('today', s).items.map((task) => task.title), ['Renew passport'], 'overdue work belongs to Today');
  const next7 = taskScope('next7', s).items.map((task) => task.title);
  assert.ok(next7.includes('Finish the Act III draft') && next7.includes('Lock the observatory sequence'));
  const tagged = taskScope('tag:writing', s).items.map((task) => task.title);
  assert.ok(tagged.includes('Finish the Act III draft'));
  assert.ok(taskScope('completed', s).items.every((task) => task.status === 'completed'));
  assert.equal(taskScope('trash', s).items.length, 0);
  assert.equal(taskScope('project:vulcano', s).project.id, 'vulcano');
});

test('a tag scope stays active-only even when a completed subtask shares the tag', () => {
  const s = mount(state((copy) => {
    const done = copy.tasks.items.find((task) => task.title === 'Resolve the midpoint turn');
    done.tags = ['writing'];
  }));
  assert.ok(!taskScope('tag:writing', s).items.some((task) => task.status === 'completed'));
});

test('a task just completed stays in its list, crossed off and in place, until it stops lingering', () => {
  const open = demo.tasks.items.find((task) => task.status === 'open' && !task.trashedAt && task.projectId == null && !task.parentTaskId);
  const done = state((copy) => { const task = copy.tasks.items.find((item) => item.id === open.id); task.status = 'completed'; task.completedAt = NOW; });
  mount(done);
  assert.ok(!taskScope('inbox', done).items.some((task) => task.id === open.id), 'completed tasks leave the list');
  lingering.set(open.id, Date.now() + 1000);
  try {
    const inbox = taskScope('inbox', done);
    const row = inbox.items.find((task) => task.id === open.id);
    assert.ok(row, 'a lingering task is still listed');
    const byTitle = [...inbox.items].sort((x, y) => x.title.localeCompare(y.title)).map((task) => task.id);
    assert.deepEqual(sortTasks(inbox.items, 'title').map((task) => task.id), byTitle, 'it keeps its place instead of sinking below open tasks');
    assert.match(String(renderTaskRow(row, { scope: inbox })), /task-row[^"]*is-completed/);
  } finally {
    lingering.delete(open.id);
  }
});

test('due-date grouping separates overdue work and marks single-date lanes as drop targets', () => {
  const s = mount(state((copy) => {
    copy.tasks.items.find((task) => task.title === 'Renew passport').schedule.dueDate = '2026-08-20';
  }));
  const scope = taskScope('all', s);
  const groups = groupTasks(scope.items, { groupBy: 'due', sortBy: 'manual' }, s);
  const overdue = groups.find((group) => group.id === 'due:overdue');
  assert.deepEqual(overdue.tasks.map((task) => task.title), ['Renew passport']);
  assert.ok(!overdue.drop, 'an overdue lane names no single date, so it takes no drop');
  assert.ok(!groups.find((group) => group.id === 'due:week')?.drop, 'neither does a seven-day window');
  const markup = String(renderTaskGroups(groups, scope));
  assert.match(markup, /data-drop-group="due" data-drop-value="2026-08-22"/, 'Today stays a drop lane even when empty');
  assert.match(markup, /data-drop-group="due" data-drop-value="2026-08-23"/);
});

test('view options decide what a drag may do', () => {
  const s = mount(state());
  assert.equal(canReorder(taskScope('project:portia', s), 'none', 'manual'), true);
  assert.equal(canReorder(taskScope('project:portia', s), 'none', 'priority'), false);
  assert.equal(canReorder(taskScope('completed', s), 'none', 'manual'), false);
  assert.equal(canReorder(taskScope('trash', s), 'none', 'manual'), false);
});

test('saved view filters combine projects, tags, priorities and dates', () => {
  const s = mount(state());
  const filter = { projects: ['portia'], tags: ['writing'], priorities: ['high'], due: 'next7', status: 'open', text: '' };
  const matches = s.tasks.items.filter((task) => matchesViewFilter(task, filter, TODAY)).map((task) => task.title);
  assert.deepEqual(matches, ['Finish the Act III draft']);
});

test('task rows are accessible tree items with real controls, and trashed rows cannot be dragged', () => {
  const s = mount(state((copy) => {
    copy.tasks.items.find((task) => task.title === 'Renew passport').trashedAt = '2026-08-21T12:00:00.000Z';
  }));
  const open = String(renderTaskRow(find(s, 'Finish the Act III draft'), { scope: taskScope('all', s) }));
  assert.match(open, /role="treeitem"/);
  assert.match(open, /role="checkbox" aria-checked="false"/);
  assert.match(open, /data-draggable="task"/);
  assert.match(open, /data-action="task-menu"/);
  assert.match(open, /href="\/tasks\?list=tag:writing"/);
  const trashed = String(renderTaskRow(find(s, 'Renew passport'), { scope: taskScope('trash', s) }));
  assert.doesNotMatch(trashed, /data-draggable/);
  assert.match(trashed, /data-action="task-restore"/);
  assert.match(trashed, /left/);
});

test('the Tasks screen offers drop targets only where a drop means one clear change', () => {
  mount(state(), { params: 'list=all' });
  const markup = render(tasksScreen);
  // Move to a list, date it today, tag it, complete it, or trash it.
  for (const list of ['inbox', 'today', 'project:portia', 'tag:writing', 'completed', 'trash']) assert.match(markup, new RegExp(`data-drop-list="${list}"`));
  for (const list of ['all', 'next7']) assert.doesNotMatch(markup, new RegExp(`data-drop-list="${list}"`));
  assert.match(markup, /data-quick-add=/);
  assert.match(markup, /data-page-filter/);
});

test('the Tasks screen reports shared-store state: synced, offline, or transfer pending', () => {
  const online = state();
  online.tasks.authority = { mode: 'online', phase: 'active', online: true };
  mount(online, { params: 'list=all' });
  assert.match(render(tasksScreen), /Synced to cloud/);
  online.tasks.authority = { mode: 'online', phase: 'active', online: false };
  assert.match(render(tasksScreen), /Offline — cached tasks/);
  online.tasks.authority = { mode: 'online', phase: 'fenced' };
  assert.match(render(tasksScreen), /Task transfer pending/);
});

test('the task sheet edits every field, keeps subtasks with their parent, and recovers trash', () => {
  const s = mount(state((copy) => {
    copy.tasks.items.find((task) => task.title === 'Finish the Act III draft').notes = 'Reference https://example.org/script and keep going.';
    copy.tasks.items.find((task) => task.title === 'Renew passport').trashedAt = '2026-08-21T12:00:00.000Z';
  }));
  const root = String(renderTaskSheet(find(s, 'Finish the Act III draft').id));
  for (const action of ['sheet-project', 'sheet-due', 'sheet-duration', 'sheet-priority', 'sheet-tags', 'sheet-toggle', 'sheet-trash', 'sheet-codex']) assert.match(root, new RegExp(`data-action="${action}"`));
  assert.match(root, /data-task-field="notes"/);
  assert.match(root, /data-task-link="[^"]+"[^>]*>|class="link-chip" href="https:\/\/example.org\/script"/);
  const child = String(renderTaskSheet(find(s, 'Write the confrontation scene').id));
  assert.match(child, /follows parent/);
  assert.doesNotMatch(child, /data-action="sheet-project"/);
  const trashed = String(renderTaskSheet(find(s, 'Renew passport').id));
  assert.match(trashed, /data-action="sheet-restore"/);
  assert.match(trashed, /data-task-field="title"[^>]*disabled/);
});

test('Projects list keeps every status as a drop lane and the board shows only Next up, Doing and Done', () => {
  mount(state((copy) => { copy.projects.find((project) => project.id === 'vulcano').status = 'paused'; }), { section: 'projects', params: 'view=list' });
  const list = render(projectsScreen);
  for (const status of ['to_do', 'next_up', 'doing', 'paused', 'done', 'dropped']) assert.match(list, new RegExp(`data-drop-status="${status}"`));
  store.ui.route = { section: 'projects', id: null, params: new URLSearchParams('view=board') };
  const board = render(projectsScreen);
  assert.match(board, /data-key="col-next_up"/);
  assert.match(board, /data-key="col-doing"/);
  assert.match(board, /data-key="col-done"/);
  assert.doesNotMatch(board, /data-key="col-paused"/);
});

test('a project page is editable in place and offers status, focus, pinning and agent context', () => {
  mount(state(), { section: 'projects', id: 'portia' });
  const page = render(projectsScreen);
  assert.match(page, /data-project-field="name"/);
  assert.match(page, /data-project-field="nextAction"/);
  for (const action of ['project-status', 'project-start', 'project-codex', 'project-pin', 'project-deadline', 'project-plan']) assert.match(page, new RegExp(`data-action="${action}"`));
});

test('Reading counts finished books by the configured time zone and the shelf shows only this year', () => {
  assert.equal(finishedInYear({ status: 'finished', finishedAt: '2027-01-01T01:00:00Z' }, '2026', 'America/Sao_Paulo'), true);
  assert.equal(finishedInYear({ status: 'finished', finishedAt: '2027-01-01T01:00:00Z' }, '2026', 'UTC'), false);
  const s = mount(state((copy) => {
    copy.reading.books.find((book) => book.title === 'The Odyssey').finishedAt = '2025-12-20T12:00:00-03:00';
  }), { section: 'reading', params: 'view=board' });
  const shelf = render(readingScreen);
  assert.doesNotMatch(shelf, /The Odyssey/);
  assert.match(shelf, /The Fifth Season/);
  assert.doesNotMatch(shelf, /Moby-Dick/, 'dropped books stay in the Library');
  store.ui.route = { section: 'reading', id: null, params: new URLSearchParams('view=library') };
  const library = render(readingScreen);
  for (const key of ['title', 'status', 'tags', 'pages', 'addedAt', 'finishedAt']) assert.match(library, new RegExp(`data-action="reading-sort" data-key="${key}"`));
  assert.match(library, /Moby-Dick/);
  const finished = s.reading.books.find((book) => book.title === 'The Fifth Season');
  assert.match(String(renderBookSheet(finished.id)), /data-action="book-sheet-finished"/);
});

test('Creation renders five workflow lanes, the editor, and Markdown formatting helpers', () => {
  const s = mount(state((copy) => {
    copy.creation.ideas = [{ id: 'idea-1', title: 'Eclipse hook', markdown: '# Hook', type: 'short', status: 'doing', date: null, taskId: null, sortOrder: 1, createdAt: NOW, updatedAt: NOW }];
  }), { section: 'creation', params: 'view=board' });
  const board = render(creationScreen);
  for (const status of ['to_do', 'next_up', 'doing', 'done', 'dropped']) assert.match(board, new RegExp(`data-idea-drop="${status}"`));
  assert.match(board, /Eclipse hook/);
  store.ui.route = { section: 'creation', id: s.creation.ideas[0].id, params: new URLSearchParams() };
  store.prefs.creation.editorMode = 'visual'; // the editor itself mounts in a browser
  const editor = render(creationScreen);
  assert.match(editor, /class="editor-visual"/);
  assert.match(editor, /role="status">Saved</);
  store.prefs.creation.editorMode = 'source';
  assert.match(render(creationScreen), /data-idea-field="markdown"/);
  store.prefs.creation.editorMode = 'visual';
  const bold = formatSelection('make this bold', 5, 9, 'bold');
  assert.equal(bold.value, 'make **this** bold');
});

test('Today, Insights, Almanac and every Settings page render from derived state', () => {
  mount(state(), { section: 'today' });
  assert.match(render(todayScreen), /Today’s tasks/);
  mount(state(), { section: 'insights' });
  const insights = render(insightsScreen);
  assert.match(insights, /Domains vs plan/);
  assert.match(insights, /id="time-log"/);
  mount(state(), { section: 'almanac' });
  const almanac = render(almanacScreen);
  assert.match(almanac, /data-milestone-add/);
  assert.match(almanac, /Milestones/);
  for (const page of ['general', 'appearance', 'sidebar', 'planning', 'views', 'shortcuts']) {
    mount(state(), { section: 'settings', id: page });
    assert.match(render(settingsScreen), /settings-group/, page);
  }
  mount(state(), { section: 'settings', id: 'appearance' });
  assert.match(render(settingsScreen), /data-name="theme" data-value="dark"/);
});

test('agent context attaches the exact record with its stable ID ahead of the instruction', () => {
  mount(state());
  const project = contextFor('project', 'portia');
  assert.equal(project.id, 'portia');
  assert.match(project.message, /"stableId": "portia"/);
  assert.match(project.message, /"label": "Filmmaking"/);
  const book = contextFor('book', store.state.reading.books[0].id);
  assert.match(book.message, new RegExp(store.state.reading.books[0].title));
  assert.equal(messageWithContext(project, '  Plan the week  '), `${project.message}\n\nPlan the week`);
  assert.equal(messageWithContext(project, '   '), '');
  assert.equal(messageWithContext(null, 'Hello'), 'Hello');
});

test('quick capture understands dates, times, priorities, tags, projects, durations and Portuguese', () => {
  const projects = [{ id: 'portia', name: 'Portia', status: 'doing' }, { id: 'vulcano', name: 'Vulcano', status: 'next_up' }];
  const task = parseCapture('Draft outline fri 3pm !high #writing @Portia for 30m', { today: TODAY, projects, mode: 'task' });
  assert.deepEqual({ title: task.title, due: task.dueDate, time: task.startTime, priority: task.priority, tags: task.tags, project: task.projectId, minutes: task.durationMinutes },
    { title: 'Draft outline', due: '2026-08-28', time: '15:00', priority: 'high', tags: ['writing'], project: 'portia', minutes: 30 });
  const portuguese = parseCapture('Ligar para o laboratório amanhã às 15h', { today: TODAY, projects, mode: 'task' });
  assert.equal(portuguese.dueDate, '2026-08-23');
  assert.equal(portuguese.startTime, '15:00');
  const log = parseCapture('2h 15m color pass @Vulcano ~creative yesterday', { today: TODAY, projects, mode: 'log' });
  assert.deepEqual([log.durationMinutes, log.projectId, log.activityType, log.dueDate], [135, 'vulcano', 'creative', '2026-08-21']);
});

test('templates escape interpolated text and compose nested templates', () => {
  const name = '<img src=x onerror=alert(1)>';
  const out = String(html`<b title="${name}">${name}</b>${html`<i>${'&'}</i>`}${raw('<hr>')}${attr('disabled', true)}`);
  assert.equal(out, '<b title="&lt;img src=x onerror=alert(1)&gt;">&lt;img src=x onerror=alert(1)&gt;</b><i>&amp;</i><hr> disabled');
});

test('optimistic updates never mutate the previous state, so a failed write can roll back', async () => {
  const { optimistic } = await import('../public/app/api.js');
  const before = mount(state());
  const book = before.reading.books.find((item) => item.status === 'next_up');
  const project = before.projects[0];
  const task = find(before, 'Renew passport');
  const snapshot = JSON.stringify(before);
  const after = optimistic.task(optimistic.project(optimistic.book(before, book.id, { status: 'reading' }), project.id, { status: 'doing' }), task.id, { priority: 'high' });
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(after.reading.books.find((item) => item.id === book.id).status, 'reading');
  assert.equal(after.projects.find((item) => item.id === project.id).status, 'doing');
  assert.equal(after.tasks.items.find((item) => item.id === task.id).priority, 'high');
  assert.notEqual(after.reading.books, before.reading.books);
});
