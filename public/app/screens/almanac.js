import { run } from '../api.js';
import { html } from '../dom.js';
import { ACTIVITY_LABELS, addDays, formatDate, formatMinutes, normalize } from '../format.js';
import { icon } from '../icons.js';
import { lookup, store } from '../store.js';
import { confirmDialog, formDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';

export function render_() {
  const state = store.state;
  const year = state.meta.today.slice(0, 4);
  const inYear = (iso) => iso && String(iso).slice(0, 4) === year;
  const tasksDone = state.tasks.items.filter((task) => task.status === 'completed' && !task.trashedAt && inYear(task.completedAt)).length;
  const booksDone = state.reading.books.filter((book) => book.status === 'finished' && inYear(book.finishedAt)).length;
  const projectsDone = state.projects.filter((project) => project.status === 'done' && inYear(project.lastTouched || project.createdAt)).length;
  const yearMinutes = state.timeEntries.filter((entry) => entry.date.startsWith(year)).reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
  const ideasDone = state.creation.ideas.filter((idea) => idea.status === 'done' && inYear(idea.updatedAt || idea.createdAt)).length;
  return html`<div class="screen almanac-screen scroll-y">
    <header class="page-head wide"><div class="page-title"><div><h1 class="display-sm">Almanac</h1><p>A record of what got done in ${year}</p></div></div>
      <div class="page-tools"><button type="button" class="button is-primary small" data-action="almanac-add">${icon('star', { size: 14 })}Record milestone</button></div></header>
    <div class="year-numbers">
      ${stat(formatMinutes(yearMinutes), 'tracked')}
      ${stat(formatMinutes(state.analytics.deepWork.yearMinutes), 'in deep sessions')}
      ${stat(tasksDone, `task${tasksDone === 1 ? '' : 's'} completed`)}
      ${stat(booksDone, `book${booksDone === 1 ? '' : 's'} finished`)}
      ${stat(projectsDone, `project${projectsDone === 1 ? '' : 's'} done`)}
      ${stat(ideasDone, `idea${ideasDone === 1 ? '' : 's'} shipped`)}
    </div>
    <div class="almanac-grid">
      <div class="almanac-side">
        ${renderChallenge()}
        ${renderStreaks()}
      </div>
      ${renderMilestones()}
    </div>
  </div>`;
}

function stat(value, label) {
  return html`<div class="year-stat"><b>${value}</b><span>${label}</span></div>`;
}

function renderChallenge() {
  const challenge = store.state.challenge;
  if (!challenge) {
    return html`<section class="card challenge-card is-empty"><h3>Challenge</h3><p>Set a short, concrete target — like three deep sessions on one project this week — and LifeOS counts qualifying sessions for you.</p><button type="button" class="button small" data-action="challenge-edit">${icon('target', { size: 14 })}Set a challenge</button></section>`;
  }
  const project = lookup.project(challenge.projectId);
  return html`<section class="card challenge-card">
    <header class="card-head"><h3>Challenge</h3><div class="card-tools"><button type="button" class="icon-button tiny" data-action="challenge-edit" aria-label="Edit challenge">${icon('pen', { size: 13 })}</button><button type="button" class="icon-button tiny" data-action="challenge-clear" aria-label="Clear challenge">${icon('x', { size: 13 })}</button></div></header>
    <p class="challenge-quote">“${challenge.text}”</p>
    <div class="pips large">${Array.from({ length: challenge.target }, (_, index) => html`<i class="${index < challenge.progress ? 'on' : ''}"></i>`)}</div>
    <p class="muted small">${challenge.progress} of ${challenge.target} sessions of ${challenge.minDurationMinutes}+ min on ${project?.name || 'a project'} · ${challenge.daysLeft} day${challenge.daysLeft === 1 ? '' : 's'} left</p>
  </section>`;
}

function renderStreaks() {
  const state = store.state;
  const projects = state.projects.filter((project) => project.streak > 0).sort((a, b) => b.streak - a.streak);
  return html`<section class="card">
    <header class="card-head"><h3>Streaks</h3><span class="muted">30+ min a day</span></header>
    ${projects.length ? html`<ul class="streaks">${projects.map((project) => html`<li style="--dot:${state.domains[project.domain]?.color}"><a href="/projects/${encodeURIComponent(project.id)}"><i class="dot"></i>${project.name}</a><span class="streak-pips">${Array.from({ length: Math.min(14, Math.max(project.streak, 7)) }, (_, index) => html`<i class="${index < project.streak ? 'on' : ''}"></i>`)}</span><b>${project.streak}d</b></li>`)}</ul>`
      : html`<p class="card-empty">No active streaks. Thirty minutes today starts one.</p>`}
  </section>`;
}

function renderMilestones() {
  const state = store.state;
  const needle = normalize(store.ui.filter);
  const milestones = (state.milestones || []).filter((milestone) => !needle || normalize(milestone.text).includes(needle));
  const byMonth = new Map();
  for (const milestone of milestones) {
    const key = milestone.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(milestone);
  }
  return html`<section class="card milestones-card">
    <header class="card-head"><h3>Milestones <small>${state.milestones?.length || 0}</small></h3>
      <label class="filter-field">${icon('search', { size: 14 })}<input type="search" placeholder="Search milestones" value="${store.ui.filter}" data-page-filter aria-label="Search milestones"><kbd>/</kbd></label></header>
    <form class="milestone-add" data-milestone-add><span>${icon('star', { size: 14 })}</span><input name="text" placeholder="Record something you achieved today…" maxlength="300" autocomplete="off"><button type="submit" class="button small">Add</button></form>
    ${milestones.length ? html`<div class="timeline">${[...byMonth.entries()].map(([month, items]) => html`<div class="timeline-month">
      <h4>${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`))}</h4>
      <ul>${items.map((milestone) => html`<li data-key="ms-${milestone.id}" data-milestone="${milestone.id}">
        <time>${formatDate(milestone.date, { today: state.meta.today }).replace(/,? \d{4}$/, '')}</time>
        <span class="ms-text">${milestone.text}${milestone.projectId && lookup.project(milestone.projectId) ? html` <a class="ms-project" href="/projects/${encodeURIComponent(milestone.projectId)}">${lookup.project(milestone.projectId).name}</a>` : ''}</span>
        <button type="button" class="row-more" data-action="milestone-menu" aria-label="Milestone actions">${icon('more', { size: 14 })}</button>
      </li>`)}</ul>
    </div>`)}</div>` : html`<p class="card-empty">${needle ? 'No milestones match.' : 'Milestones you record appear here as a timeline.'}</p>`}
  </section>`;
}

async function editChallenge() {
  const state = store.state;
  const current = state.challenge || {};
  const today = state.meta.today;
  const values = await formDialog({
    title: current.text ? 'Edit challenge' : 'Set a challenge',
    submitLabel: 'Save challenge',
    fields: [
      { name: 'text', label: 'Challenge', value: current.text || '', required: true, autofocus: true, placeholder: 'Three deep sessions on Portia this week' },
      { name: 'projectId', label: 'Project', type: 'select', value: current.projectId || state.projects[0]?.id, options: state.projects.filter((project) => !['done', 'dropped'].includes(project.status) || project.id === current.projectId).map((project) => ({ value: project.id, label: project.name })) },
      { name: 'target', label: 'Sessions', type: 'number', value: current.target || 3, min: 1, max: 100, required: true },
      { name: 'minDurationMinutes', label: 'Minimum minutes each', type: 'number', value: current.minDurationMinutes || 45, min: 1, max: 600, required: true },
      { name: 'startDate', label: 'From', type: 'date', value: current.startDate || today, required: true },
      { name: 'endDate', label: 'Until', type: 'date', value: current.endDate || addDays(today, 6), required: true },
      { name: 'types', label: 'Counts', type: 'select', value: (current.activityTypes || []).join(',') || 'deep_work,creative,research', options: [{ value: 'deep_work,creative,research', label: 'Deep, creative and research sessions' }, { value: 'deep_work,creative', label: 'Deep and creative sessions' }, { value: '', label: 'Any session' }, ...Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label: `${label} only` }))] },
    ],
    validate: (v) => (v.endDate < v.startDate ? 'The end date must be after the start date.' : null),
  });
  if (!values) return;
  await run('challenge.set', { text: values.text, projectId: values.projectId, target: Number(values.target), minDurationMinutes: Number(values.minDurationMinutes), startDate: values.startDate, endDate: values.endDate, activityTypes: values.types ? values.types.split(',') : [] }).catch(() => undefined);
}

async function editMilestone(id) {
  const milestone = store.state.milestones.find((item) => item.id === id);
  const values = await formDialog({
    title: 'Edit milestone',
    fields: [
      { name: 'text', label: 'Milestone', value: milestone.text, required: true, autofocus: true },
      { name: 'date', label: 'Date', type: 'date', value: milestone.date, required: true },
      { name: 'projectId', label: 'Project', type: 'select', value: milestone.projectId || '', options: [{ value: '', label: 'None' }, ...store.state.projects.map((project) => ({ value: project.id, label: project.name }))] },
    ],
  });
  if (!values) return;
  await run('milestones.update', { milestoneId: id, text: values.text, date: values.date, projectId: values.projectId || null }).catch(() => undefined);
}

export const actions = {
  'almanac-add': () => document.querySelector('[data-milestone-add] input')?.focus(),
  'challenge-edit': () => editChallenge(),
  'challenge-clear': async () => {
    const ok = await confirmDialog({ title: 'Clear the challenge?', body: 'Its sessions stay logged; only the target is removed. You can undo right after.', confirmLabel: 'Clear', danger: true });
    if (ok) run('challenge.clear', {}).catch(() => undefined);
  },
  'milestone-menu': (el) => {
    const id = el.closest('[data-milestone]').dataset.milestone;
    openMenu({ anchor: el, width: 190, items: [
      { label: 'Edit', icon: 'pen', run: () => editMilestone(id) },
      { type: 'separator' },
      { label: 'Delete', icon: 'trash', danger: true, run: () => run('milestones.delete', { milestoneId: id }).catch(() => undefined) },
    ] });
  },
};

export async function submitMilestone(form) {
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await run('milestones.create', { text }).catch(() => { input.value = text; });
}

export default { id: 'almanac', render: render_, actions, presence: () => ({ title: 'Almanac' }) };
