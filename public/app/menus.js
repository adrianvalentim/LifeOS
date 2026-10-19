// Entity menus as data. A row's right-click, its "⋯" button, Shift+F10 and the
// palette's "actions for…" all open these same menus.
import * as act from './actions.js';
import { agentName, attachContext } from './agent-context.js';
import { addDays, IDEA_STATUS, PRIORITY, PROJECT_STATUS, READING_STATUS } from './format.js';
import { lookup, patchUi, store } from './store.js';
import { openMenu } from './ui/menu.js';
import { pickDate, pickProject, pickTags, PRIORITY_ORDER, projectItems } from './ui/pickers.js';

export function taskMenu(id, anchor) {
  const task = lookup.task(id);
  if (!task) return;
  const today = store.state.meta.today;
  if (task.trashedAt) {
    openMenu({
      anchor,
      title: task.title,
      items: [
        { label: 'Open details', icon: 'note', shortcut: '↵', run: () => act.openTask(id) },
        { label: 'Restore', icon: 'restore', run: () => act.restoreTask(id) },
        ...(store.state.tasks.authority?.mode === 'online' ? [] : [{ type: 'separator' }, { label: 'Delete forever…', icon: 'trash', danger: true, run: () => act.deleteTaskForever(id) }]),
      ],
    });
    return;
  }
  const due = task.schedule?.dueDate || null;
  const completed = task.status === 'completed';
  openMenu({
    anchor,
    width: 268,
    title: task.title,
    items: [
      { type: 'chips', label: 'Due', options: [
        { label: 'Today', active: due === today, run: () => act.setTaskDue(id, today) },
        { label: 'Tomorrow', active: due === addDays(today, 1), run: () => act.setTaskDue(id, addDays(today, 1)) },
        { label: 'Next week', active: due === nextMonday(today), run: () => act.setTaskDue(id, nextMonday(today)) },
        { icon: 'calendar', title: 'Pick a date…', run: () => setTimeout(() => pickDate({ anchor, value: due, onPick: (date) => act.setTaskDue(id, date) }), 0) },
        { icon: 'x', title: 'No date', active: !due, run: () => act.setTaskDue(id, null) },
      ] },
      { type: 'chips', label: 'Priority', options: PRIORITY_ORDER.map((priority) => ({
        icon: 'flag', title: `${PRIORITY[priority]} priority`, active: task.priority === priority, className: `prio-${priority}`,
        run: () => act.setTaskPriority(id, priority),
      })) },
      { type: 'separator' },
      { label: completed ? 'Reopen' : 'Complete', icon: completed ? 'restore' : 'check', shortcut: 'Space', run: () => act.toggleTask(id) },
      { label: 'Open details', icon: 'note', shortcut: '↵', run: () => act.openTask(id) },
      { label: 'Add subtask', icon: 'subtask', shortcut: 'S', run: () => patchUi({ addingSubtaskTo: id }) },
      task.parentTaskId
        ? { label: 'Move to…', icon: 'move', hint: 'follows parent', disabled: true }
        : { label: 'Move to', icon: 'move', shortcut: 'M', submenu: (query) => projectItems({ value: task.projectId ?? null, onPick: (projectId) => act.moveTask(id, projectId), query }), search: { placeholder: 'Find a project…' }, width: 250 },
      { label: 'Tags', icon: 'tag', shortcut: 'T', hint: task.tags.length ? String(task.tags.length) : '', run: () => setTimeout(() => pickTags({ anchor, value: task.tags, onChange: (tags) => act.setTaskTags(id, tags) }), 0) },
      { type: 'separator' },
      { label: 'Start timer on this', icon: 'play', run: () => act.startTimer({ projectId: task.projectId, description: task.title }) },
      { label: 'Duplicate', icon: 'copy', shortcut: '⌘D', run: () => act.duplicateTask(id) },
      { label: `Ask ${agentName()} about this`, icon: 'sparkle', run: () => attachContext('task', id) },
      { type: 'separator' },
      { label: 'Move to Trash', icon: 'trash', shortcut: '⌫', danger: true, run: () => act.trashTask(id) },
    ],
  });
}

export function nextMonday(today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, ((1 - dow + 7) % 7) || 7);
}

export function projectMenu(id, anchor) {
  const project = lookup.project(id);
  if (!project) return;
  const pinned = store.state.workspace.pinned.some((pin) => pin.kind === 'project' && pin.id === id);
  openMenu({
    anchor,
    width: 248,
    title: project.name,
    items: [
      { label: 'Open project', icon: 'arrow-up-right', shortcut: '↵', run: () => act.openProject(id) },
      { label: 'Status', icon: 'layers', hint: PROJECT_STATUS[project.status].label, submenu: Object.entries(PROJECT_STATUS).map(([status, meta]) => ({
        label: meta.label, description: meta.hint, checked: project.status === status, run: () => act.setProjectStatus(id, status),
      })), width: 240 },
      { label: 'Start focus timer', icon: 'play', run: () => act.startTimer({ projectId: id, description: project.nextAction || `Focused work on ${project.name}` }) },
      { label: 'New task here', icon: 'plus', run: () => import('./ui/capture.js').then((module) => module.openCapture({ kind: 'task', projectId: id })) },
      { label: pinned ? 'Unpin from the masthead' : 'Pin to the masthead', icon: 'pin', run: () => act.togglePin('project', id) },
      { label: `Ask ${agentName()} about this`, icon: 'sparkle', run: () => attachContext('project', id) },
      { type: 'separator' },
      { label: 'Delete project…', icon: 'trash', danger: true, run: () => act.deleteProject(id) },
    ],
  });
}

export function bookMenu(id, anchor) {
  const book = lookup.book(id);
  if (!book) return;
  openMenu({
    anchor,
    width: 240,
    title: book.title,
    items: [
      { label: 'Open details', icon: 'note', shortcut: '↵', run: () => act.openBook(id) },
      { label: 'Move to', icon: 'layers', hint: READING_STATUS[book.status], submenu: Object.entries(READING_STATUS).map(([status, label]) => ({
        label, checked: book.status === status, run: () => act.setBookStatus(id, status),
      })) },
      { label: 'Tags', icon: 'tag', run: () => setTimeout(() => pickTags({
        anchor, value: book.tags, max: 24,
        known: [...new Set(store.state.reading.books.flatMap((item) => item.tags))],
        onChange: (tags) => import('./api.js').then(({ run }) => run('reading.setTags', { bookId: id, tags }, { quiet: true })),
      }), 0) },
      { label: `Ask ${agentName()} about this`, icon: 'sparkle', run: () => attachContext('book', id) },
      { type: 'separator' },
      { label: 'Remove from library…', icon: 'trash', danger: true, run: () => act.deleteBook(id) },
    ],
  });
}

export function ideaMenu(id, anchor) {
  const idea = lookup.idea(id);
  if (!idea) return;
  openMenu({
    anchor,
    width: 240,
    title: idea.title,
    items: [
      { label: 'Open', icon: 'pen', shortcut: '↵', run: () => act.openIdea(id) },
      { label: 'Status', icon: 'layers', hint: IDEA_STATUS[idea.status], submenu: Object.entries(IDEA_STATUS).map(([status, label]) => ({
        label, checked: idea.status === status, run: () => act.moveIdea(id, status),
      })) },
      { label: idea.date ? 'Change date' : 'Set date', icon: 'calendar', run: () => setTimeout(() => pickDate({
        anchor, value: idea.date,
        onPick: (date) => import('./api.js').then(({ run }) => run('creation.update', { ideaId: id, expectedUpdatedAt: idea.updatedAt, date })),
      }), 0) },
      { label: `Ask ${agentName()} about this`, icon: 'sparkle', run: () => attachContext('idea', id) },
      { type: 'separator' },
      { label: 'Delete idea…', icon: 'trash', danger: true, run: () => act.deleteIdea(id) },
    ],
  });
}

export function entryMenu(id, anchor, { onEdit } = {}) {
  openMenu({
    anchor,
    width: 200,
    items: [
      { label: 'Edit entry', icon: 'pen', run: () => onEdit?.(id) },
      { type: 'separator' },
      { label: 'Delete entry', icon: 'trash', danger: true, run: () => act.deleteEntry(id) },
    ],
  });
}

export function projectPickerForTask(id, anchor) {
  const task = lookup.task(id);
  if (!task || task.parentTaskId) return;
  pickProject({ anchor, value: task.projectId ?? null, onPick: (projectId) => act.moveTask(id, projectId) });
}

