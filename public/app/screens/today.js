import * as act from '../actions.js';
import { cx, html } from '../dom.js';
import { ACTIVITY_LABELS, addDays, daysBetween, elapsed, formatClock, formatDate, formatHours, formatMinutes, formatTime, plural } from '../format.js';
import { icon } from '../icons.js';
import { entryMenu, projectMenu } from '../menus.js';
import { lookup, render, store } from '../store.js';
import { groupTasks, taskScope } from '../task-model.js';
import { formDialog } from '../ui/dialog.js';
import { openCapture } from '../ui/capture.js';
import { pickFromList, pickProject } from '../ui/pickers.js';
import { renderQuickAdd, renderTaskGroups } from '../components/task-list.js';
import { renderCover } from './reading.js';

const DEEP = new Set(['deep_work', 'research', 'creative']);
const SHALLOW = new Set(['shallow_work', 'communication']);

function visibleRecommendation() {
  const recs = store.state.recommendations || [];
  if (!recs.length || store.ui.recDismissed) return null;
  return recs[(store.ui.recIndex || 0) % recs.length];
}

export function render_() {
  const state = store.state;
  const today = state.meta.today;
  const scope = taskScope('today', state);
  const groups = groupTasks(scope.items, { groupBy: 'due', sortBy: 'due' }, state);
  return html`<div class="screen today-screen scroll-y">
    <section class="front">
      ${renderLede()}
      ${renderTally()}
    </section>
    <div class="today-grid">
      <div class="today-main">
        <section class="card">
          <header class="card-head"><h2>Today’s tasks${scope.items.length ? html`<small>${scope.items.length}</small>` : ''}</h2><a class="link" href="/tasks?list=today">Open list ${icon('arrow-right', { size: 12 })}</a></header>
          ${renderQuickAdd({ id: 'today-add', placeholder: 'Add a task for today', defaults: { dueDate: today } })}
          ${scope.items.length ? renderTaskGroups(groups, { ...scope, id: 'today-home' }, { showProject: true }) : html`<p class="card-empty">Nothing due today.${scope.completed.length ? ` ${plural(scope.completed.length, 'task')} already crossed off.` : ''}${upcomingTaskCount() ? html` <span class="card-empty-hint">Pull something forward from <em>Coming up</em>, or add a task above.</span>` : ''}</p>`}
        </section>
        ${renderDayLog()}
      </div>
      <aside class="today-side">
        ${renderWeek()}
        ${renderAttention()}
        ${renderComingUp()}
        ${renderReadingNow()}
        ${renderChallenge()}
      </aside>
    </div>
  </div>`;
}

function upcomingTaskCount() {
  const state = store.state;
  const today = state.meta.today;
  const horizon = addDays(today, 7);
  return state.tasks.items.filter((task) => !task.trashedAt && task.status === 'open' && task.schedule?.dueDate > today && task.schedule.dueDate <= horizon).length;
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// The day so far, as a figure against the plan.
function renderTally() {
  const state = store.state;
  const planMinutes = Number(state.settings.defaultDailyPlanHours || 8) * 60;
  const logged = state.summary.todayMinutes;
  const entries = state.todayEntries;
  const deep = entries.filter((entry) => DEEP.has(entry.activityType)).reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const byType = {};
  for (const entry of entries) byType[entry.activityType] = (byType[entry.activityType] || 0) + entry.durationMinutes;
  const scale = Math.max(planMinutes, logged) || 1;
  const hours = Math.floor(logged / 60);
  const minutes = logged % 60;
  return html`<aside class="tally" title="${formatMinutes(logged)} of ${formatMinutes(planMinutes)} planned">
    <p class="eyebrow">${greeting()} · the day so far</p>
    <p class="tally-figure">${hours}<small>h</small> ${String(minutes).padStart(2, '0')}<small>m</small></p>
    <p class="tally-plan">of ${formatHours(planMinutes / 60)} planned${deep ? html` · <b>${formatMinutes(deep)}</b> deep` : ''}</p>
    <div class="tally-bar" role="img" aria-label="${Math.round((logged / (planMinutes || 1)) * 100)}% of plan">
      ${Object.entries(byType).map(([type, value]) => html`<i class="type-${type}" style="width:${(value / scale) * 100}%" title="${ACTIVITY_LABELS[type]} · ${formatMinutes(value)}"></i>`)}
      <span class="tally-goal" style="left:${(planMinutes / scale) * 100}%"></span>
    </div>
    <button type="button" class="button small" data-action="today-log">${icon('plus', { size: 13 })}Log time <kbd>L</kbd></button>
  </aside>`;
}

// The lede: what to do now, set as the page's headline.
const UNITS = { m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' };
function inWords(label) {
  const match = String(label || '').match(/^(\d+)(mo|m|h|d|w|y) ago$/);
  if (!match) return label === 'never' ? null : label;
  const [, count, unit] = match;
  if (unit === 'd' && count === '1') return 'yesterday';
  return `${count} ${UNITS[unit]}${count === '1' ? '' : 's'} ago`;
}

function leadReasons(project) {
  if (!project) return [];
  const reasons = [];
  const touched = inWords(project.lastTouchedLabel);
  reasons.push(touched ? `last worked ${touched}` : 'not started yet');
  const days = project.dueInDays;
  if (days != null) reasons.push(days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days`);
  if (project.taskSummary?.open) reasons.push(plural(project.taskSummary.open, 'open task'));
  return reasons;
}

function emphasise(text, name) {
  const index = name ? text.indexOf(name) : -1;
  if (index < 0) return text;
  return html`${text.slice(0, index)}<em>${name}</em>${text.slice(index + name.length)}`;
}

function renderLede() {
  const state = store.state;
  const session = state.activeSession;
  if (session) {
    const project = session.projectId ? lookup.project(session.projectId) : null;
    const color = project ? state.domains[project.domain]?.color : 'var(--accent)';
    return html`<section class="lede is-running" style="--focus:${color}">
      <p class="lede-kicker"><span class="live"><i></i>Focus session</span><span>since ${formatClock(session.startedAt)}</span></p>
      <div class="lede-clock" data-elapsed-since="${session.startedAt}">${elapsed(session.startedAt)}</div>
      <div class="focus-what">
        <button type="button" class="focus-project" data-action="today-timer-project">${project ? html`<i class="dot" style="--dot:${color}"></i>${project.name}` : 'General work'} ${icon('chevron-down', { size: 12 })}</button>
        <input class="focus-desc" data-timer-description value="${session.description}" placeholder="What you are working on" aria-label="What you are working on" maxlength="500">
        <button type="button" class="chip" data-action="today-timer-type">${ACTIVITY_LABELS[session.activityType]}</button>
      </div>
      <div class="lede-actions">
        <button type="button" class="button is-primary" data-action="timer-stop">${icon('stop', { size: 13 })}Stop and log</button>
        <button type="button" class="button ghost" data-action="timer-discard">Discard</button>
      </div>
    </section>`;
  }
  const rec = visibleRecommendation();
  if (!rec) {
    return html`<section class="lede is-quiet">
      <p class="lede-kicker"><span>What now</span></p>
      <h1 class="lede-head">${store.ui.recDismissed ? html`Suggestions are resting. <em>Choose your own way in.</em>` : html`Nothing is pressing. <em>Choose where to begin.</em>`}</h1>
      <div class="lede-actions">
        <button type="button" class="button is-primary" data-action="today-start-blank">${icon('play', { size: 13 })}Start a focus timer</button>
        ${store.ui.recDismissed ? html`<button type="button" class="button ghost" data-action="today-rec-restore">Show suggestions</button>` : ''}
      </div>
    </section>`;
  }
  const project = lookup.project(rec.projectId);
  const domain = state.domains[rec.domain];
  const count = state.recommendations.length;
  const index = (store.ui.recIndex || 0) % count;
  return html`<section class="lede" style="--focus:${domain?.color || 'var(--accent)'}" data-key="lede-${rec.projectId}">
    <p class="lede-kicker">
      <a class="lede-project" href="/projects/${encodeURIComponent(rec.projectId)}"><i></i>${rec.projectName}</a>
      ${domain ? html`<span>${domain.label}</span>` : ''}
      <span class="grow"></span>
      <span title="Ranked by deadline, health and your weekly plan">What now · ${index + 1} of ${count}</span>
    </p>
    <h1 class="lede-head">${emphasise(rec.action, rec.projectName)}</h1>
    <p class="lede-why">
      ${project ? html`<span class="${cx('health-badge', `health-${project.health}`)}">${project.health}</span>` : ''}
      <span class="lede-reasons">${project ? leadReasons(project).join(' · ') : rec.reasonShort}</span>
      <span class="lede-fit" title="How strongly the rules favor this over the other ${count - 1}">${Math.round(rec.confidence * 100)}% fit</span>
    </p>
    <div class="lede-actions">
      <button type="button" class="button is-primary" data-action="today-rec-start">${icon('play', { size: 13 })}Start ${formatMinutes(rec.durationMinutes)} focus</button>
      <button type="button" class="button ghost" data-action="today-rec-next">${icon('refresh', { size: 13 })}Another</button>
      <button type="button" class="button ghost" data-action="today-rec-dismiss">Not now</button>
    </div>
  </section>`;
}

function renderDayLog() {
  const state = store.state;
  const entries = [...state.todayEntries].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  if (!entries.length) return '';
  const total = entries.reduce((sum, entry) => sum + entry.durationMinutes, 0) || 1;
  return html`<section class="card">
    <header class="card-head"><h2>The day’s ledger<small>${formatMinutes(total)}</small></h2><button type="button" class="button ghost small" data-action="today-log">${icon('plus', { size: 13 })}Log time</button></header>
    <ol class="entries">${entries.map((entry) => renderEntry(entry, total))}</ol>
  </section>`;
}

export function renderEntry(entry, total = 60) {
  const project = entry.projectId ? lookup.project(entry.projectId) : null;
  const color = project ? store.state.domains[project.domain]?.color : 'var(--ink-4)';
  return html`<li class="entry" data-key="entry-${entry.id}" data-entry="${entry.id}">
    <span class="entry-time">${entry.time ? formatTime(entry.time) : '—'}</span>
    <span class="entry-bar"><i style="--dot:${color}; width:${Math.max(6, Math.min(100, (entry.durationMinutes / Math.max(60, total)) * 100))}%"></i></span>
    <span class="entry-body">
      <span class="entry-desc">${entry.description}</span>
      <span class="entry-meta">${project ? html`<i class="dot" style="--dot:${color}"></i>${project.name}` : 'General'} · ${ACTIVITY_LABELS[entry.activityType]}</span>
    </span>
    <span class="entry-duration">${formatMinutes(entry.durationMinutes)}</span>
    <button type="button" class="row-more" data-action="entry-menu" aria-label="Entry actions">${icon('more', { size: 15 })}</button>
  </li>`;
}

function renderWeek() {
  const state = store.state;
  const today = state.meta.today;
  const days = state.weekByDay || [];
  const max = Math.max(1, ...days.map((day) => day.deep + day.shallow + day.admin));
  const planDay = Number(state.settings.defaultDailyPlanHours || 8);
  const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  return html`<section class="card side-card">
    <header class="card-head"><h3>This week</h3><span class="muted">${state.summary.currentWeekLabel}</span></header>
    <div class="week-bars">
      ${days.map((day, index) => {
        const date = addDays(weekStart, index);
        const total = day.deep + day.shallow + day.admin;
        const height = (value) => `${(value / Math.max(max, planDay)) * 100}%`;
        return html`<div class="${cx('week-day', date === today && 'is-today', date > today && 'is-future')}" title="${day.day}: ${formatHours(total)}">
          <div class="week-stack"><i class="seg-admin" style="height:${height(day.admin)}"></i><i class="seg-shallow" style="height:${height(day.shallow)}"></i><i class="seg-deep" style="height:${height(day.deep)}"></i></div>
          <span>${day.day[0]}</span>
        </div>`;
      })}
    </div>
    <div class="legend"><span><i class="seg-deep"></i>Deep</span><span><i class="seg-shallow"></i>Shallow</span><span><i class="seg-admin"></i>Admin</span></div>
  </section>`;
}

function renderAttention() {
  const state = store.state;
  const projects = state.projects.filter((project) => ['to_do', 'next_up', 'doing'].includes(project.status) && project.health !== 'healthy').slice(0, 5);
  if (!projects.length) return '';
  return html`<section class="card side-card">
    <header class="card-head"><h3>Needs attention</h3><a class="link" href="/projects">All ${icon('arrow-right', { size: 13 })}</a></header>
    <ul class="mini-list">${projects.map((project) => html`<li data-key="att-${project.id}">
      <a href="/projects/${encodeURIComponent(project.id)}" class="mini-main"><i class="health health-${project.health}"></i><span>${project.name}</span>
        <small>${project.dueInDays != null && project.dueInDays <= 7 ? (project.dueInDays < 0 ? `${-project.dueInDays}d overdue` : `due in ${project.dueInDays}d`) : `touched ${project.lastTouchedLabel}`}</small></a>
      <button type="button" class="icon-button tiny" data-action="today-start-project" data-id="${project.id}" title="Start a focus timer">${icon('play', { size: 12 })}</button>
    </li>`)}</ul>
  </section>`;
}

function renderComingUp() {
  const state = store.state;
  const today = state.meta.today;
  const horizon = addDays(today, 7);
  const items = [];
  for (const task of state.tasks.items) {
    const due = task.schedule?.dueDate;
    if (task.trashedAt || task.status !== 'open' || !due || due <= today || due > horizon) continue;
    items.push({ date: due, kind: 'task', label: task.title, id: task.id });
  }
  for (const project of state.projects) {
    if (project.deadline && project.deadline >= today && project.deadline <= addDays(today, 21) && !['done', 'dropped'].includes(project.status)) items.push({ date: project.deadline, kind: 'deadline', label: `${project.name} deadline`, id: project.id });
  }
  for (const idea of state.creation.ideas) {
    if (idea.date && idea.date > today && idea.date <= horizon && !['done', 'dropped'].includes(idea.status) && !idea.taskId) items.push({ date: idea.date, kind: 'idea', label: idea.title, id: idea.id });
  }
  if (!items.length) return '';
  items.sort((a, b) => a.date.localeCompare(b.date));
  return html`<section class="card side-card">
    <header class="card-head"><h3>Coming up</h3><a class="link" href="/tasks?list=next7">Upcoming ${icon('arrow-right', { size: 13 })}</a></header>
    <ul class="agenda">${items.slice(0, 8).map((item) => html`<li data-key="up-${item.kind}-${item.id}">
      <span class="agenda-date"><b>${daysBetween(today, item.date) === 1 ? 'Tmrw' : formatDate(item.date, { today }).replace(/ \d{4}$/, '')}</b></span>
      <button type="button" class="agenda-label kind-${item.kind}" data-action="today-open" data-kind="${item.kind}" data-id="${item.id}">${icon(item.kind === 'deadline' ? 'flag' : item.kind === 'idea' ? 'creation' : 'circle', { size: 12 })}${item.label}</button>
      ${item.kind === 'task' ? html`<button type="button" class="agenda-pull" data-action="today-pull" data-id="${item.id}" title="Move to today" aria-label="Do “${item.label}” today">Today</button>` : ''}
    </li>`)}</ul>
  </section>`;
}

function renderReadingNow() {
  const books = store.state.reading.books.filter((book) => book.status === 'reading');
  if (!books.length) return '';
  return html`<section class="card side-card">
    <header class="card-head"><h3>Reading now</h3><a class="link" href="/reading">Shelf ${icon('arrow-right', { size: 13 })}</a></header>
    <div class="reading-now">${books.slice(0, 3).map((book) => html`<button type="button" class="reading-now-item" data-action="today-open" data-kind="book" data-id="${book.id}">
      ${renderCover(book, 'tiny')}
      <span><b>${book.title}</b><small>${book.authors.join(', ')}</small></span></button>`)}</div>
  </section>`;
}

function renderChallenge() {
  const challenge = store.state.challenge;
  if (!challenge) return '';
  return html`<section class="card side-card">
    <header class="card-head"><h3>Challenge</h3><span class="muted">${challenge.daysLeft}d left</span></header>
    <p class="challenge-text">${challenge.text}</p>
    <div class="pips">${Array.from({ length: challenge.target }, (_, index) => html`<i class="${index < challenge.progress ? 'on' : ''}"></i>`)}<span>${challenge.progress}/${challenge.target}</span></div>
  </section>`;
}

export async function editEntry(id) {
  const entry = store.state.timeEntries.find((item) => item.id === id);
  if (!entry) return;
  const values = await formDialog({
    title: 'Edit time entry',
    submitLabel: 'Save entry',
    fields: [
      { name: 'description', label: 'What', value: entry.description, required: true, autofocus: true },
      { name: 'projectId', label: 'Project', type: 'select', value: entry.projectId || '', options: [{ value: '', label: 'General (no project)' }, ...store.state.projects.map((project) => ({ value: project.id, label: project.name }))] },
      { name: 'activityType', label: 'Activity', type: 'select', value: entry.activityType, options: Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label })) },
      { name: 'durationMinutes', label: 'Minutes', type: 'number', value: entry.durationMinutes, min: 1, max: 1440, required: true },
      { name: 'date', label: 'Date', type: 'date', value: entry.date, required: true },
      { name: 'time', label: 'Start time', type: 'time', value: entry.time || '' },
    ],
  });
  if (!values) return;
  act.updateEntry(id, {
    description: values.description,
    projectId: values.projectId || null,
    activityType: values.activityType,
    durationMinutes: Number(values.durationMinutes),
    date: values.date,
    time: values.time || null,
  });
}

let descriptionTimer = 0;
export function onTimerDescription(value) {
  clearTimeout(descriptionTimer);
  descriptionTimer = setTimeout(() => act.updateTimer({ description: value }), 700);
}

export const actions = {
  'today-rec-start': () => {
    const rec = visibleRecommendation();
    if (rec) act.startTimer({ projectId: rec.projectId, description: rec.action });
  },
  'today-rec-next': () => { store.ui.recIndex = (store.ui.recIndex || 0) + 1; render(); },
  'today-rec-dismiss': () => { store.ui.recDismissed = true; render(); },
  'today-rec-restore': () => { store.ui.recDismissed = false; render(); },
  'today-start-blank': () => openCapture({ kind: 'timer' }),
  'today-start-project': (el) => { const project = lookup.project(el.dataset.id); act.startTimer({ projectId: project.id, description: project.nextAction || `Focused work on ${project.name}` }); },
  'today-log': () => openCapture({ kind: 'log' }),
  'today-pull': (el) => act.setTaskDue(el.dataset.id, store.state.meta.today),
  'today-open': (el) => {
    const kind = el.dataset.kind;
    if (kind === 'deadline') act.openProject(el.dataset.id);
    else act.openRecord(kind, el.dataset.id);
  },
  'today-timer-project': (el) => pickProject({ anchor: el, value: store.state.activeSession?.projectId ?? null, title: 'Timer project', allowInbox: true, onPick: (projectId) => act.updateTimer({ projectId }) }),
  'today-timer-type': (el) => pickFromList({ anchor: el, title: 'Activity', value: store.state.activeSession?.activityType, options: Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label })), onPick: (activityType) => act.updateTimer({ activityType }) }),
  'entry-menu': (el) => entryMenu(el.closest('[data-entry]').dataset.entry, el, { onEdit: editEntry }),
  'project-menu': (el) => projectMenu(el.dataset.id, el),
};

export default { id: 'today', render: render_, actions, presence: () => ({ title: 'Today' }) };
