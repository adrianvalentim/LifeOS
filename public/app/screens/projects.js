import * as act from '../actions.js';
import { agentName, attachContext } from '../agent-context.js';
import { run } from '../api.js';
import { cx, html, raw } from '../dom.js';
import { ACTIVITY_LABELS, formatDate, formatHours, formatMinutes, percent, plural, PROJECT_STATUS, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { projectMenu } from '../menus.js';
import { setParams } from '../router.js';
import { lookup, render, setPref, store } from '../store.js';
import { canReorder, groupTasks, taskScope } from '../task-model.js';
import { beginDrag } from '../ui/dnd.js';
import { openMenu } from '../ui/menu.js';
import { pickDate, pickFromList, pickTags } from '../ui/pickers.js';
import { openCapture } from '../ui/capture.js';
import { renderQuickAdd, renderTaskGroups } from '../components/task-list.js';
import { editEntry } from './today.js';

const ORDER = ['doing', 'next_up', 'to_do', 'paused', 'done', 'dropped'];
const ACTIVE = new Set(['to_do', 'next_up', 'doing']);
const FOCUS = {
  all: { label: 'All', statuses: ORDER },
  active: { label: 'Active', statuses: ['doing', 'next_up', 'to_do'] },
  doing: { label: 'Doing', statuses: ['doing'] },
  next: { label: 'Next up', statuses: ['next_up', 'doing'] },
  paused: { label: 'Paused', statuses: ['paused'] },
  closed: { label: 'Done & dropped', statuses: ['done', 'dropped'] },
};
const SORT = {
  health: { label: 'Health', compare: (a, b) => ['critical', 'attention', 'healthy'].indexOf(a.health) - ['critical', 'attention', 'healthy'].indexOf(b.health) || b.priority - a.priority || a.name.localeCompare(b.name) },
  priority: { label: 'Priority', compare: (a, b) => b.priority - a.priority || a.name.localeCompare(b.name) },
  deadline: { label: 'Deadline', compare: (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.name.localeCompare(b.name) },
  touched: { label: 'Recently touched', compare: (a, b) => (a.daysSinceTouched ?? 99) - (b.daysSinceTouched ?? 99) },
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
};

export function render_() {
  if (store.ui.route.id) return renderProjectPage(store.ui.route.id);
  const state = store.state;
  const params = store.ui.route.params;
  const view = params.get('view') === 'board' ? 'board' : params.get('view') === 'list' ? 'list' : store.prefs.projects.view;
  const focus = FOCUS[params.get('focus')] ? params.get('focus') : store.prefs.projects.focus || 'all';
  const sort = SORT[store.prefs.projects.sort] ? store.prefs.projects.sort : 'health';
  const counts = Object.fromEntries(ORDER.map((status) => [status, state.projects.filter((project) => project.status === status).length]));
  const active = state.projects.filter((project) => ACTIVE.has(project.status));
  const critical = active.filter((project) => project.health === 'critical').length;
  return html`<div class="screen projects-screen scroll-y">
    <header class="page-head wide">
      <div class="page-title">
        <div>
          <h1 class="display-sm">Projects</h1>
          <p>${plural(active.length, 'active project')}${critical ? html` · <span class="critical-text">${critical} critical</span>` : ''}${counts.paused ? ` · ${counts.paused} paused` : ''}</p>
        </div>
      </div>
      <div class="page-tools">
        <div class="segmented" role="group" aria-label="Focus">${Object.entries(FOCUS).map(([id, item]) => html`<button type="button" class="${focus === id ? 'is-active' : ''}" data-action="projects-focus" data-focus="${id}" aria-pressed="${String(focus === id)}">${item.label}</button>`)}</div>
        <button type="button" class="button ghost small" data-action="projects-sort">${icon('sort', { size: 14 })}${SORT[sort].label}</button>
        <div class="segmented icons" role="group" aria-label="Layout">
          <button type="button" class="${view === 'list' ? 'is-active' : ''}" data-action="projects-view" data-view="list" aria-label="List" title="List">${icon('list', { size: 15 })}</button>
          <button type="button" class="${view === 'board' ? 'is-active' : ''}" data-action="projects-view" data-view="board" aria-label="Board" title="Board">${icon('board', { size: 15 })}</button>
        </div>
        <button type="button" class="button is-primary small" data-action="projects-new">${icon('plus', { size: 14 })}New project</button>
      </div>
    </header>
    ${view === 'board' ? renderBoard(focus, sort) : renderList(focus, sort)}
  </div>`;
}

function renderList(focus, sort) {
  const state = store.state;
  const statuses = FOCUS[focus].statuses;
  const collapsed = store.prefs.projects.collapsedGroups || {};
  return html`<div class="project-groups" data-project-groups>
    ${ORDER.map((status) => {
      const projects = state.projects.filter((project) => project.status === status).sort(SORT[sort].compare);
      const shown = statuses.includes(status);
      if (!shown || !projects.length) {
        return html`<section class="${cx('project-group is-latent', !projects.length && 'is-empty')}" data-key="pg-${status}" data-drop-status="${status}"><h2 class="group-head"><span>${PROJECT_STATUS[status].label}</span><small>${projects.length && !shown ? `${projects.length} hidden by focus` : 'Drop here'}</small></h2></section>`;
      }
      const isCollapsed = collapsed[status];
      return html`<section class="project-group status-${status}" data-key="pg-${status}" data-drop-status="${status}">
        <h2 class="group-head"><button type="button" class="group-toggle" data-action="projects-collapse" data-status="${status}" aria-expanded="${String(!isCollapsed)}">${icon(isCollapsed ? 'chevron-right' : 'chevron-down', { size: 14 })}<span>${PROJECT_STATUS[status].label}</span><b>${projects.length}</b><small>${PROJECT_STATUS[status].hint}</small></button></h2>
        ${isCollapsed ? '' : html`<div class="project-cards">${projects.map((project) => renderProjectCard(project))}</div>`}
      </section>`;
    })}
  </div>`;
}

function renderBoard(focus, sort) {
  const state = store.state;
  const statuses = focus === 'all' ? ['next_up', 'doing', 'done'] : FOCUS[focus].statuses;
  return html`<div class="project-board" style="--columns:${statuses.length}">
    ${statuses.map((status) => {
      const projects = state.projects.filter((project) => project.status === status).sort(SORT[sort].compare);
      return html`<section class="board-column status-${status}" data-key="col-${status}" data-drop-status="${status}">
        <header class="board-head"><span>${PROJECT_STATUS[status].label}</span><b>${projects.length}</b></header>
        <div class="board-cards">${projects.map((project) => renderProjectCard(project, { compact: true }))}${projects.length ? '' : html`<p class="board-empty">Drag a project here</p>`}</div>
      </section>`;
    })}
  </div>
  ${focus === 'all' ? html`<p class="list-foot">The board shows Next up, Doing and Done. Choose a focus above to see other statuses.</p>` : ''}`;
}

function sparkline(values, { width = 88, height = 22 } = {}) {
  const max = Math.max(0.5, ...values);
  const step = width / Math.max(1, values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`).join(' ');
  return raw(`<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${((values.length - 1) * step).toFixed(1)}" cy="${(height - 2 - (values.at(-1) / max) * (height - 4)).toFixed(1)}" r="2" fill="currentColor"/></svg>`);
}

function dueLabel(project) {
  if (project.dueInDays == null) return null;
  if (project.dueInDays < 0) return { text: `${-project.dueInDays}d overdue`, tone: 'overdue' };
  if (project.dueInDays === 0) return { text: 'due today', tone: 'overdue' };
  return { text: `due in ${project.dueInDays}d`, tone: project.dueInDays <= 3 ? 'soon' : '' };
}

export function renderProjectCard(project, { compact = false } = {}) {
  const state = store.state;
  const domain = state.domains[project.domain];
  const due = dueLabel(project);
  const plan = Number(project.plannedHours || 0);
  const weekRatio = plan ? Math.min(1, project.weekHours / plan) : 0;
  const tasks = project.taskSummary || { open: 0, total: 0, completed: 0 };
  const pending = store.ui.pending.has(project.id);
  return html`<article class="${cx('project-card', `health-${project.health}`, compact && 'is-compact', pending && 'is-pending')}" data-key="project-${project.id}" data-project="${project.id}" data-draggable="project" style="--domain:${domain?.color || 'var(--ink-3)'}" tabindex="0" aria-label="${project.name}, ${PROJECT_STATUS[project.status].label}, ${project.health}">
    <header class="pc-head">
      <span class="pc-domain">${domain?.label || domain?.short || ''}</span>
      ${ACTIVE.has(project.status) ? html`<span class="health-badge health-${project.health}">${project.health}</span>` : ''}
      <button type="button" class="row-more" data-action="project-menu" aria-label="Actions for ${project.name}">${icon('more', { size: 15 })}</button>
    </header>
    <a class="pc-name" href="/projects/${encodeURIComponent(project.id)}">${project.name}</a>
    ${project.subtitle ? html`<p class="pc-sub">${project.subtitle}</p>` : ''}
    ${!compact && (project.nextAction || project.note) ? html`<p class="pc-note">${project.nextAction ? html`${icon('arrow-right', { size: 12 })}${project.nextAction}` : project.note}</p>` : ''}
    <div class="pc-stats">
      ${plan ? html`<span class="pc-week" title="This week: ${formatHours(project.weekHours)} of ${formatHours(plan)} planned"><small>Week</small><span class="mini-meter"><i style="width:${weekRatio * 100}%"></i></span>${project.weekHours ? formatHours(project.weekHours) : '0h'}<small>/ ${formatHours(plan)}</small></span>` : project.weekHours ? html`<span><small>Week</small>${formatHours(project.weekHours)}</span>` : ''}
      ${tasks.total ? html`<span title="Tasks done of total"><small>Tasks</small>${tasks.completed}/${tasks.total}</span>` : ''}
      ${due ? html`<span class="pc-due ${due.tone}">${due.text}</span>` : ''}
      ${project.streak ? html`<span title="Days in a row with 30+ minutes"><small>Streak</small>${project.streak}d</span>` : ''}
      ${!compact ? html`<span class="pc-touch" title="Last worked on"><small>Last</small>${project.lastTouchedLabel === 'never' ? 'not started' : project.lastTouchedLabel}</span>` : ''}
    </div>
    <footer class="pc-foot">
      ${project.progress != null ? html`<span class="progress" title="${percent(project.progress)} complete"><i style="width:${project.progress * 100}%"></i></span><b>${percent(project.progress)}</b>` : html`<span class="progress is-empty"></span>`}
      ${!compact && project.weekHistory?.some((value) => value > 0) ? sparkline(project.weekHistory) : ''}
    </footer>
  </article>`;
}

// ——— Project page ——————————————————————————————————————————————————————
function renderProjectPage(id) {
  const state = store.state;
  const project = lookup.project(id);
  if (!project) {
    return html`<div class="screen-empty">${icon('projects', { size: 22 })}<h2>Project not found</h2><p>It may have been deleted.</p><a class="button" href="/projects">Back to projects</a></div>`;
  }
  const domain = state.domains[project.domain];
  const drafts = store.ui.drafts;
  const field = (name) => drafts[`project:${id}:${name}`] ?? project[name] ?? '';
  const scope = taskScope(`project:${id}`, state);
  const listPrefs = store.prefs.tasks.lists?.[`project:${id}`] || {};
  const groupBy = listPrefs.groupBy || 'none';
  const sortBy = listPrefs.sortBy || 'manual';
  const groups = groupTasks(scope.items, { groupBy, sortBy }, state);
  const reorderable = canReorder(scope, groupBy, sortBy);
  const entries = state.timeEntries.filter((entry) => entry.projectId === id).sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`));
  const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
  const completed = state.tasks.items.filter((task) => task.projectId === id && !task.trashedAt && task.status === 'completed' && !task.parentTaskId);
  const milestones = (state.milestones || []).filter((milestone) => milestone.projectId === id || milestone.text.toLowerCase().startsWith(`${project.name.toLowerCase()}:`));
  const pinned = state.workspace.pinned.some((pin) => pin.kind === 'project' && pin.id === id);
  const due = dueLabel(project);
  const running = state.activeSession?.projectId === id;
  return html`<div class="screen project-page scroll-y" style="--domain:${domain?.color}">
    <div class="project-hero">
      <nav class="crumbs"><a href="/projects">${icon('chevron-left', { size: 14 })}Projects</a></nav>
      <div class="hero-row">
        <div class="hero-main">
          <button type="button" class="domain-chip" data-action="project-domain">${domain?.label || 'Domain'}</button>
          <input class="hero-title" data-project-field="name" data-project-id="${id}" value="${field('name')}" aria-label="Project name" maxlength="120">
          <input class="hero-sub" data-project-field="subtitle" data-project-id="${id}" value="${field('subtitle')}" placeholder="Add a subtitle" aria-label="Subtitle" maxlength="160">
        </div>
        <div class="hero-actions">
          <button type="button" class="status-pill status-${project.status}" data-action="project-status">${PROJECT_STATUS[project.status].label}${icon('chevron-down', { size: 13 })}</button>
          ${running ? html`<button type="button" class="button is-primary" data-action="timer-stop">${icon('stop', { size: 14 })}Stop timer</button>`
            : html`<button type="button" class="button is-primary" data-action="project-start">${icon('play', { size: 14 })}Focus</button>`}
          <button type="button" class="icon-button" data-action="project-codex" title="Ask ${agentName()} about this project">${icon('sparkle', { size: 16 })}</button>
          <button type="button" class="icon-button ${pinned ? 'is-on' : ''}" data-action="project-pin" title="${pinned ? 'Unpin' : 'Pin to the masthead'}">${icon('pin', { size: 16 })}</button>
          <button type="button" class="icon-button" data-action="project-page-menu" aria-label="More">${icon('more', { size: 16 })}</button>
        </div>
      </div>
      <div class="hero-stats">
        ${ACTIVE.has(project.status) ? html`<span class="health-badge health-${project.health}">${project.health}</span>` : ''}
        <span>${icon('clock', { size: 13 })}${formatHours(project.weekHours)} this week${project.plannedHours ? ` of ${formatHours(project.plannedHours)}` : ''}</span>
        <span>${icon('activity', { size: 13 })}${formatMinutes(totalMinutes)} all time</span>
        ${due ? html`<span class="${due.tone}">${icon('flag', { size: 13 })}${due.text}</span>` : ''}
        ${project.streak ? html`<span>${icon('bolt', { size: 13 })}${project.streak}-day streak</span>` : ''}
        <span>Last worked ${project.lastTouchedLabel}</span>
      </div>
    </div>
    <div class="project-grid">
      <div class="project-main">
        <section class="card">
          <label class="next-action">${icon('arrow-right', { size: 15 })}<input data-project-field="nextAction" data-project-id="${id}" value="${field('nextAction')}" placeholder="What’s the next concrete action?" maxlength="300" aria-label="Next action"></label>
          <textarea class="project-note" data-project-field="note" data-project-id="${id}" placeholder="Notes about this project — status, decisions, context…" maxlength="4000" aria-label="Project note">${field('note')}</textarea>
        </section>
        <section class="card">
          <header class="card-head"><h2>Tasks <small>${scope.items.length ? `${project.taskSummary.open} open` : ''}</small></h2>
            <div class="card-tools"><button type="button" class="button ghost small" data-action="project-task-view">${icon('sliders', { size: 13 })}${groupBy !== 'none' ? `By ${groupBy}` : sortBy === 'manual' ? 'Custom order' : `By ${sortBy}`}</button><a class="link" href="/tasks?list=project:${encodeURIComponent(id)}">In Tasks ${icon('arrow-right', { size: 13 })}</a></div></header>
          ${renderQuickAdd({ id: `project:${id}`, placeholder: `Add a task to ${project.name}`, defaults: { projectId: id } })}
          ${scope.items.length ? renderTaskGroups(groups, scope, { reorderable, showProject: false }) : html`<p class="card-empty">No open tasks. Break the next step into something you can do in an hour.</p>`}
          ${completed.length ? html`<details class="completed-fold" data-keep-open><summary>${icon('chevron-right', { size: 13 })}<span>Completed</span><b>${completed.length}</b></summary>
            ${renderTaskGroups([{ id: 'all', tasks: completed }], { ...scope, id: `${scope.id}-done`, flat: true, lifecycle: 'completed' }, { showProject: false })}</details>` : ''}
        </section>
        <section class="card">
          <header class="card-head"><h2>Sessions <small>${entries.some((entry) => !entry.aggregation) ? `${entries.filter((entry) => !entry.aggregation).length} logged` : ''}</small></h2><button type="button" class="button ghost small" data-action="project-log">${icon('plus', { size: 13 })}Log time</button></header>
          ${entries.some((entry) => !entry.aggregation) ? html`<ol class="entries">${entries.filter((entry) => !entry.aggregation).slice(0, 12).map((entry) => renderEntryWithDate(entry))}</ol>` : html`<p class="card-empty">${icon('clock', { size: 16 })} No sessions logged yet. Start a focus session to begin a streak.</p>`}
            ${entries.some((entry) => entry.aggregation) ? html`<p class="list-foot">Imported weekly totals count toward statistics but are not listed here.</p>` : ''}
        </section>
      </div>
      <aside class="project-side">
        <section class="card side-card">
          <h3 class="side-title">Details</h3>
          <dl class="props">
            <div class="prop"><dt>Domain</dt><dd><button type="button" class="prop-value" data-action="project-domain"><i class="dot" style="--dot:${domain?.color}"></i>${domain?.label}</button></dd></div>
            <div class="prop"><dt>Categories</dt><dd class="prop-tags">${project.categoryLabels.map((label, index) => html`<span class="tag-chip">${label}<button type="button" data-action="project-uncategorize" data-category="${project.categoryIds[index]}" aria-label="Remove ${label}">${icon('x', { size: 10 })}</button></span>`)}<button type="button" class="prop-value is-empty" data-action="project-categories">${project.categoryIds.length ? '+' : 'Add'}</button></dd></div>
            <div class="prop"><dt>Priority</dt><dd><div class="dots-rating" role="radiogroup" aria-label="Priority">${[1, 2, 3, 4, 5].map((value) => html`<button type="button" class="${value <= project.priority ? 'is-on' : ''}" data-action="project-priority" data-value="${value}" role="radio" aria-checked="${String(value === project.priority)}" title="Priority ${value}"></button>`)}</div></dd></div>
            <div class="prop"><dt>Deadline</dt><dd><button type="button" class="prop-value ${project.deadline ? '' : 'is-empty'}" data-action="project-deadline">${project.deadline ? formatDate(project.deadline, { today: state.meta.today, year: 'auto' }) : 'None'}</button></dd></div>
            <div class="prop"><dt>Weekly plan</dt><dd class="stepper"><button type="button" data-action="project-plan" data-delta="-1" aria-label="One hour less">−</button><span>${formatHours(project.plannedHours || 0)}</span><button type="button" data-action="project-plan" data-delta="1" aria-label="One hour more">+</button></dd></div>
            <div class="prop"><dt>Progress</dt><dd class="progress-edit"><input type="range" min="0" max="100" step="5" value="${Math.round((project.progress ?? 0) * 100)}" data-project-progress="${id}" aria-label="Progress"><b>${project.progress == null ? '—' : percent(project.progress)}</b></dd></div>
          </dl>
        </section>
        <section class="card side-card">
          <h3 class="side-title">Last 8 weeks</h3>
          ${renderWeekBars(project.weekHistory || [], project.plannedHours)}
        </section>
        ${milestones.length ? html`<section class="card side-card"><h3 class="side-title">Milestones</h3><ul class="milestone-mini">${milestones.slice(0, 6).map((milestone) => html`<li><time>${formatDate(milestone.date, { today: state.meta.today })}</time><span>${milestone.text}</span></li>`)}</ul></section>` : ''}
        <p class="side-foot">Created ${timeAgo(project.createdAt)}${project.statusChangedAt ? ` · status changed ${timeAgo(project.statusChangedAt)}` : ''}</p>
      </aside>
    </div>
  </div>`;
}

function renderEntryWithDate(entry) {
  return html`<li class="entry has-date" data-key="entry-${entry.id}" data-entry="${entry.id}">
    <span class="entry-time">${formatDate(entry.date, { today: store.state.meta.today })}</span>
    <span class="entry-body"><span class="entry-desc">${entry.description}</span><span class="entry-meta">${ACTIVITY_LABELS[entry.activityType]}${entry.time ? ` · ${entry.time}` : ''}</span></span>
    <span class="entry-duration">${formatMinutes(entry.durationMinutes)}</span>
    <button type="button" class="row-more" data-action="entry-menu" aria-label="Entry actions">${icon('more', { size: 15 })}</button>
  </li>`;
}

function renderWeekBars(values, plan) {
  const max = Math.max(1, plan || 0, ...values);
  return html`<div class="week-history">${values.map((value, index) => html`<div class="wh-bar ${index === values.length - 1 ? 'is-current' : ''}" title="${index === values.length - 1 ? 'This week' : `${values.length - 1 - index} week${values.length - 1 - index === 1 ? '' : 's'} ago`}: ${formatHours(value)}"><i style="height:${(value / max) * 100}%"></i></div>`)}
    ${plan ? html`<span class="wh-plan" style="bottom:${(plan / max) * 100}%" title="Weekly plan ${formatHours(plan)}"></span>` : ''}</div>
    <div class="wh-axis"><span>8w ago</span><span>this week</span></div>`;
}

// ——— Field editing ——————————————————————————————————————————————————————
const timers = new Map();
export function onProjectFieldInput(element) {
  const id = element.dataset.projectId;
  const name = element.dataset.projectField;
  store.ui.drafts[`project:${id}:${name}`] = element.value;
  clearTimeout(timers.get(`${id}:${name}`));
  if (name === 'note') timers.set(`${id}:${name}`, setTimeout(() => flushProjectField(id, name), 900));
}

export function flushProjectField(id, name) {
  clearTimeout(timers.get(`${id}:${name}`));
  const key = `project:${id}:${name}`;
  const value = store.ui.drafts[key];
  if (value === undefined) return;
  delete store.ui.drafts[key];
  const project = lookup.project(id);
  if (!project) return;
  const clean = name === 'note' ? value : value.replace(/\s+/g, ' ').trim();
  if (name === 'name' && !clean) { render(); return; }
  if ((project[name] ?? '') === clean) { render(); return; }
  act.updateProject(id, { [name]: clean }, { quiet: name === 'note' });
}

export function flushProjectDrafts() {
  for (const key of Object.keys(store.ui.drafts)) {
    const match = key.match(/^project:(.+):(name|subtitle|nextAction|note)$/);
    if (match) flushProjectField(match[1], match[2]);
  }
}

// ——— Drag between statuses ————————————————————————————————————————————————
export function startProjectDrag(event, card) {
  const id = card.dataset.project;
  beginDrag(event, {
    source: card,
    onStart: () => document.body.classList.add('is-dragging-project'),
    onMove: ({ target }) => {
      document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      target?.closest('[data-drop-status]')?.classList.add('is-drop-target');
    },
    onDrop: ({ target }) => {
      document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      document.body.classList.remove('is-dragging-project');
      const status = target?.closest('[data-drop-status]')?.dataset.dropStatus;
      if (status && status !== lookup.project(id)?.status) act.setProjectStatus(id, status);
    },
    onCancel: () => {
      document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
      document.body.classList.remove('is-dragging-project');
    },
  });
}

const routeId = () => store.ui.route.id;

export const actions = {
  'projects-focus': (el) => { setPref('projects.focus', el.dataset.focus); setParams({ focus: el.dataset.focus === 'all' ? null : el.dataset.focus }); },
  'projects-view': (el) => { setPref('projects.view', el.dataset.view); setParams({ view: el.dataset.view }); },
  'projects-sort': (el) => openMenu({ anchor: el, width: 200, title: 'Sort projects', items: Object.entries(SORT).map(([id, item]) => ({ label: item.label, checked: (store.prefs.projects.sort || 'health') === id, run: () => setPref('projects.sort', id) })) }),
  'projects-collapse': (el) => setPref('projects.collapsedGroups', { ...(store.prefs.projects.collapsedGroups || {}), [el.dataset.status]: !store.prefs.projects.collapsedGroups?.[el.dataset.status] }),
  'projects-new': () => openCapture({ kind: 'project' }),
  'project-menu': (el) => projectMenu(el.closest('[data-project]').dataset.project, el),
  'project-page-menu': (el) => projectMenu(routeId(), el),
  'project-status': (el) => {
    const project = lookup.project(routeId());
    openMenu({ anchor: el, width: 250, title: 'Status', items: Object.entries(PROJECT_STATUS).map(([status, meta]) => ({ label: meta.label, description: meta.hint, checked: project.status === status, run: () => act.setProjectStatus(project.id, status) })) });
  },
  'project-start': () => { const project = lookup.project(routeId()); act.startTimer({ projectId: project.id, description: project.nextAction || `Focused work on ${project.name}` }); },
  'project-codex': () => attachContext('project', routeId()),
  'project-pin': () => act.togglePin('project', routeId()),
  'project-domain': (el) => {
    const project = lookup.project(routeId());
    pickFromList({ anchor: el, title: 'Domain', value: project.domain, options: Object.entries(store.state.domains).map(([value, domain]) => ({ value, label: domain.label, swatch: domain.color })), onPick: (domain) => act.updateProject(project.id, { domain }) });
  },
  'project-categories': (el) => {
    const project = lookup.project(routeId());
    const labels = Object.values(store.state.categories).map((category) => category.label);
    pickTags({ anchor: el, title: 'Categories', value: project.categoryLabels, known: labels, onChange: (categories) => act.updateProject(project.id, { categories }) });
  },
  'project-uncategorize': (el) => run('projects.removeCategory', { projectId: routeId(), categoryId: el.dataset.category }).catch(() => undefined),
  'project-priority': (el) => act.updateProject(routeId(), { priority: Number(el.dataset.value) }),
  'project-deadline': (el) => { const project = lookup.project(routeId()); pickDate({ anchor: el, value: project.deadline, title: 'Deadline', onPick: (deadline) => act.updateProject(project.id, { deadline }) }); },
  'project-plan': (el) => { const project = lookup.project(routeId()); act.updateProject(project.id, { plannedHours: Math.max(0, Math.min(168, Number(project.plannedHours || 0) + Number(el.dataset.delta))) }, { quiet: true }); },
  'project-log': () => openCapture({ kind: 'log', projectId: routeId() }),
  'project-task-view': (el) => {
    const key = `project:${routeId()}`;
    const current = store.prefs.tasks.lists?.[key] || {};
    const set = (patch) => setPref('tasks.lists', { ...(store.prefs.tasks.lists || {}), [key]: { ...current, ...patch } });
    openMenu({ anchor: el, width: 220, items: [
      { type: 'header', label: 'Group by' },
      ...[['none', 'None'], ['priority', 'Priority'], ['due', 'Due date'], ['tag', 'Tag']].map(([value, label]) => ({ label, checked: (current.groupBy || 'none') === value, run: () => set({ groupBy: value }) })),
      { type: 'separator' }, { type: 'header', label: 'Sort by' },
      ...[['manual', 'Custom order'], ['priority', 'Priority'], ['due', 'Due date'], ['title', 'Title'], ['created', 'Date created']].map(([value, label]) => ({ label, checked: (current.sortBy || 'manual') === value, run: () => set({ sortBy: value }) })),
    ] });
  },
  'entry-menu': (el) => import('../menus.js').then(({ entryMenu }) => entryMenu(el.closest('[data-entry]').dataset.entry, el, { onEdit: editEntry })),
};

export function onProgressChange(element) {
  act.updateProject(element.dataset.projectProgress, { progress: Number(element.value) / 100 }, { quiet: true });
}

export function presence() {
  const project = store.ui.route.id ? lookup.project(store.ui.route.id) : null;
  return project ? { title: project.name, selected: { kind: 'project', id: project.id, title: project.name } } : { title: 'Projects' };
}

export default { id: 'projects', render: render_, actions, presence };
