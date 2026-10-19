// Every user intent in one place: each maps to one LifeOS command (the same
// command an agent would call) with an optimistic update, so the interface
// responds instantly even while cloud-backed task writes take a second.
import { optimistic, postJson, run } from './api.js';
import { uid } from './dom.js';
import { addDays } from './format.js';
import { navigate } from './router.js';
import { lingering } from './task-model.js';
import { lookup, patchUi, rememberRecent, render, store } from './store.js';
import { confirmDialog } from './ui/dialog.js';
import { toast } from './ui/toast.js';

const now = () => new Date().toISOString();
const today = () => store.state.meta.today;

// ——— Opening things ————————————————————————————————————————————————
export function openTask(id, { focus = null } = {}) {
  if (!lookup.task(id)) return;
  store.ui.sheet = { kind: 'task', id, focus };
  rememberRecent({ kind: 'task', id });
  render();
}
export function openBook(id) {
  store.ui.sheet = { kind: 'book', id };
  rememberRecent({ kind: 'book', id });
  render();
}
export function closeSheet() {
  store.ui.sheet = null;
  render();
}
export function openProject(id) {
  rememberRecent({ kind: 'project', id });
  navigate(`/projects/${encodeURIComponent(id)}`);
}
export function openIdea(id) {
  rememberRecent({ kind: 'idea', id });
  navigate(`/creation/${encodeURIComponent(id)}`);
}
export function openRecord(kind, id) {
  if (kind === 'task') {
    const task = lookup.task(id);
    if (task && store.ui.route.section !== 'tasks' && store.ui.route.section !== 'today' && store.ui.route.section !== 'projects') navigate('/tasks', { keepSheet: true });
    openTask(id);
  } else if (kind === 'project') openProject(id);
  else if (kind === 'book') { if (store.ui.route.section !== 'reading') navigate('/reading', { keepSheet: true }); openBook(id); }
  else if (kind === 'idea') openIdea(id);
  else if (kind === 'milestone') navigate('/almanac');
  else if (kind === 'entry') navigate('/insights');
}

// ——— Tasks ——————————————————————————————————————————————————————————
function descendants(id) {
  const items = store.state.tasks.items;
  const out = [];
  const queue = items.filter((task) => task.parentTaskId === id);
  while (queue.length) {
    const task = queue.shift();
    out.push(task.id);
    queue.push(...items.filter((child) => child.parentTaskId === task.id));
  }
  return out;
}

export async function createTask(input, { open = false, quiet = false } = {}) {
  const id = uid();
  const timestamp = now();
  const draft = {
    id, title: input.title, notes: input.notes || '', projectId: input.projectId ?? null, parentTaskId: input.parentTaskId || null,
    status: 'open', priority: input.priority || 'none', tags: input.tags || [], sortOrder: 1e9,
    schedule: { dueDate: input.dueDate || null, startTime: input.startTime || null, durationMinutes: input.durationMinutes || null, recurrence: null },
    createdAt: timestamp, updatedAt: timestamp, completedAt: null, trashedAt: null,
    depth: 0, childIds: [], subtreeTotal: 1, subtreeCompleted: 0, allSubtreeTotal: 1, trashSubtreeTotal: 0, progress: 0, directSubtaskCount: 0,
  };
  if (draft.parentTaskId) {
    const parent = lookup.task(draft.parentTaskId);
    draft.projectId = parent?.projectId ?? null;
    draft.depth = (parent?.depth || 0) + 1;
  }
  const payload = { id, title: input.title };
  for (const key of ['notes', 'priority', 'tags', 'dueDate', 'startTime', 'durationMinutes', 'parentTaskId']) {
    if (input[key] !== undefined && input[key] !== null && !(Array.isArray(input[key]) && !input[key].length) && input[key] !== '') payload[key] = input[key];
  }
  if (!draft.parentTaskId && input.projectId !== undefined) payload.projectId = input.projectId;
  const result = await run('tasks.create', payload, {
    optimistic: (state) => {
      const items = [...state.tasks.items];
      if (draft.parentTaskId) {
        const index = items.findIndex((task) => task.id === draft.parentTaskId);
        let insertAt = index + 1;
        while (insertAt < items.length && (items[insertAt].depth || 0) > (items[index].depth || 0)) insertAt += 1;
        items.splice(insertAt, 0, draft);
      } else items.push(draft);
      return { ...state, tasks: { ...state.tasks, items } };
    },
    quiet,
  });
  if (open && result?.task) openTask(result.task.id, { focus: 'notes' });
  return result?.task;
}

export function toggleTask(id, completed = null) {
  const task = lookup.task(id);
  if (!task || task.trashedAt) return;
  const next = completed ?? task.status !== 'completed';
  const ids = next ? [id, ...descendants(id).filter((childId) => !lookup.task(childId)?.trashedAt)] : [id];
  if (next) {
    const until = Date.now() + 1400;
    for (const taskId of ids) lingering.set(taskId, until);
    setTimeout(() => {
      let changed = false;
      for (const taskId of ids) if (lingering.get(taskId) === until) { lingering.delete(taskId); changed = true; }
      if (changed) render();
    }, 1400);
  } else for (const taskId of ids) lingering.delete(taskId);
  return run('tasks.complete', { taskId: id, completed: next }, {
    optimistic: (state) => optimistic.tasks(state, ids, { status: next ? 'completed' : 'open', completedAt: next ? now() : null }),
    pending: [id],
  }).catch(() => undefined);
}

export function updateTask(id, patch, { quiet = false } = {}) {
  const schedulePatch = {};
  for (const key of ['dueDate', 'startTime', 'durationMinutes']) if (key in patch) schedulePatch[key] = patch[key];
  if ('dueDate' in patch && patch.dueDate === null) schedulePatch.startTime = null;
  return run('tasks.update', { taskId: id, ...patch }, {
    optimistic: (state) => optimistic.task(state, id, (task) => ({
      ...Object.fromEntries(Object.entries(patch).filter(([key]) => !['dueDate', 'startTime', 'durationMinutes'].includes(key))),
      ...(Object.keys(schedulePatch).length ? { schedule: { ...task.schedule, ...schedulePatch } } : {}),
      updatedAt: now(),
    })),
    pending: [id],
    quiet,
  }).catch(() => undefined);
}

export const setTaskDue = (id, dueDate) => updateTask(id, { dueDate });
export const setTaskPriority = (id, priority) => updateTask(id, { priority });
export const setTaskTags = (id, tags) => updateTask(id, { tags });

export function moveTask(id, projectId) {
  const ids = [id, ...descendants(id)];
  return run('tasks.move', { taskId: id, projectId }, {
    optimistic: (state) => optimistic.tasks(state, ids, { projectId }),
    pending: [id],
  }).catch(() => undefined);
}

export function trashTask(id) {
  const ids = [id, ...descendants(id)];
  if (store.ui.sheet?.id === id) store.ui.sheet = null;
  store.ui.selection.delete(id);
  return run('tasks.trash', { taskId: id }, {
    optimistic: (state) => optimistic.tasks(state, ids, (task) => ({ trashedAt: task.trashedAt || now() })),
  }).catch(() => undefined);
}

export function restoreTask(id) {
  return run('tasks.restore', { taskId: id }, {
    optimistic: (state) => optimistic.tasks(state, [id, ...descendants(id)], { trashedAt: null }),
  }).catch(() => undefined);
}

export async function deleteTaskForever(id) {
  const task = lookup.task(id);
  if (!task) return;
  if (store.state.tasks.authority?.mode === 'online') {
    toast('Cloud tasks keep Trash recoverable; they leave automatically after 30 days.', { tone: 'info' });
    return;
  }
  const count = (task.trashSubtreeTotal || 1) - 1;
  const ok = await confirmDialog({
    title: 'Delete forever?',
    body: `“${task.title}”${count ? ` and ${count} subtask${count === 1 ? '' : 's'}` : ''} will be permanently removed. This cannot be undone from Trash.`,
    confirmLabel: 'Delete forever',
    danger: true,
  });
  if (!ok) return;
  if (store.ui.sheet?.id === id) store.ui.sheet = null;
  await run('tasks.deleteForever', { taskId: id }, { undo: false }).catch(() => undefined);
}

export function duplicateTask(id) {
  return run('tasks.duplicate', { taskId: id }).catch(() => undefined);
}

export function reorderTask(id, { beforeTaskId = null, parentTaskId } = {}) {
  const input = { taskId: id, beforeTaskId };
  if (parentTaskId !== undefined) input.parentTaskId = parentTaskId;
  return run('tasks.reorder', input, { quiet: true }).catch(() => undefined);
}

export function bulkTasks(ids, action, value = undefined) {
  const list = [...ids];
  if (!list.length) return;
  const patchFor = {
    complete: { status: 'completed', completedAt: now() },
    reopen: { status: 'open', completedAt: null },
    trash: { trashedAt: now() },
    restore: { trashedAt: null },
    priority: { priority: value },
    move: { projectId: value },
  }[action];
  const input = { taskIds: list, action };
  if (value !== undefined) input.value = value;
  return run('tasks.bulk', input, {
    optimistic: patchFor
      ? (state) => optimistic.tasks(state, list, patchFor)
      : action === 'due' ? (state) => optimistic.tasks(state, list, (task) => ({ schedule: { ...task.schedule, dueDate: value } })) : null,
  }).then(() => {
    if (['trash', 'complete', 'move'].includes(action)) { store.ui.selection = new Set(); render(); }
  }).catch(() => undefined);
}

// ——— Projects ———————————————————————————————————————————————————————
export function setProjectStatus(id, status) {
  return run('projects.setStatus', { projectId: id, status }, {
    optimistic: (state) => optimistic.project(state, id, { status, statusChangedAt: now() }),
    pending: [id],
  }).catch(() => undefined);
}

export function updateProject(id, patch, { quiet = false } = {}) {
  return run('projects.update', { projectId: id, ...patch }, {
    optimistic: (state) => optimistic.project(state, id, patch),
    pending: [id],
    quiet,
  }).catch(() => undefined);
}

export async function createProject(input, { open = true } = {}) {
  const result = await run('projects.create', input).catch(() => null);
  if (result?.project && open) openProject(result.project.id);
  return result?.project;
}

export async function deleteProject(id) {
  const project = lookup.project(id);
  if (!project) return;
  const tasks = project.taskSummary?.total || 0;
  const ok = await confirmDialog({
    title: `Delete ${project.name}?`,
    body: `Its logged time stays in your statistics${project.categoryIds?.length ? '' : ' under a category named after it'}, and ${tasks ? `its ${tasks} task${tasks === 1 ? '' : 's'} move to Inbox` : 'nothing else is removed'}. You can undo this right after.`,
    confirmLabel: 'Delete project',
    danger: true,
  });
  if (!ok) return;
  if (store.ui.route.section === 'projects' && store.ui.route.id === id) navigate('/projects');
  await run('projects.delete', { projectId: id }).catch(() => undefined);
}

// ——— Time ——————————————————————————————————————————————————————————
export function startTimer({ projectId = null, description = '', activityType } = {}) {
  const input = { description: description || undefined };
  if (projectId !== undefined) input.projectId = projectId;
  if (activityType) input.activityType = activityType;
  return run('timer.start', input, {
    optimistic: (state) => ({ ...state, activeSession: { id: 'pending', projectId, categoryIds: [], activityType: activityType || 'deep_work', description: description || 'Focused work', rawInput: '', startedAt: now() } }),
  }).catch(() => undefined);
}

export function stopTimer() {
  return run('timer.stop', {}, { optimistic: (state) => ({ ...state, activeSession: null }) }).catch(() => undefined);
}

export async function discardTimer() {
  const ok = await confirmDialog({ title: 'Discard this timer?', body: 'No time will be logged. You can undo right after.', confirmLabel: 'Discard', danger: true });
  if (!ok) return;
  await run('timer.cancel', {}, { optimistic: (state) => ({ ...state, activeSession: null }) }).catch(() => undefined);
}

export function updateTimer(patch) {
  return run('timer.update', patch, {
    optimistic: (state) => (state.activeSession ? { ...state, activeSession: { ...state.activeSession, ...patch } } : state),
    quiet: true,
  }).catch(() => undefined);
}

export function logTime(input) {
  return run('time.log', input).catch(() => undefined);
}

export function updateEntry(id, patch) {
  return run('time.update', { entryId: id, ...patch }, {
    optimistic: (state) => ({ ...state, timeEntries: state.timeEntries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)), todayEntries: state.todayEntries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }),
  }).catch(() => undefined);
}

export function deleteEntry(id) {
  return run('time.delete', { entryId: id }, {
    optimistic: (state) => ({ ...state, timeEntries: state.timeEntries.filter((entry) => entry.id !== id), todayEntries: state.todayEntries.filter((entry) => entry.id !== id) }),
  }).catch(() => undefined);
}

// ——— Reading ————————————————————————————————————————————————————————
export function setBookStatus(id, status) {
  return run('reading.setStatus', { bookId: id, status }, {
    optimistic: (state) => optimistic.book(state, id, { status }),
    pending: [id],
  }).catch(() => undefined);
}

export function moveBook(id, status, beforeBookId = null) {
  return run('reading.move', { bookId: id, status, beforeBookId }, {
    optimistic: (state) => optimistic.book(state, id, { status }),
    quiet: lookup.book(id)?.status === status,
  }).catch(() => undefined);
}

export async function deleteBook(id) {
  const book = lookup.book(id);
  if (!book) return;
  const ok = await confirmDialog({
    title: `Remove “${book.title}”?`,
    body: 'The book, its tags and reading dates leave your library, and its cached cover is deleted. You can undo right after.',
    confirmLabel: 'Remove book',
    danger: true,
  });
  if (!ok) return;
  if (store.ui.sheet?.id === id) store.ui.sheet = null;
  await run('reading.delete', { bookId: id }).catch(() => undefined);
}

// ——— Creation ———————————————————————————————————————————————————————
export async function createIdea(input, { open = false } = {}) {
  const result = await run('creation.create', { id: uid(), ...input }).catch(() => null);
  if (result?.idea && open) openIdea(result.idea.id);
  return result?.idea;
}

export function moveIdea(id, status, beforeIdeaId = null) {
  return run('creation.move', { ideaId: id, status, beforeIdeaId }, {
    optimistic: (state) => optimistic.idea(state, id, { status }),
    quiet: lookup.idea(id)?.status === status,
  }).catch(() => undefined);
}

export async function deleteIdea(id) {
  const idea = lookup.idea(id);
  if (!idea) return;
  const ok = await confirmDialog({
    title: `Delete “${idea.title}”?`,
    body: `${idea.markdown.trim() ? 'Its writing is removed with it. ' : ''}${idea.taskId ? 'Its linked task moves to Trash. ' : ''}You can undo right after.`,
    confirmLabel: 'Delete idea',
    danger: true,
  });
  if (!ok) return;
  if (store.ui.route.section === 'creation' && store.ui.route.id === id) navigate('/creation');
  await run('creation.delete', { ideaId: id }).catch(() => undefined);
}

// ——— Workspace ——————————————————————————————————————————————————————
export function togglePin(kind, id) {
  const pinned = store.state.workspace.pinned.some((pin) => pin.kind === kind && pin.id === id);
  return run('pins.set', { kind, id, pinned: !pinned }, { quiet: true }).then(() => toast(pinned ? 'Unpinned from the masthead' : 'Pinned to the masthead', { tone: 'quiet' })).catch(() => undefined);
}

export function setTheme(mode) {
  return run('workspace.update', { theme: { mode } }, { quiet: true }).catch(() => undefined);
}

export function cycleTheme() {
  const current = store.state.workspace.theme.mode;
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = current === 'system' ? (prefersDark ? 'dark' : 'light') : current;
  return setTheme(effective === 'dark' ? 'light' : 'dark');
}

// ——— Links in task notes (desktop shell routes them through the server) ————
export const isDesktopShell = () => Boolean(window.__TAURI_INTERNALS__);

export async function openTaskLink(taskId, url) {
  if (!isDesktopShell()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try { await postJson('/api/tasks/open-link', { taskId, url }); }
  catch (error) { toast(error.message, { tone: 'error' }); }
}

export const dates = {
  today,
  tomorrow: () => addDays(today(), 1),
};

export function setEditing(value) {
  patchUi({ editing: value });
}
