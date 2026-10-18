import { fetchState } from '../api.js';
import { cx, html, figure } from '../dom.js';
import { ACTIVITY_LABELS, formatDate, formatHours, formatMinutes, normalize, plural, weekday } from '../format.js';
import { icon } from '../icons.js';
import { entryMenu } from '../menus.js';
import { render, setPref, store } from '../store.js';
import { openCapture } from '../ui/capture.js';
import { editEntry } from './today.js';

const RANGES = ['week', 'month', 'quarter', 'year'];

export function render_() {
  const state = store.state;
  const summary = state.summary;
  const analytics = state.analytics;
  const range = summary.range;
  const ratioDelta = Math.round((summary.deepRatio - state.settings.deepTarget) * 100);
  return html`<div class="screen insights-screen scroll-y">
    <header class="page-head wide">
      <div class="page-title"><div><h1 class="display-sm">Insights</h1><p>Where the hours actually went · ${formatDate(analytics.bounds.start, { today: state.meta.today })} – ${formatDate(analytics.bounds.end, { today: state.meta.today })}</p></div></div>
      <div class="page-tools">
        <div class="segmented" role="group" aria-label="Range">${RANGES.map((value) => html`<button type="button" class="${range === value ? 'is-active' : ''}" data-action="insights-range" data-range="${value}" aria-pressed="${String(range === value)}">${analytics.labels[value]}</button>`)}</div>
        <button type="button" class="button ghost small" data-action="insights-log">${icon('plus', { size: 13 })}Log time</button>
      </div>
    </header>
    <div class="kpis">
      ${kpi('Tracked', summary.totalRangeLabel, `of ${summary.plannedRangeLabel} planned`, Math.min(1, summary.totalRangeHours / Math.max(0.1, summary.plannedRangeHours)))}
      ${kpi('Deep work', `${Math.round(summary.deepRatio * 100)}%`, `${ratioDelta >= 0 ? '+' : ''}${ratioDelta} pts vs ${Math.round(state.settings.deepTarget * 100)}% target`, summary.deepRatio, ratioDelta >= 0 ? 'good' : 'warn')}
      ${kpi('On plan', `${summary.onPlan}%`, summary.onPlan >= 100 ? 'ahead of plan' : `${100 - summary.onPlan} pts short`, Math.min(1, summary.onPlan / 100), summary.onPlan >= 90 ? 'good' : '')}
      ${kpi('Focused sessions', formatMinutes(analytics.deepWork.monthMinutes), `${analytics.labels.month} · ${formatMinutes(analytics.deepWork.yearMinutes)} this year`, null)}
    </div>
    <p class="insight-note">${icon('info', { size: 14 })}${analytics.note}</p>
    <div class="chart-grid">
      ${renderDomains()}
      ${renderComposition()}
      ${renderHeatmap()}
      ${renderTrends()}
      ${renderCategories()}
    </div>
    ${renderTimeLog()}
  </div>`;
}

function kpi(label, value, sub, ratio, tone = '') {
  return html`<div class="kpi ${tone}"><span class="kpi-label">${label}</span><span class="kpi-value">${figure(value)}</span><span class="kpi-sub">${sub}</span>${ratio != null ? html`<span class="kpi-meter"><i style="width:${Math.max(0, Math.min(1, ratio)) * 100}%"></i></span>` : ''}</div>`;
}

function renderDomains() {
  const state = store.state;
  const weekly = Object.values(state.settings.weeklyPlanByDomain).reduce((sum, value) => sum + Number(value || 0), 0);
  const scale = weekly ? state.summary.plannedRangeHours / weekly : 1;
  const rows = Object.entries(state.domains).map(([id, domain]) => ({ id, domain, actual: state.analytics.actualByDomain[id] || 0, planned: (state.settings.weeklyPlanByDomain[id] || 0) * scale }));
  const max = Math.max(1, ...rows.flatMap((row) => [row.actual, row.planned]));
  return html`<section class="card chart-card">
    <header class="card-head"><h3>Domains vs plan</h3><span class="muted">bar = actual · tick = plan</span></header>
    <div class="domain-rows">${rows.map((row) => {
      const delta = Math.round((row.actual - row.planned) * 10) / 10;
      return html`<div class="domain-row" style="--dot:${row.domain.color}">
        <span class="domain-name"><i class="dot"></i>${row.domain.label}</span>
        <span class="domain-track"><i class="domain-fill" style="width:${(row.actual / max) * 100}%"></i>${row.planned ? html`<i class="domain-plan" style="left:${(row.planned / max) * 100}%"></i>` : ''}</span>
        <span class="domain-value">${row.actual ? formatHours(row.actual) : '—'}</span>
        <span class="domain-delta ${delta >= 0 ? 'good' : 'warn'}">${row.planned || row.actual ? `${delta >= 0 ? '+' : '−'}${formatHours(Math.abs(delta))}` : ''}</span>
      </div>`;
    })}</div>
  </section>`;
}

function renderComposition() {
  const state = store.state;
  const comp = state.analytics.composition;
  const total = Math.max(0.0001, comp.deep + comp.shallow + comp.admin);
  const pc = state.analytics.productionConsumption;
  const week = state.weekByDay || [];
  const max = Math.max(1, ...week.map((day) => day.deep + day.shallow + day.admin));
  return html`<section class="card chart-card">
    <header class="card-head"><h3>Composition</h3><span class="muted">deep target ${Math.round(state.settings.deepTarget * 100)}%</span></header>
    <div class="stack-bar" role="img" aria-label="Deep ${Math.round(comp.deep / total * 100)}%, shallow ${Math.round(comp.shallow / total * 100)}%, admin ${Math.round(comp.admin / total * 100)}%">
      <i class="seg-deep" style="flex:${comp.deep || 0.0001}"></i><i class="seg-shallow" style="flex:${comp.shallow || 0.0001}"></i><i class="seg-admin" style="flex:${comp.admin || 0.0001}"></i>
      <span class="target-tick" style="left:${state.settings.deepTarget * 100}%" title="Deep-work target"></span>
    </div>
    <div class="legend"><span><i class="seg-deep"></i>Deep ${formatHours(comp.deep)}</span><span><i class="seg-shallow"></i>Shallow ${formatHours(comp.shallow)}</span><span><i class="seg-admin"></i>Admin ${formatHours(comp.admin)}</span></div>
    <h4 class="chart-sub">Making vs taking in</h4>
    <div class="stack-bar thin"><i class="seg-make" style="flex:${pc.productionPct || 0.0001}"></i><i class="seg-take" style="flex:${pc.consumptionPct || 0.0001}"></i></div>
    <div class="legend"><span><i class="seg-make"></i>Production ${pc.productionPct}%</span><span><i class="seg-take"></i>Consumption ${pc.consumptionPct}%</span><span class="muted">Support ${formatHours(pc.supportHours)}</span></div>
    <h4 class="chart-sub">This week by day</h4>
    <div class="week-bars compact">${week.map((day) => html`<div class="week-day" title="${day.day}: ${formatHours(day.deep + day.shallow + day.admin)}"><div class="week-stack"><i class="seg-admin" style="height:${day.admin / max * 100}%"></i><i class="seg-shallow" style="height:${day.shallow / max * 100}%"></i><i class="seg-deep" style="height:${day.deep / max * 100}%"></i></div><span>${day.day[0]}</span></div>`)}</div>
  </section>`;
}

function renderHeatmap() {
  const { dates, values } = store.state.rhythmHeatmap;
  return html`<section class="card chart-card wide">
    <header class="card-head"><h3>Daily rhythm</h3><span class="muted">last 14 days · when you actually work</span></header>
    <div class="heatmap">
      <div class="hm-corner"></div>
      <div class="hm-hours">${Array.from({ length: 24 }, (_, hour) => html`<span>${hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>`)}</div>
      ${dates.map((date, row) => html`<span class="hm-day">${weekday(date, 'short').slice(0, 2)} ${Number(date.slice(8))}</span><div class="hm-row">${values[row].map((value, hour) => html`<i style="--v:${value}" title="${formatDate(date, { today: store.state.meta.today })} ${String(hour).padStart(2, '0')}:00"></i>`)}</div>`)}
    </div>
  </section>`;
}

function renderTrends() {
  const state = store.state;
  const projects = [...state.projects].filter((project) => project.weekHistory.some((value) => value > 0)).sort((a, b) => b.weekHours - a.weekHours || b.weekHistory.reduce((s, v) => s + v, 0) - a.weekHistory.reduce((s, v) => s + v, 0)).slice(0, 10);
  const max = Math.max(1, ...projects.flatMap((project) => project.weekHistory));
  return html`<section class="card chart-card">
    <header class="card-head"><h3>Project trends</h3><span class="muted">hours per week · last 8</span></header>
    ${projects.length ? html`<div class="trend-rows">${projects.map((project) => {
      const current = project.weekHistory.at(-1) || 0;
      const previous = project.weekHistory.at(-2) || 0;
      const delta = current - previous;
      return html`<a class="trend-row" href="/projects/${encodeURIComponent(project.id)}" style="--dot:${state.domains[project.domain]?.color}">
        <span class="trend-name"><i class="dot"></i>${project.name}</span>
        <span class="trend-bars">${project.weekHistory.map((value, index) => html`<i class="${index === project.weekHistory.length - 1 ? 'is-current' : ''}" style="height:${Math.max(4, value / max * 100)}%"></i>`)}</span>
        <span class="trend-value">${current ? formatHours(current) : '—'}</span>
        <span class="trend-delta ${delta > 0.1 ? 'good' : delta < -0.1 ? 'warn' : ''}">${delta > 0.1 ? '▲' : delta < -0.1 ? '▼' : '·'}</span>
      </a>`;
    })}</div>` : html`<p class="card-empty">No project time in the last eight weeks.</p>`}
  </section>`;
}

function renderCategories() {
  const state = store.state;
  const rows = Object.entries(state.analytics.actualByCategory || {}).filter(([, hours]) => hours > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, hours]) => hours));
  return html`<section class="card chart-card">
    <header class="card-head"><h3>Categories</h3><span class="muted">overlapping labels</span></header>
    <div class="domain-rows">${rows.map(([id, hours]) => html`<div class="domain-row"><span class="domain-name">${state.categories[id]?.label || id}</span><span class="domain-track"><i class="domain-fill neutral" style="width:${hours / max * 100}%"></i></span><span class="domain-value">${formatHours(hours)}</span><span></span></div>`)}</div>
  </section>`;
}

function renderTimeLog() {
  const state = store.state;
  const bounds = state.analytics.bounds;
  const filter = normalize(store.ui.filter);
  const type = store.ui.logType || 'all';
  const names = new Map(state.projects.map((project) => [project.id, project]));
  const entries = state.timeEntries
    .filter((entry) => entry.date >= bounds.start && entry.date <= bounds.end)
    .filter((entry) => type === 'all' || entry.activityType === type)
    .filter((entry) => !filter || normalize(`${entry.description} ${names.get(entry.projectId)?.name || ''}`).includes(filter))
    .sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`));
  const total = entries.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
  const limit = store.ui.logLimit || 60;
  let lastDate = null;
  return html`<section class="card time-log" id="time-log">
    <header class="card-head"><h2>Time log <small>${plural(entries.length, 'entry', 'entries')} · ${formatMinutes(total)}</small></h2>
      <div class="card-tools">
        <label class="filter-field">${icon('search', { size: 14 })}<input type="search" placeholder="Filter entries" value="${store.ui.filter}" data-page-filter aria-label="Filter entries"></label>
        <select class="select-small" data-log-type aria-label="Activity type"><option value="all" ${type === 'all' ? 'selected' : ''}>All types</option>${Object.entries(ACTIVITY_LABELS).map(([value, label]) => html`<option value="${value}" ${type === value ? 'selected' : ''}>${label}</option>`)}</select>
      </div>
    </header>
    ${entries.length ? html`<div class="log-table" role="table">${entries.slice(0, limit).map((entry) => {
      const project = names.get(entry.projectId);
      const header = entry.date !== lastDate ? html`<div class="log-date" role="row">${weekday(entry.date, 'long')}, ${formatDate(entry.date, { today: state.meta.today })}</div>` : '';
      lastDate = entry.date;
      return html`${header}<div class="${cx('log-row', entry.aggregation && 'is-aggregate')}" role="row" data-key="log-${entry.id}" data-entry="${entry.id}">
        <span class="log-time">${entry.aggregation ? 'week' : entry.time || '—'}</span>
        <span class="log-desc">${entry.description}${entry.aggregation ? html`<small>imported weekly total</small>` : ''}</span>
        <span class="log-project">${project ? html`<i class="dot" style="--dot:${state.domains[project.domain]?.color}"></i>${project.name}` : html`<span class="muted">General</span>`}</span>
        <span class="log-type type-${entry.activityType}">${ACTIVITY_LABELS[entry.activityType]}</span>
        <span class="log-duration">${formatMinutes(entry.durationMinutes)}</span>
        <button type="button" class="row-more" data-action="insights-entry" aria-label="Entry actions">${icon('more', { size: 15 })}</button>
      </div>`;
    })}</div>
    ${entries.length > limit ? html`<button type="button" class="button ghost load-more" data-action="insights-more">Show ${Math.min(60, entries.length - limit)} more</button>` : ''}`
      : html`<p class="card-empty">No entries in this period${filter || type !== 'all' ? ' match the filter' : ''}.</p>`}
  </section>`;
}

export const actions = {
  'insights-range': async (el) => {
    setPref('insights.range', el.dataset.range);
    await fetchState().catch(() => undefined);
  },
  'insights-log': () => openCapture({ kind: 'log' }),
  'insights-more': () => { store.ui.logLimit = (store.ui.logLimit || 60) + 60; render(); },
  'insights-entry': (el) => entryMenu(el.closest('[data-entry]').dataset.entry, el, { onEdit: editEntry }),
};

export function onLogType(value) {
  store.ui.logType = value;
  render();
}

export default { id: 'insights', render: render_, actions, presence: () => ({ title: 'Insights' }) };
