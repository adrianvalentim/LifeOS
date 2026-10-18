// The task list used on Tasks, Today and project pages: rows with inline
// property pills, keyboard navigation and multi-select, inline rename and
// subtask entry, and drag to reorder, nest, or drop onto a list or group.
import * as act from '../actions.js';
import { cx, html, raw } from '../dom.js';
import { dueTone, formatMinutes, formatTime, plural, relativeDay, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { taskMenu } from '../menus.js';
import { parseCapture } from '../nlp.js';
import { lookup, patchUi, render, store } from '../store.js';
import { childrenIndex, isCompleted, isOpen, isTrashed, visibleRows } from '../task-model.js';
import { beginDrag } from '../ui/dnd.js';
import { knownTags, pickDate, pickPriority, pickProject, pickTags } from '../ui/pickers.js';

const INDENT = 24;

export function renderTaskGroups(groups, scope, options = {}) {
  const state = store.state;
  const index = childrenIndex(state.tasks.items);
  const collapsed = store.prefs.tasks.collapsed || {};
  const context = { scope, index, collapsed, reorderable: options.reorderable, showProject: options.showProject ?? (scope.flat || ['all', 'completed', 'trash'].includes(scope.id) || scope.id.startsWith('view:')), compact: options.compact };
  if (!groups.some((group) => group.tasks.length) && !groups.some((group) => group.latent)) return '';
  return html`<div class="task-groups ${options.reorderable ? 'is-reorderable' : ''}" data-task-list="${scope.id}" role="tree" aria-label="${scope.label}" aria-multiselectable="true">
    ${groups.map((group) => (group.id === 'all'
      ? html`<div class="task-group is-single" data-key="group-all">${group.tasks.map((task) => renderNode(task, context))}</div>`
      : html`<section class="task-group ${group.latent ? 'is-latent' : ''} ${group.tone ? `tone-${group.tone}` : ''}" data-key="group-${group.id}" ${group.drop ? raw(`data-drop-group="${group.drop.kind}" data-drop-value="${group.drop.value ?? ''}"`) : ''}>
          <h3 class="task-group-head">${group.swatch ? html`<i class="dot" style="--dot:${group.swatch}"></i>` : ''}<span>${group.label}</span>${group.sub ? html`<small>${group.sub}</small>` : ''}<b>${group.latent ? '' : group.tasks.length}</b></h3>
          ${group.tasks.map((task) => renderNode(task, context))}
          ${group.latent ? html`<div class="task-drop-hint">Drop here</div>` : ''}
        </section>`))}
  </div>`;
}

function childFilter(scope) {
  return scope.lifecycle === 'trash' ? isTrashed : scope.lifecycle === 'completed' ? isCompleted : isOpen;
}

function renderNode(task, context) {
  const children = context.scope.flat ? [] : (context.index.get(task.id) || []).filter(childFilter(context.scope));
  const collapsed = Boolean(context.collapsed[task.id]);
  return html`${renderTaskRow(task, { ...context, hasChildren: children.length > 0, collapsed })}
    ${store.ui.addingSubtaskTo === task.id ? renderSubtaskInput(task, context) : ''}
    ${!collapsed ? children.map((child) => renderNode(child, context)) : ''}`;
}

export function renderTaskRow(task, context = {}) {
  const state = store.state;
  const today = state.meta.today;
  const completed = task.status === 'completed';
  const trashed = Boolean(task.trashedAt);
  const selected = store.ui.selection.has(task.id);
  const focused = store.ui.focusId === task.id;
  const open = store.ui.sheet?.kind === 'task' && store.ui.sheet.id === task.id;
  const depth = context.scope?.flat ? 0 : task.depth || 0;
  const project = task.projectId ? lookup.project(task.projectId) : null;
  const due = task.schedule?.dueDate;
  const tone = dueTone(due, today, completed);
  const editing = store.ui.editing?.kind === 'task' && store.ui.editing.id === task.id;
  const pending = store.ui.pending.has(task.id);
  const subtotal = trashed ? task.trashSubtreeTotal : task.subtreeTotal;
  return html`<div class="${cx('task-row', `prio-${task.priority}`, completed && 'is-completed', trashed && 'is-trashed', selected && 'is-selected', focused && 'is-focused', open && 'is-open', pending && 'is-pending')}"
      data-key="task-${task.id}" data-task="${task.id}" data-parent="${task.parentTaskId || ''}" data-depth="${depth}" style="--depth:${depth}" tabindex="${focused ? 0 : -1}"
      role="treeitem" aria-level="${depth + 1}" aria-selected="${selected ? 'true' : 'false'}" ${context.hasChildren ? raw(`aria-expanded="${context.collapsed ? 'false' : 'true'}"`) : ''}
      ${!trashed && !context.compactNoDrag ? raw('data-draggable="task"') : ''}>
    <span class="task-twisty">${context.hasChildren ? html`<button type="button" class="twisty" data-action="task-collapse" aria-label="${context.collapsed ? 'Expand' : 'Collapse'} subtasks">${icon(context.collapsed ? 'chevron-right' : 'chevron-down', { size: 13 })}</button>` : ''}</span>
    ${trashed
      ? html`<span class="task-check is-trash">${icon('trash', { size: 13 })}</span>`
      : html`<button type="button" class="task-check" data-action="task-toggle" role="checkbox" aria-checked="${completed ? 'true' : 'false'}" aria-label="${completed ? 'Reopen' : 'Complete'} ${task.title}">${icon('check', { size: 12 })}</button>`}
    <div class="task-body" data-action="task-open">
      ${editing
        ? html`<input class="task-rename" data-rename="${task.id}" value="${task.title}" maxlength="300" aria-label="Rename task" autocomplete="off">`
        : html`<span class="task-title">${task.title}</span>`}
      <span class="task-meta">
        ${task.priority !== 'none' && !completed ? html`<span class="meta-flag prio-${task.priority}" title="${task.priority} priority">${icon('flag', { size: 12 })}</span>` : ''}
        ${subtotal > 1 && !trashed ? html`<span class="meta-sub" title="Subtasks">${icon('subtask', { size: 12 })}${task.subtreeCompleted}/${task.subtreeTotal}</span>` : ''}
        ${task.notes ? html`<span class="meta-note" title="Has notes">${icon('note', { size: 12 })}</span>` : ''}
        ${task.tags.map((tag) => html`<a class="meta-tag" href="/tasks?list=tag:${encodeURIComponent(tag)}" data-no-drag>#${tag}</a>`)}
        ${context.showProject ? html`<span class="meta-project">${project ? html`<i class="dot" style="--dot:${state.domains[project.domain]?.color}"></i>${project.name}` : 'Inbox'}</span>` : ''}
        ${trashed ? html`<span class="meta-life">Deleted ${timeAgo(task.trashedAt)} · ${Math.max(0, 30 - Math.floor((Date.now() - new Date(task.trashedAt)) / 86400000))}d left</span>` : ''}
        ${completed && task.completedAt && context.scope?.lifecycle === 'completed' ? html`<span class="meta-life">Done ${timeAgo(task.completedAt)}</span>` : ''}
      </span>
    </div>
    <div class="task-trail">
      ${task.schedule?.durationMinutes ? html`<span class="pill pill-duration">${icon('timer', { size: 12 })}${formatMinutes(task.schedule.durationMinutes)}</span>` : ''}
      ${!trashed ? html`<button type="button" class="${cx('pill pill-due', tone, !due && 'is-empty')}" data-action="task-due" aria-label="${due ? `Due ${relativeDay(due, today)}` : 'Set due date'}">${icon('calendar', { size: 12 })}${due ? html`<span>${relativeDay(due, today)}${task.schedule.startTime ? ` · ${formatTime(task.schedule.startTime)}` : ''}</span>` : ''}</button>` : ''}
      ${trashed ? html`<button type="button" class="pill" data-action="task-restore">${icon('restore', { size: 12 })}<span>Restore</span></button>` : ''}
      <button type="button" class="row-more" data-action="task-menu" aria-label="Actions for ${task.title}" aria-haspopup="menu">${icon('more', { size: 15 })}</button>
    </div>
  </div>`;
}

function renderSubtaskInput(task, context) {
  const depth = context.scope?.flat ? 1 : (task.depth || 0) + 1;
  return html`<div class="task-row is-input" data-key="subtask-input-${task.id}" style="--depth:${depth}">
    <span class="task-twisty"></span><span class="task-check is-ghost">${icon('plus', { size: 12 })}</span>
    <input class="task-subtask-input" data-subtask-for="${task.id}" placeholder="Subtask of “${task.title}” — Enter to add, Esc to stop" maxlength="300" autocomplete="off" aria-label="New subtask">
  </div>`;
}

// ——— Quick add bar ———————————————————————————————————————————————————
export function renderQuickAdd({ id = 'quick-add', placeholder = 'Add a task', defaults = {} } = {}) {
  const text = store.ui.drafts[id] || '';
  const parsed = text ? parseCapture(text, { today: store.state.meta.today, projects: store.state.projects, mode: 'task' }) : null;
  const project = defaults.projectId ? lookup.project(defaults.projectId) : null;
  return html`<form class="quick-add" data-quick-add="${id}" data-defaults="${JSON.stringify(defaults)}" autocomplete="off">
    <span class="quick-add-icon">${icon('plus', { size: 15 })}</span>
    <input class="quick-add-input" name="title" value="${text}" placeholder="${placeholder}" maxlength="400" aria-label="${placeholder}" data-quick-input="${id}">
    <span class="quick-add-chips">
      ${parsed ? parsed.tokens.map((token) => html`<span class="cap-chip cap-${token.type}">${token.type === 'date' ? relativeDay(token.value, store.state.meta.today) : token.type === 'project' ? token.label : token.type === 'tag' ? `#${token.value}` : token.type === 'time' ? formatTime(token.value) : token.label}</span>`) : ''}
      ${!parsed && (project || defaults.dueDate) ? html`<span class="quick-add-context">${project ? project.name : ''}${project && defaults.dueDate ? ' · ' : ''}${defaults.dueDate ? 'due today' : ''}</span>` : ''}
    </span>
    <kbd class="quick-add-kbd">↵</kbd>
  </form>`;
}

export async function submitQuickAdd(form) {
  const id = form.dataset.quickAdd;
  const input = form.querySelector('.quick-add-input');
  const text = input.value.trim();
  if (!text) return;
  const defaults = JSON.parse(form.dataset.defaults || '{}');
  const parsed = parseCapture(text, { today: store.state.meta.today, projects: store.state.projects, mode: 'task' });
  if (!parsed.title) return;
  store.ui.drafts[id] = '';
  input.value = '';
  render();
  await act.createTask({
    title: parsed.title,
    projectId: parsed.projectId !== null ? parsed.projectId : defaults.projectId ?? null,
    dueDate: parsed.dueDate || defaults.dueDate || null,
    startTime: parsed.startTime,
    priority: parsed.priority || 'none',
    tags: [...new Set([...(defaults.tags || []), ...parsed.tags])],
    durationMinutes: parsed.durationMinutes,
  });
}

// ——— Interactions ————————————————————————————————————————————————————
export const taskActions = {
  'task-toggle': (el) => act.toggleTask(rowId(el)),
  'task-open': (el, event) => {
    const id = rowId(el);
    if (event.metaKey || event.ctrlKey) { toggleSelect(id); return; }
    if (event.shiftKey) { extendSelect(id); return; }
    if (store.ui.editing?.id === id) return;
    store.ui.focusId = id;
    store.ui.selection = new Set();
    act.openTask(id);
  },
  'task-menu': (el) => taskMenu(rowId(el), el),
  'task-due': (el) => {
    const task = lookup.task(rowId(el));
    pickDate({ anchor: el, value: task.schedule?.dueDate, time: task.schedule?.startTime, onPick: (date) => act.setTaskDue(task.id, date), onTime: (time) => act.updateTask(task.id, { startTime: time, ...(time && !task.schedule?.dueDate ? { dueDate: store.state.meta.today } : {}) }) });
  },
  'task-restore': (el) => act.restoreTask(rowId(el)),
  'task-collapse': (el) => {
    const id = rowId(el);
    const collapsed = { ...(store.prefs.tasks.collapsed || {}) };
    if (collapsed[id]) delete collapsed[id];
    else collapsed[id] = true;
    store.prefs.tasks.collapsed = collapsed;
    try { localStorage.setItem('lifeos.ui.v2', JSON.stringify(store.prefs)); } catch { /* optional */ }
    render();
  },
};

function rowId(el) {
  return el.closest('[data-task]')?.dataset.task;
}

function toggleSelect(id) {
  const selection = new Set(store.ui.selection);
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  store.ui.selection = selection;
  store.ui.focusId = id;
  store.ui.anchorId = id;
  render();
}

function extendSelect(id) {
  const rows = currentRows();
  const anchor = store.ui.anchorId || store.ui.focusId || id;
  const a = rows.indexOf(anchor);
  const b = rows.indexOf(id);
  if (a < 0 || b < 0) { toggleSelect(id); return; }
  store.ui.selection = new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1));
  store.ui.focusId = id;
  render();
}

export function currentRows() {
  return [...document.querySelectorAll('.main [data-task]:not(.is-input)')].map((row) => row.dataset.task)
    .filter((id, index, all) => all.indexOf(id) === index);
}

function focusRow(id) {
  store.ui.focusId = id;
  render();
  requestAnimationFrame(() => {
    const row = document.querySelector(`.main [data-task="${CSS.escape(id)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  });
}

export function focusFirstRow() {
  const rows = currentRows();
  if (rows.length) focusRow(store.ui.focusId && rows.includes(store.ui.focusId) ? store.ui.focusId : rows[0]);
}

// Keyboard handling for a focused task row. Returns true when handled.
export function handleTaskKey(event) {
  const row = event.target.closest?.('[data-task]');
  if (!row || event.target.closest('input, textarea')) return false;
  const id = row.dataset.task;
  const task = lookup.task(id);
  if (!task) return false;
  const rows = currentRows();
  const position = rows.indexOf(id);
  const key = event.key;
  const letter = key.length === 1 ? key.toLowerCase() : key; // ⇧J arrives as "J"
  const mod = event.metaKey || event.ctrlKey;
  const go = (delta) => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, position + delta))];
    if (!next) return;
    if (event.shiftKey) {
      store.ui.anchorId ||= id;
      const a = rows.indexOf(store.ui.anchorId);
      const b = rows.indexOf(next);
      store.ui.selection = new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    focusRow(next);
    if (store.ui.sheet?.kind === 'task') act.openTask(next);
  };
  if ((key === 'ArrowDown' || letter === 'j') && !event.altKey && !mod) { event.preventDefault(); go(1); return true; }
  if ((key === 'ArrowUp' || letter === 'k') && !event.altKey && !mod) { event.preventDefault(); go(-1); return true; }
  if (key === 'Enter') { event.preventDefault(); act.openTask(id); return true; }
  if (key === ' ' || key === 'Spacebar') { event.preventDefault(); if (store.ui.selection.size > 1) act.bulkTasks(store.ui.selection, task.status === 'completed' ? 'reopen' : 'complete'); else act.toggleTask(id); return true; }
  if (key === 'x') { event.preventDefault(); toggleSelect(id); return true; }
  if (key === 'Escape' && store.ui.selection.size) { event.preventDefault(); store.ui.selection = new Set(); render(); return true; }
  if (mod && key === 'a') { event.preventDefault(); store.ui.selection = new Set(rows); render(); return true; }
  if (task.trashedAt) {
    if (key === 'Backspace' || key === 'Delete') { event.preventDefault(); act.deleteTaskForever(id); return true; }
    return false;
  }
  const targets = store.ui.selection.size > 1 && store.ui.selection.has(id) ? [...store.ui.selection] : [id];
  if (key === 'd' && !mod) { event.preventDefault(); pickDate({ anchor: row.querySelector('.pill-due') || row, value: task.schedule?.dueDate, onPick: (date) => (targets.length > 1 ? act.bulkTasks(targets, 'due', date) : act.setTaskDue(id, date)) }); return true; }
  if (key === 'p' && !mod) { event.preventDefault(); pickPriority({ anchor: row, value: task.priority, onPick: (priority) => (targets.length > 1 ? act.bulkTasks(targets, 'priority', priority) : act.setTaskPriority(id, priority)) }); return true; }
  if (['1', '2', '3', '0'].includes(key) && !mod) {
    event.preventDefault();
    const priority = { 1: 'high', 2: 'medium', 3: 'low', 0: 'none' }[key];
    if (targets.length > 1) act.bulkTasks(targets, 'priority', priority); else act.setTaskPriority(id, priority);
    return true;
  }
  if (key === 'm' && !mod) { event.preventDefault(); pickProject({ anchor: row, value: task.projectId ?? null, onPick: (projectId) => (targets.length > 1 ? act.bulkTasks(targets, 'move', projectId) : act.moveTask(id, projectId)) }); return true; }
  if (key === '#' || (key === 't' && !mod && store.ui.focusId === id)) { event.preventDefault(); pickTags({ anchor: row, value: task.tags, onChange: (tags) => act.setTaskTags(id, tags) }); return true; }
  if (key === 's' && !mod) { event.preventDefault(); patchUi({ addingSubtaskTo: id }); requestAnimationFrame(() => document.querySelector(`[data-subtask-for="${CSS.escape(id)}"]`)?.focus()); return true; }
  if (key === 'F2' || (key === 'Enter' && event.altKey)) { event.preventDefault(); startRename(id); return true; }
  if ((key === 'Backspace' || key === 'Delete') && !mod) { event.preventDefault(); if (targets.length > 1) act.bulkTasks(targets, 'trash'); else { const next = rows[position + 1] || rows[position - 1]; act.trashTask(id); if (next) focusRow(next); } return true; }
  if (mod && key === 'd') { event.preventDefault(); act.duplicateTask(id); return true; }
  if ((key === 'F10' && event.shiftKey) || key === 'ContextMenu' || key === '.') { event.preventDefault(); taskMenu(id, row.querySelector('.row-more') || row); return true; }
  if (event.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) { event.preventDefault(); moveStep(task, key === 'ArrowUp' ? -1 : 1); return true; }
  if (key === 'Tab' && row.closest('.is-reorderable')) { event.preventDefault(); indentStep(task, event.shiftKey ? -1 : 1); return true; }
  if (key === 'ArrowRight' && !event.altKey) { const collapsed = store.prefs.tasks.collapsed || {}; if (collapsed[id]) { event.preventDefault(); taskActions['task-collapse'](row); return true; } }
  if (key === 'ArrowLeft' && !event.altKey) {
    const collapsed = store.prefs.tasks.collapsed || {};
    if (task.directSubtaskCount && !collapsed[id]) { event.preventDefault(); taskActions['task-collapse'](row); return true; }
    if (task.parentTaskId && rows.includes(task.parentTaskId)) { event.preventDefault(); focusRow(task.parentTaskId); return true; }
  }
  return false;
}

// Visible siblings in the current list, in display order (from the DOM, which
// already reflects the list's scope and order).
function visibleSiblings(row) {
  const list = row.closest('[data-task-list]');
  if (!list) return [];
  return [...list.querySelectorAll('[data-task]:not(.is-input)')].filter((node) => node.dataset.parent === row.dataset.parent);
}

function moveStep(task, delta) {
  const row = document.querySelector(`.main .is-reorderable [data-task="${CSS.escape(task.id)}"]`);
  if (!row) return;
  const siblings = visibleSiblings(row);
  const index = siblings.indexOf(row);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= siblings.length) return;
  const before = delta < 0 ? siblings[target].dataset.task : siblings[target + 1]?.dataset.task ?? null;
  void act.reorderTask(task.id, { beforeTaskId: before });
}

function indentStep(task, delta) {
  const row = document.querySelector(`.main .is-reorderable [data-task="${CSS.escape(task.id)}"]`);
  if (!row) return;
  if (delta > 0) {
    const siblings = visibleSiblings(row);
    const parent = siblings[siblings.indexOf(row) - 1];
    if (!parent) return;
    void act.reorderTask(task.id, { parentTaskId: parent.dataset.task, beforeTaskId: null });
    return;
  }
  if (!task.parentTaskId) return;
  const parentRow = document.querySelector(`.main .is-reorderable [data-task="${CSS.escape(task.parentTaskId)}"]`);
  const parentTask = lookup.task(task.parentTaskId);
  const grand = parentTask?.parentTaskId || null;
  let before = null;
  if (parentRow) {
    const parentSiblings = visibleSiblings(parentRow);
    before = parentSiblings[parentSiblings.indexOf(parentRow) + 1]?.dataset.task ?? null;
  }
  void act.reorderTask(task.id, { parentTaskId: grand, beforeTaskId: before });
}

export function startRename(id) {
  patchUi({ editing: { kind: 'task', id } });
  requestAnimationFrame(() => {
    const input = document.querySelector(`[data-rename="${CSS.escape(id)}"]`);
    input?.focus();
    input?.select();
  });
}

// Inputs inside task lists (rename, subtask entry, quick add).
export function handleTaskInputKey(event) {
  const rename = event.target.closest('[data-rename]');
  if (rename) {
    if (event.key === 'Enter') { event.preventDefault(); commitRename(rename); return true; }
    if (event.key === 'Escape') { event.preventDefault(); patchUi({ editing: null }); focusRow(rename.dataset.rename); return true; }
    return false;
  }
  const subtask = event.target.closest('[data-subtask-for]');
  if (subtask) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const title = subtask.value.trim();
      const parentTaskId = subtask.dataset.subtaskFor;
      if (!title) { patchUi({ addingSubtaskTo: null }); focusRow(parentTaskId); return true; }
      const parsed = parseCapture(title, { today: store.state.meta.today, projects: [], mode: 'task' });
      subtask.value = '';
      void act.createTask({ title: parsed.title || title, parentTaskId, dueDate: parsed.dueDate, priority: parsed.priority, tags: parsed.tags }, { quiet: true });
      return true;
    }
    if (event.key === 'Escape') { event.preventDefault(); const parent = subtask.dataset.subtaskFor; patchUi({ addingSubtaskTo: null }); focusRow(parent); return true; }
    return false;
  }
  const quick = event.target.closest('[data-quick-input]');
  if (quick && event.key === 'Escape') { quick.value = ''; store.ui.drafts[quick.dataset.quickInput] = ''; quick.blur(); render(); return true; }
  return false;
}

export function commitRename(input) {
  const id = input.dataset.rename;
  const title = input.value.trim();
  const task = lookup.task(id);
  patchUi({ editing: null });
  if (title && task && title !== task.title) void act.updateTask(id, { title });
  focusRow(id);
}

// ——— Drag and drop ——————————————————————————————————————————————————
export function startTaskDrag(event, row) {
  const id = row.dataset.task;
  const task = lookup.task(id);
  if (!task || task.trashedAt) return;
  const list = row.closest('[data-task-list]');
  const reorderable = Boolean(row.closest('.is-reorderable'));
  const startDepth = task.depth || 0;
  let indicator = null;
  let target = null;
  const clear = () => {
    document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
    indicator?.remove();
    indicator = null;
  };
  const subtree = new Set([id, ...descendantIds(id)]);
  beginDrag(event, {
    source: row,
    scroller: row.closest('.scroll-y'),
    onStart: () => document.body.classList.add('is-dragging-task'),
    onMove: ({ x, y, target: element, dx }) => {
      clear();
      target = null;
      const listTarget = element?.closest('[data-drop-list]');
      if (listTarget) {
        listTarget.classList.add('is-drop-target');
        target = { kind: 'list', value: listTarget.dataset.dropList };
        return;
      }
      const group = element?.closest('[data-drop-group]');
      if (group && (!reorderable || group.classList.contains('is-latent') || element.closest('.task-group-head') || element.closest('.task-drop-hint'))) {
        group.classList.add('is-drop-target');
        target = { kind: 'group', group: group.dataset.dropGroup, value: group.dataset.dropValue || null };
        return;
      }
      if (!reorderable || !list || !list.contains(element)) return;
      const rows = [...list.querySelectorAll('[data-task]:not(.is-input)')].filter((node) => !subtree.has(node.dataset.task));
      if (!rows.length) return;
      let insertAt = rows.length;
      for (let index = 0; index < rows.length; index += 1) {
        const rect = rows[index].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) { insertAt = index; break; }
      }
      const prev = rows[insertAt - 1];
      const next = rows[insertAt];
      const prevDepth = prev ? Number(prev.dataset.depth) : -1;
      const nextDepth = next ? Number(next.dataset.depth) : 0;
      const maxDepth = prev ? prevDepth + 1 : 0;
      const minDepth = next ? nextDepth : 0;
      const desired = Math.max(minDepth, Math.min(maxDepth, startDepth + Math.round(dx / INDENT)));
      let parentTaskId = null;
      if (desired > 0) {
        for (let index = insertAt - 1; index >= 0; index -= 1) {
          if (Number(rows[index].dataset.depth) === desired - 1) { parentTaskId = rows[index].dataset.task; break; }
        }
      }
      const beforeTaskId = next && Number(next.dataset.depth) === desired ? next.dataset.task : null;
      target = { kind: 'reorder', parentTaskId, beforeTaskId };
      indicator = document.createElement('div');
      indicator.className = 'drop-line';
      const listRect = list.getBoundingClientRect();
      const anchorRect = (next || prev).getBoundingClientRect();
      const top = next ? anchorRect.top : anchorRect.bottom;
      indicator.style.top = `${top - listRect.top + list.scrollTop - 1}px`;
      indicator.style.left = `${28 + desired * INDENT}px`;
      list.append(indicator);
    },
    onDrop: () => {
      clear();
      document.body.classList.remove('is-dragging-task');
      if (!target) return;
      applyTaskDrop(id, target);
    },
    onCancel: () => { clear(); document.body.classList.remove('is-dragging-task'); },
  });
}

function descendantIds(id) {
  const out = [];
  const queue = store.state.tasks.items.filter((task) => task.parentTaskId === id);
  while (queue.length) {
    const task = queue.shift();
    out.push(task.id);
    queue.push(...store.state.tasks.items.filter((child) => child.parentTaskId === task.id));
  }
  return out;
}

export function applyTaskDrop(id, target) {
  const today = store.state.meta.today;
  const ids = store.ui.selection.size > 1 && store.ui.selection.has(id) ? [...store.ui.selection] : [id];
  const bulk = ids.length > 1;
  if (target.kind === 'reorder') {
    const task = lookup.task(id);
    if ((task.parentTaskId || null) === (target.parentTaskId || null)) {
      const siblings = store.state.tasks.items.filter((item) => (item.parentTaskId || null) === (task.parentTaskId || null) && item.id !== id && !item.trashedAt).sort((a, b) => a.sortOrder - b.sortOrder);
      const index = target.beforeTaskId ? siblings.findIndex((item) => item.id === target.beforeTaskId) : siblings.length;
      const currentIndex = store.state.tasks.items.filter((item) => (item.parentTaskId || null) === (task.parentTaskId || null) && !item.trashedAt).sort((a, b) => a.sortOrder - b.sortOrder).findIndex((item) => item.id === id);
      if (index === currentIndex) return;
    }
    void act.reorderTask(id, { beforeTaskId: target.beforeTaskId, parentTaskId: target.parentTaskId });
    return;
  }
  const value = target.value;
  if (target.kind === 'list') {
    if (value === 'inbox') return bulk ? act.bulkTasks(ids, 'move', null) : act.moveTask(id, null);
    if (value.startsWith('project:')) return bulk ? act.bulkTasks(ids, 'move', value.slice(8)) : act.moveTask(id, value.slice(8));
    if (value === 'today') return bulk ? act.bulkTasks(ids, 'due', today) : act.setTaskDue(id, today);
    if (value === 'completed') return bulk ? act.bulkTasks(ids, 'complete') : act.toggleTask(id, true);
    if (value === 'trash') return bulk ? act.bulkTasks(ids, 'trash') : act.trashTask(id);
    if (value.startsWith('tag:')) return bulk ? act.bulkTasks(ids, 'addTag', value.slice(4)) : act.setTaskTags(id, [...new Set([...lookup.task(id).tags, value.slice(4)])]);
    return undefined;
  }
  if (target.kind === 'group') {
    if (target.group === 'priority') return bulk ? act.bulkTasks(ids, 'priority', value) : act.setTaskPriority(id, value);
    if (target.group === 'due') return bulk ? act.bulkTasks(ids, 'due', value || null) : act.setTaskDue(id, value || null);
    if (target.group === 'project') return bulk ? act.bulkTasks(ids, 'move', value || null) : act.moveTask(id, value || null);
    if (target.group === 'tag') return bulk ? act.bulkTasks(ids, 'addTag', value) : act.setTaskTags(id, [...new Set([...lookup.task(id).tags, value])]);
  }
  return undefined;
}

// ——— Bulk action bar ————————————————————————————————————————————————
export function renderBulkBar() {
  const count = store.ui.selection.size;
  if (count < 2) return '';
  return html`<div class="bulk-bar" role="toolbar" aria-label="${plural(count, 'selected task')}">
    <span class="bulk-count">${count} selected</span>
    <button type="button" class="bulk-button" data-action="bulk" data-bulk="complete">${icon('check', { size: 14 })}Complete</button>
    <button type="button" class="bulk-button" data-action="bulk" data-bulk="due">${icon('calendar', { size: 14 })}Date</button>
    <button type="button" class="bulk-button" data-action="bulk" data-bulk="priority">${icon('flag', { size: 14 })}Priority</button>
    <button type="button" class="bulk-button" data-action="bulk" data-bulk="move">${icon('move', { size: 14 })}Move</button>
    <button type="button" class="bulk-button" data-action="bulk" data-bulk="tag">${icon('hash', { size: 14 })}Tag</button>
    <button type="button" class="bulk-button is-danger" data-action="bulk" data-bulk="trash">${icon('trash', { size: 14 })}Trash</button>
    <button type="button" class="icon-button" data-action="bulk-clear" aria-label="Clear selection">${icon('x', { size: 14 })}</button>
  </div>`;
}

export const bulkActions = {
  bulk: (el) => {
    const ids = [...store.ui.selection];
    const kind = el.dataset.bulk;
    if (kind === 'complete') act.bulkTasks(ids, 'complete');
    if (kind === 'trash') act.bulkTasks(ids, 'trash');
    if (kind === 'due') pickDate({ anchor: el, value: null, onPick: (date) => act.bulkTasks(ids, 'due', date) });
    if (kind === 'priority') pickPriority({ anchor: el, value: null, onPick: (priority) => act.bulkTasks(ids, 'priority', priority) });
    if (kind === 'move') pickProject({ anchor: el, value: undefined, onPick: (projectId) => act.bulkTasks(ids, 'move', projectId) });
    if (kind === 'tag') pickTags({ anchor: el, value: [], known: knownTags().map((tag) => tag.label), title: 'Add tag', onChange: (tags) => { if (tags.length) act.bulkTasks(ids, 'addTag', tags.at(-1)); } });
  },
  'bulk-clear': () => { store.ui.selection = new Set(); render(); },
};

export function rowsFor(groups, scope) {
  return visibleRows(groups, scope, store.prefs.tasks.collapsed || {}, childrenIndex(store.state.tasks.items));
}

