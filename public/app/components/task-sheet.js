// Task details in a side sheet. Everything saves as you go: the title on
// Enter or blur, notes shortly after you pause, properties immediately.
import * as act from '../actions.js';
import { agentName, attachContext } from '../agent-context.js';
import { cx, html } from '../dom.js';
import { dueTone, formatDate, formatMinutes, formatTime, PRIORITY, relativeDay, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { taskMenu } from '../menus.js';
import { lookup, render, store } from '../store.js';
import { pickDate, pickFromList, pickPriority, pickProject, pickTags } from '../ui/pickers.js';
import { extractWebLinks } from '../../web-links.js';

const saveTimers = new Map();

export function renderTaskSheet(id) {
  const state = store.state;
  const task = lookup.task(id);
  if (!task) return html`<div class="sheet-empty">This task is no longer available.</div>`;
  const today = state.meta.today;
  const trashed = Boolean(task.trashedAt);
  const completed = task.status === 'completed';
  const project = task.projectId ? lookup.project(task.projectId) : null;
  const parent = task.parentTaskId ? lookup.task(task.parentTaskId) : null;
  const drafts = store.ui.drafts;
  const title = drafts[`task:${id}:title`] ?? task.title;
  const notes = drafts[`task:${id}:notes`] ?? task.notes;
  const due = task.schedule?.dueDate;
  const children = state.tasks.items.filter((item) => item.parentTaskId === id && !item.trashedAt);
  const links = extractWebLinks(notes);
  const disabled = trashed;
  return html`<div class="sheet-inner task-sheet" data-sheet-task="${id}">
    <header class="sheet-bar">
      <div class="sheet-crumbs">
        ${parent ? html`<button type="button" class="crumb" data-action="sheet-open-task" data-id="${parent.id}">${icon('subtask', { size: 13 })}${parent.title}</button>`
          : html`<span class="crumb">${project ? html`<i class="dot" style="--dot:${state.domains[project.domain]?.color}"></i>${project.name}` : html`${icon('inbox', { size: 13 })}Inbox`}</span>`}
        ${store.ui.pending.has(id) ? html`<span class="saving">Saving…</span>` : ''}
      </div>
      <div class="sheet-tools">
        <button type="button" class="icon-button" data-action="sheet-task-menu" aria-label="More actions">${icon('more', { size: 16 })}</button>
        <button type="button" class="icon-button" data-action="sheet-close" aria-label="Close (Esc)">${icon('x', { size: 16 })}</button>
      </div>
    </header>
    <div class="sheet-scroll scroll-y">
      <div class="sheet-title-row">
        ${trashed ? html`<span class="task-check is-trash big">${icon('trash', { size: 14 })}</span>`
          : html`<button type="button" class="${cx('task-check big', `prio-${task.priority}`)}" data-action="sheet-toggle" role="checkbox" aria-checked="${String(completed)}" aria-label="${completed ? 'Reopen' : 'Complete'}">${icon('check', { size: 14 })}</button>`}
        <textarea class="sheet-title ${completed ? 'is-completed' : ''}" data-task-field="title" data-task-id="${id}" rows="1" maxlength="300" aria-label="Task title" ${disabled ? 'disabled' : ''}>${title}</textarea>
      </div>
      ${trashed ? html`<div class="sheet-banner">${icon('trash', { size: 14 })}<span>In Trash since ${formatDate(task.trashedAt.slice(0, 10), { today })}. Restore it to edit.</span><button type="button" class="button small" data-action="sheet-restore">Restore</button></div>` : ''}
      <dl class="props">
        <div class="prop">
          <dt>${icon('projects', { size: 14 })}List</dt>
          <dd>${parent ? html`<span class="prop-static">${project?.name || 'Inbox'} <small>follows parent</small></span>`
            : html`<button type="button" class="prop-value" data-action="sheet-project" ${disabled ? 'disabled' : ''}>${project ? html`<i class="dot" style="--dot:${state.domains[project.domain]?.color}"></i>${project.name}` : 'Inbox'}</button>`}</dd>
        </div>
        <div class="prop">
          <dt>${icon('calendar', { size: 14 })}Due</dt>
          <dd><button type="button" class="${cx('prop-value', dueTone(due, today, completed), !due && 'is-empty')}" data-action="sheet-due" ${disabled ? 'disabled' : ''}>${due ? `${relativeDay(due, today)} · ${formatDate(due, { today })}${task.schedule.startTime ? ` · ${formatTime(task.schedule.startTime)}` : ''}` : 'Add a date'}</button></dd>
        </div>
        <div class="prop">
          <dt>${icon('timer', { size: 14 })}Estimate</dt>
          <dd><button type="button" class="${cx('prop-value', !task.schedule?.durationMinutes && 'is-empty')}" data-action="sheet-duration" ${disabled ? 'disabled' : ''}>${task.schedule?.durationMinutes ? formatMinutes(task.schedule.durationMinutes) : 'None'}</button></dd>
        </div>
        <div class="prop">
          <dt>${icon('flag', { size: 14 })}Priority</dt>
          <dd><button type="button" class="${cx('prop-value', `prio-text-${task.priority}`, task.priority === 'none' && 'is-empty')}" data-action="sheet-priority" ${disabled ? 'disabled' : ''}>${task.priority === 'none' ? 'None' : PRIORITY[task.priority]}</button></dd>
        </div>
        <div class="prop">
          <dt>${icon('hash', { size: 14 })}Tags</dt>
          <dd class="prop-tags">${task.tags.map((tag) => html`<span class="tag-chip">#${tag}${disabled ? '' : html`<button type="button" data-action="sheet-untag" data-tag="${tag}" aria-label="Remove ${tag}">${icon('x', { size: 10 })}</button>`}</span>`)}
            ${disabled ? '' : html`<button type="button" class="prop-value is-empty" data-action="sheet-tags">${task.tags.length ? '+' : 'Add tags'}</button>`}</dd>
        </div>
      </dl>
      <section class="sheet-section">
        <h4>Notes</h4>
        <textarea class="sheet-notes" data-task-field="notes" data-task-id="${id}" placeholder="Add notes, links, context…" maxlength="20000" ${disabled ? 'disabled' : ''}>${notes}</textarea>
        ${links.length ? html`<div class="sheet-links">${links.map((link) => html`<a class="link-chip" href="${link.url}" target="_blank" rel="noopener noreferrer" data-task-link="${id}">${icon('external', { size: 12 })}${link.label}</a>`)}</div>` : ''}
      </section>
      <section class="sheet-section">
        <h4>Subtasks ${children.length ? html`<small>${children.filter((child) => child.status === 'completed').length}/${children.length}</small>` : ''}</h4>
        <div class="sheet-subtasks">
          ${children.sort((a, b) => (a.status === 'completed') - (b.status === 'completed') || a.sortOrder - b.sortOrder).map((child) => html`
            <div class="subtask ${child.status === 'completed' ? 'is-completed' : ''}" data-key="sub-${child.id}" data-task="${child.id}">
              <button type="button" class="task-check small" data-action="task-toggle" role="checkbox" aria-checked="${String(child.status === 'completed')}" aria-label="Complete ${child.title}">${icon('check', { size: 10 })}</button>
              <button type="button" class="subtask-title" data-action="sheet-open-task" data-id="${child.id}">${child.title}</button>
              ${child.schedule?.dueDate ? html`<span class="pill pill-due ${dueTone(child.schedule.dueDate, today, child.status === 'completed')}">${relativeDay(child.schedule.dueDate, today)}</span>` : ''}
            </div>`)}
          ${disabled ? '' : html`<div class="subtask is-new">${icon('plus', { size: 13 })}<input class="subtask-input" data-subtask-for="${id}" data-sheet-subtask placeholder="Add a subtask" maxlength="300" autocomplete="off"></div>`}
        </div>
      </section>
      <footer class="sheet-meta">
        <span>Created ${timeAgo(task.createdAt)}</span>${task.updatedAt !== task.createdAt ? html`<span>Edited ${timeAgo(task.updatedAt)}</span>` : ''}${task.completedAt ? html`<span>Completed ${timeAgo(task.completedAt)}</span>` : ''}
      </footer>
    </div>
    ${trashed ? '' : html`<footer class="sheet-actions">
      <button type="button" class="button ghost" data-action="sheet-timer">${icon('play', { size: 14 })}Start timer</button>
      <button type="button" class="button ghost" data-action="sheet-codex">${icon('sparkle', { size: 14 })}Ask ${agentName()}</button>
      <span class="grow"></span>
      <button type="button" class="icon-button" data-action="sheet-trash" aria-label="Move to Trash" title="Move to Trash (⌫)">${icon('trash', { size: 15 })}</button>
    </footer>`}
  </div>`;
}

const sheetId = () => store.ui.sheet?.id;

export const taskSheetActions = {
  'sheet-close': () => { flushTaskDrafts(); act.closeSheet(); },
  'sheet-open-task': (el) => { flushTaskDrafts(); act.openTask(el.dataset.id); },
  'sheet-toggle': () => act.toggleTask(sheetId()),
  'sheet-restore': () => act.restoreTask(sheetId()),
  'sheet-trash': () => act.trashTask(sheetId()),
  'sheet-timer': () => { const task = lookup.task(sheetId()); act.startTimer({ projectId: task.projectId, description: task.title }); },
  'sheet-codex': () => attachContext('task', sheetId()),
  'sheet-task-menu': (el) => taskMenu(sheetId(), el),
  'sheet-project': (el) => { const task = lookup.task(sheetId()); pickProject({ anchor: el, value: task.projectId ?? null, onPick: (projectId) => act.moveTask(task.id, projectId) }); },
  'sheet-due': (el) => {
    const task = lookup.task(sheetId());
    pickDate({ anchor: el, value: task.schedule?.dueDate, time: task.schedule?.startTime, onPick: (date) => act.setTaskDue(task.id, date), onTime: (time) => act.updateTask(task.id, { startTime: time, ...(time && !task.schedule?.dueDate ? { dueDate: store.state.meta.today } : {}) }) });
  },
  'sheet-duration': (el) => {
    const task = lookup.task(sheetId());
    pickFromList({ anchor: el, title: 'Estimate', value: task.schedule?.durationMinutes ?? null, options: [{ value: null, label: 'None' }, ...[15, 30, 45, 60, 90, 120, 180, 240, 480].map((minutes) => ({ value: minutes, label: formatMinutes(minutes) }))], onPick: (durationMinutes) => act.updateTask(task.id, { durationMinutes }) });
  },
  'sheet-priority': (el) => { const task = lookup.task(sheetId()); pickPriority({ anchor: el, value: task.priority, onPick: (priority) => act.setTaskPriority(task.id, priority) }); },
  'sheet-tags': (el) => { const task = lookup.task(sheetId()); pickTags({ anchor: el, value: task.tags, onChange: (tags) => act.setTaskTags(task.id, tags) }); },
  'sheet-untag': (el) => { const task = lookup.task(sheetId()); act.setTaskTags(task.id, task.tags.filter((tag) => tag !== el.dataset.tag)); },
};

export function onTaskFieldInput(element) {
  const id = element.dataset.taskId;
  const field = element.dataset.taskField;
  store.ui.drafts[`task:${id}:${field}`] = element.value;
  if (field === 'title') autosize(element);
  clearTimeout(saveTimers.get(`${id}:${field}`));
  if (field === 'notes') saveTimers.set(`${id}:${field}`, setTimeout(() => flushField(id, field), 800));
}

export function onTaskFieldKey(event) {
  const element = event.target.closest('[data-task-field]');
  if (!element) return false;
  if (element.dataset.taskField === 'title' && event.key === 'Enter') {
    event.preventDefault();
    flushField(element.dataset.taskId, 'title');
    element.blur();
    return true;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    flushTaskDrafts();
    act.closeSheet();
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    flushTaskDrafts();
    element.blur();
    return true;
  }
  return false;
}

export function flushField(id, field) {
  clearTimeout(saveTimers.get(`${id}:${field}`));
  const key = `task:${id}:${field}`;
  const value = store.ui.drafts[key];
  if (value === undefined) return;
  const task = lookup.task(id);
  delete store.ui.drafts[key];
  if (!task || task.trashedAt) return;
  if (field === 'title') {
    const title = value.replace(/\s+/g, ' ').trim();
    if (!title || title === task.title) { render(); return; }
    void act.updateTask(id, { title }, { quiet: true });
  } else if (value !== task.notes) {
    void act.updateTask(id, { notes: value }, { quiet: true });
  }
}

export function flushTaskDrafts() {
  for (const key of Object.keys(store.ui.drafts)) {
    const match = key.match(/^task:(.+):(title|notes)$/);
    if (match) flushField(match[1], match[2]);
  }
}

export function autosize(element) {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

export function mountTaskSheet() {
  document.querySelectorAll('.sheet-title').forEach(autosize);
  const focus = store.ui.sheet?.focus;
  if (focus) {
    store.ui.sheet.focus = null;
    requestAnimationFrame(() => {
      const target = focus === 'notes' ? document.querySelector('.sheet-notes') : document.querySelector('.sheet-title');
      target?.focus();
    });
  }
}

