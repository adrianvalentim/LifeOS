// The LifeOS shell: the masthead (dateline, sections, the day strip), the
// current page with its detail sheet, and the agent rail. One delegated event layer routes every interaction to the
// screen, component or shell that owns it; the whole tree re-renders through
// `morph`, so focus, caret and scroll survive live updates from agents.
import * as act from './actions.js';
import { connectEvents, fetchState, onEvent, redo, reportPresence, undo } from './api.js';
import { handleGlobalKey, toggleRail } from './commands-ui.js';
import { cx, html, morph } from './dom.js';
import { elapsed, formatMinutes } from './format.js';
import { icon } from './icons.js';
import { applyLocation, interceptLinks, navigate, onRoute } from './router.js';
import { applyAppearance, lookup, render, setPref, setWorkspace, store, subscribe } from './store.js';
import { listCounts } from './task-model.js';
import { openCapture } from './ui/capture.js';
import { isDialogOpen } from './ui/dialog.js';
import { isDragging } from './ui/dnd.js';
import { closeMenus, isMenuOpen, openMenu } from './ui/menu.js';
import { isPaletteOpen, openPalette } from './ui/palette.js';
import { configureToasts, toast } from './ui/toast.js';
import * as rail from './rail.js';
import * as taskList from './components/task-list.js';
import * as taskSheet from './components/task-sheet.js';
import { taskMenu, projectMenu, bookMenu, ideaMenu } from './menus.js';
import today from './screens/today.js';
import tasks, * as tasksScreen from './screens/tasks.js';
import projects, * as projectsScreen from './screens/projects.js';
import creation, * as creationScreen from './screens/creation.js';
import reading, * as readingScreen from './screens/reading.js';
import insights, * as insightsScreen from './screens/insights.js';
import almanac, * as almanacScreen from './screens/almanac.js';
import settings, * as settingsScreen from './screens/settings.js';
import * as todayScreen from './screens/today.js';

const SCREENS = { today, tasks, projects, creation, reading, insights, almanac, settings };
const NAV_LABELS = { today: 'Today', tasks: 'Tasks', projects: 'Projects', creation: 'Creation', reading: 'Reading', insights: 'Insights', almanac: 'Almanac' };
const NAV_KEYS = { today: 'H', tasks: 'T', projects: 'P', creation: 'C', reading: 'R', insights: 'S', almanac: 'A' };
const NEW_ITEMS = [
  { kind: 'task', label: 'Task', icon: 'tasks', key: 'N' },
  { kind: 'log', label: 'Log time', icon: 'clock', key: 'L' },
  { kind: 'timer', label: 'Start timer', icon: 'play', key: 'T' },
  { kind: 'project', label: 'Project', icon: 'projects' },
  { kind: 'idea', label: 'Idea', icon: 'creation' },
  { kind: 'book', label: 'Book', icon: 'reading' },
  { kind: 'milestone', label: 'Milestone', icon: 'star' },
];

// Action handlers shared across the app; the current screen's own actions win.
const SHARED_ACTIONS = {
  ...taskList.taskActions,
  ...taskList.bulkActions,
  ...taskSheet.taskSheetActions,
  ...rail.railActions,
  ...readingScreen.actions,
  ...projectsScreen.actions,
  ...todayScreen.actions,
  ...creationScreen.actions,
  ...almanacScreen.actions,
  ...insightsScreen.actions,
  ...tasksScreen.actions,
  ...settingsScreen.actions,
  'open-palette': () => openPalette(),
  'new-menu': (el) => openMenu({
    anchor: el, width: 220, title: 'Create',
    items: NEW_ITEMS.map((item) => ({ label: item.label, icon: item.icon, shortcut: item.key, run: () => (item.kind === 'book' ? readingScreen.openBookSearch('') : openCapture({ kind: item.kind })) })),
  }),
  'nav-toggle': () => { store.ui.navOpen = !store.ui.navOpen; render(); },
  'sidebar-collapse': () => setPref('sidebarCollapsed', !store.prefs.sidebarCollapsed),
  'rail-toggle': () => toggleRail(),
  'theme-cycle': () => act.cycleTheme(),
  'timer-stop': () => act.stopTimer(),
  'timer-discard': () => act.discardTimer(),
  'timer-menu': (el) => {
    const session = store.state.activeSession;
    if (!session) return;
    openMenu({
      anchor: el, width: 220, align: 'start',
      items: [
        { label: 'Stop and log', icon: 'stop', run: () => act.stopTimer() },
        { label: 'Change project…', icon: 'projects', submenu: () => [{ label: 'No project', icon: 'inbox', run: () => act.updateTimer({ projectId: null }) }, ...store.state.projects.filter((project) => !['done', 'dropped'].includes(project.status)).map((project) => ({ label: project.name, icon: project.id === session.projectId ? 'check' : 'dot', run: () => act.updateTimer({ projectId: project.id }) }))], search: 'Find a project' },
        { label: 'Go to Today', icon: 'today', run: () => navigate('/today') },
        { type: 'separator' },
        { label: 'Discard timer', icon: 'x', danger: true, run: () => act.discardTimer() },
      ],
    });
  },
  'timer-start': () => openCapture({ kind: 'timer' }),
  'pin-menu': (el) => {
    const { kind, id } = el.closest('[data-pin]').dataset;
    openMenu({ anchor: el, width: 180, items: [{ label: 'Unpin', icon: 'pin', run: () => act.togglePin(kind, id) }] });
  },
  'retry-load': () => boot(),
};

function screen() {
  return SCREENS[store.ui.route.section] || SCREENS.projects;
}

// ——— Shell rendering ——————————————————————————————————————————————————
function renderApp() {
  const state = store.state;
  if (!state) {
    return store.ui.error
      ? html`<div class="boot-error"><h1>LifeOS could not load</h1><p>${store.ui.error}</p><button type="button" class="button is-primary" data-action="retry-load">Try again</button></div>`
      : html`<div class="boot"><span class="boot-mark">LifeOS</span></div>`;
  }
  const current = screen();
  let body;
  try {
    body = current.render();
  } catch (error) {
    console.error(error);
    body = html`<div class="screen-empty"><span class="fleuron">❦</span><h2>This page hit a problem</h2><p>${error.message}</p><button type="button" class="button" data-action="retry-load">Reload data</button></div>`;
  }
  const sheet = renderSheet();
  return html`<div class="${cx('app', store.prefs.sidebarCollapsed && 'is-condensed', store.prefs.railOpen && 'has-rail', store.ui.navOpen && 'is-nav-open', sheet && 'has-sheet')}" style="--rail-w:${store.prefs.railWidth}px">
    <main class="main" id="main" data-section="${store.ui.route.section}">
      ${renderMasthead()}
      <div class="stage">
        <div class="screen-host" data-key="screen-${store.ui.route.section}">${body}</div>
        ${sheet}
      </div>
    </main>
    ${store.ui.navOpen ? renderContents() : ''}
    ${store.prefs.railOpen ? html`<div class="rail-scrim" data-action="rail-close"></div>${rail.renderRail()}` : ''}
  </div>`;
}

function navCount(id) {
  const state = store.state;
  const counts = listCounts(state);
  if (id === 'today') return counts.overdue ? { value: counts.today, alert: true, title: `${counts.overdue} overdue` } : counts.today ? { value: counts.today, title: 'Due today' } : null;
  if (id === 'tasks') return counts.inbox ? { value: counts.inbox, title: 'In Inbox' } : null;
  if (id === 'projects') return state.summary.criticalCount ? { value: state.summary.criticalCount, alert: true, title: 'Need attention' } : null;
  if (id === 'reading') { const n = state.reading.books.filter((book) => book.status === 'reading').length; return n ? { value: n, title: 'Reading now' } : null; }
  if (id === 'creation') { const n = state.creation.ideas.filter((idea) => idea.status === 'doing').length; return n ? { value: n, title: 'In progress' } : null; }
  return null;
}

const dayFormat = (options) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${store.state.meta.today}T12:00:00Z`));
const CONNECTION = { live: ['Live', 'Live — changes by agents appear instantly'], offline: ['Offline', 'Offline — reconnecting'], reconnecting: ['Reconnecting', 'Reconnecting…'], connecting: ['Connecting', 'Connecting…'] };

// The masthead: dateline, title and tools; the line of sections (and pins)
// under a double rule; and the day itself as a strip along the bottom edge.
function renderMasthead() {
  const state = store.state;
  const section = store.ui.route.section;
  const nav = state.workspace.nav.filter((item) => !item.hidden);
  const pins = state.workspace.pinned.map(pinLink).filter(Boolean);
  const [connLabel, connTitle] = CONNECTION[store.ui.connection] || CONNECTION.connecting;
  return html`<header class="masthead">
    <button type="button" class="icon-button mast-menu" data-action="nav-toggle" aria-label="Contents" title="Contents">${icon('menu', { size: 18 })}</button>
    <p class="mast-date">
      <b>${dayFormat({ weekday: 'long' })}</b>
      <span>${dayFormat({ day: 'numeric', month: 'long', year: 'numeric' })}</span>
      <span class="mast-issue">Week ${state.meta.weekNumber} · Nº ${state.meta.issueNumber}</span>
      <span class="${cx('conn', `is-${store.ui.connection}`)}" title="${connTitle}">${connLabel}</span>
    </p>
    <a class="mast-title" href="/${state.workspace.startScreen}" title="${state.meta.tagline}">${state.meta.appName}</a>
    <div class="mast-tools">
      ${renderTimerSlot()}
      <button type="button" class="mast-search" data-action="open-palette" title="Search and commands (⌘K)">${icon('search', { size: 14 })}<span>Search</span><kbd>⌘K</kbd></button>
      <button type="button" class="button small is-primary mast-new" data-action="new-menu" aria-haspopup="menu" title="Create (N)">${icon('plus', { size: 13 })}<span>New</span></button>
      <button type="button" class="${cx('icon-button mast-rail', store.prefs.railOpen && 'is-active')}" data-action="rail-toggle" aria-label="Agent rail" title="Agent rail (⌘J)">${icon('rail', { size: 16 })}</button>
    </div>
    <div class="sections-row">
      <nav class="sections" aria-label="Sections">
        ${nav.map((item) => {
          const count = navCount(item.id);
          return html`<a class="${cx('nav-link', section === item.id && 'is-active')}" href="/${item.id}" data-key="nav-${item.id}" title="${NAV_LABELS[item.id]}${count?.title ? ` · ${/^\d/.test(count.title) ? count.title : `${count.value} ${count.title.toLowerCase()}`}` : ''} — G then ${NAV_KEYS[item.id]}" ${section === item.id ? html`aria-current="page"` : ''}>
            <span class="nav-label">${NAV_LABELS[item.id]}</span>${count ? html`<sup class="${cx('count', count.alert && 'is-alert')}" title="${count.title || ''}">${count.value}</sup>` : ''}
          </a>`;
        })}
        ${pins.length ? html`<span class="sections-sep" aria-hidden="true">·</span>${pins}` : ''}
      </nav>
      <div class="sections-tools">
        <button type="button" class="icon-button tiny" data-action="theme-cycle" aria-label="Day or night edition" title="Day or night edition">${icon(document.documentElement.dataset.effectiveTheme === 'dark' ? 'sun' : 'moon', { size: 15 })}</button>
        <a class="${cx('icon-button tiny', section === 'settings' && 'is-active')}" href="/settings" aria-label="Settings" title="Settings (⌘,)">${icon('settings', { size: 15 })}</a>
      </div>
    </div>
    ${renderRibbon()}
  </header>`;
}

function renderTimerSlot() {
  const state = store.state;
  const session = state.activeSession;
  if (!session) return html`<button type="button" class="mast-focus" data-action="timer-start" title="Start a focus timer (T)">${icon('play', { size: 11 })}<span>Focus</span><kbd>T</kbd></button>`;
  const project = session.projectId ? lookup.project(session.projectId) : null;
  return html`<div class="mast-timer" data-key="timer">
    <button type="button" class="mast-timer-main" data-action="timer-menu" aria-haspopup="menu" title="${project?.name || 'No project'} · ${session.description || 'Focused work'}">
      <i class="timer-pulse"></i><b data-elapsed-since="${session.startedAt}">${elapsed(session.startedAt)}</b><span>${project?.name || 'Focus'}</span>
    </button>
    <button type="button" class="icon-button tiny" data-action="timer-stop" aria-label="Stop timer and log time" title="Stop and log">${icon('stop', { size: 12 })}</button>
  </div>`;
}

// Today from six in the morning (or the first entry) to midnight: each logged
// entry is a block in its activity's ink, the running timer grows in rubric,
// and a rubric hairline marks now.
function clockMinutes(value) {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) ? hours * 60 + (minutes || 0) : null;
}

function renderRibbon() {
  const state = store.state;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const entries = state.todayEntries.map((entry) => ({ entry, start: clockMinutes(entry.time) })).filter((item) => item.start != null);
  const session = state.activeSession;
  const sessionStart = session ? (() => { const date = new Date(session.startedAt); return date.toDateString() === now.toDateString() ? date.getHours() * 60 + date.getMinutes() : 0; })() : null;
  const earliest = Math.min(6 * 60, nowMinutes, ...entries.map((item) => item.start), ...(sessionStart != null ? [sessionStart] : []));
  const from = Math.floor(earliest / 60) * 60;
  const span = 24 * 60 - from;
  const at = (minutes) => `${Math.max(0, Math.min(100, ((minutes - from) / span) * 100)).toFixed(3)}%`;
  const width = (minutes) => `${Math.max(0.25, (minutes / span) * 100).toFixed(3)}%`;
  const total = state.summary.todayMinutes;
  const hours = [];
  for (let hour = Math.ceil(from / 60); hour < 24; hour += 1) hours.push(hour);
  return html`<div class="ribbon" role="img" aria-label="Today: ${total ? formatMinutes(total) : 'nothing'} logged" title="Today · ${total ? formatMinutes(total) : 'nothing'} logged">
    ${hours.map((hour) => html`<span class="${cx('ribbon-hour', hour % 3 === 0 && 'is-major')}" style="left:${at(hour * 60)}" ${hour % 3 === 0 ? html`data-label="${String(hour).padStart(2, '0')}"` : ''}></span>`)}
    ${entries.map(({ entry, start }) => html`<i class="${cx('ribbon-block', `type-${entry.activityType}`)}" style="left:${at(start)};width:${width(entry.durationMinutes)}" title="${entry.time} · ${entry.description} · ${formatMinutes(entry.durationMinutes)}"></i>`)}
    ${sessionStart != null ? html`<i class="ribbon-block is-live" style="left:${at(sessionStart)};width:${width(Math.max(1, nowMinutes - sessionStart))}" title="Running · ${session.description || 'Focused work'}"></i>` : ''}
    <i class="ribbon-now" style="left:${at(nowMinutes)}" title="Now"></i>
  </div>`;
}

// On phones the sections open as a contents page.
function renderContents() {
  const state = store.state;
  const section = store.ui.route.section;
  const nav = state.workspace.nav.filter((item) => !item.hidden);
  const pins = state.workspace.pinned.map(pinLink).filter(Boolean);
  return html`<div class="contents-layer" data-key="contents">
    <div class="contents-scrim" data-action="nav-toggle"></div>
    <nav class="contents" aria-label="Contents">
      <header class="contents-head">
        <span class="contents-title">${state.meta.appName}</span>
        <button type="button" class="icon-button" data-action="nav-toggle" aria-label="Close contents">${icon('x', { size: 18 })}</button>
      </header>
      <p class="eyebrow">${dayFormat({ weekday: 'long', day: 'numeric', month: 'long' })} · Nº ${state.meta.issueNumber}</p>
      <ol class="contents-list">
        ${nav.map((item, index) => {
          const count = navCount(item.id);
          return html`<li><a class="${cx('contents-link', section === item.id && 'is-active')}" href="/${item.id}"><span class="folio">${String(index + 1).padStart(2, '0')}</span><span class="contents-label">${NAV_LABELS[item.id]}</span>${count ? html`<b class="${cx('count', count.alert && 'is-alert')}">${count.value}</b>` : ''}</a></li>`;
        })}
      </ol>
      ${pins.length ? html`<p class="eyebrow contents-pins-head">Pinned</p><div class="contents-pins">${pins}</div>` : ''}
      <footer class="contents-foot">
        <a class="button small" href="/settings">${icon('settings', { size: 14 })}Settings</a>
        <button type="button" class="button small" data-action="theme-cycle">${icon(document.documentElement.dataset.effectiveTheme === 'dark' ? 'sun' : 'moon', { size: 14 })}${document.documentElement.dataset.effectiveTheme === 'dark' ? 'Day edition' : 'Night edition'}</button>
      </footer>
    </nav>
  </div>`;
}

function pinLink(pin) {
  const state = store.state;
  if (pin.kind === 'project') {
    const project = lookup.project(pin.id);
    if (!project) return null;
    const active = store.ui.route.section === 'projects' && store.ui.route.id === pin.id;
    return html`<a class="${cx('nav-link is-pin', active && 'is-active')}" href="/projects/${encodeURIComponent(pin.id)}" data-pin data-kind="project" data-id="${pin.id}" data-key="pin-p-${pin.id}" data-drop-list="project:${pin.id}"><i class="dot" style="--dot:${state.domains[project.domain]?.color}"></i><span class="nav-label">${project.name}</span></a>`;
  }
  if (pin.kind === 'view') {
    const view = state.workspace.views.find((item) => item.id === pin.id);
    if (!view) return null;
    const active = store.ui.route.section === 'tasks' && store.ui.route.params.get('list') === `view:${pin.id}`;
    return html`<a class="${cx('nav-link is-pin', active && 'is-active')}" href="/tasks?list=view:${encodeURIComponent(pin.id)}" data-pin data-kind="view" data-id="${pin.id}" data-key="pin-v-${pin.id}"><span class="nav-label">${view.name}</span></a>`;
  }
  const active = store.ui.route.section === 'tasks' && store.ui.route.params.get('list') === `tag:${pin.id}`;
  return html`<a class="${cx('nav-link is-pin', active && 'is-active')}" href="/tasks?list=tag:${encodeURIComponent(pin.id)}" data-pin data-kind="tag" data-id="${pin.id}" data-key="pin-t-${pin.id}" data-drop-list="tag:${pin.id}"><span class="nav-label">#${pin.id}</span></a>`;
}

function renderSheet() {
  const sheet = store.ui.sheet;
  if (!sheet) return '';
  let content = '';
  if (sheet.kind === 'task' && lookup.task(sheet.id)) content = taskSheet.renderTaskSheet(sheet.id);
  else if (sheet.kind === 'book' && lookup.book(sheet.id)) content = readingScreen.renderBookSheet(sheet.id);
  if (!content) return '';
  return html`<div class="sheet-layer" data-key="sheet-layer">
    <div class="sheet-scrim" data-action="sheet-close"></div>
    <section class="sheet" role="dialog" aria-modal="false" aria-label="Details" data-key="sheet-${sheet.kind}-${sheet.id}" tabindex="-1">${content}</section>
  </div>`;
}

// ——— Rendering loop ———————————————————————————————————————————————————
const root = document.getElementById('app');
let lastPresence = '';
let lastSheet = null;

function paint() {
  morph(root, renderApp());
  if (!store.state) return;
  const sheetKey = store.ui.sheet ? `${store.ui.sheet.kind}:${store.ui.sheet.id}` : null;
  if (store.ui.sheet?.kind === 'task') taskSheet.mountTaskSheet();
  if (sheetKey && sheetKey !== lastSheet && !document.activeElement?.closest('.sheet')) {
    requestAnimationFrame(() => { if (!document.activeElement?.closest('.sheet, input, textarea')) root.querySelector('.sheet')?.focus({ preventScroll: true }); });
  }
  lastSheet = sheetKey;
  screen().mount?.();
  syncPresence();
}

function syncPresence() {
  const current = screen();
  const base = current.presence?.() || { title: NAV_LABELS[store.ui.route.section] };
  const sheet = store.ui.sheet;
  const selected = sheet?.kind === 'task' ? lookup.task(sheet.id) : sheet?.kind === 'book' ? lookup.book(sheet.id) : null;
  const presence = {
    route: `${location.pathname}${location.search}`,
    title: base.title,
    list: store.ui.route.params.get('list') || null,
    selected: selected ? { kind: sheet.kind, id: selected.id, title: selected.title } : base.selected || null,
    multiSelection: [...store.ui.selection],
  };
  const key = JSON.stringify(presence);
  if (key === lastPresence) return;
  lastPresence = key;
  reportPresence(presence);
  document.title = `${base.title || 'LifeOS'} · ${store.state.meta.appName}`;
}

// ——— Theme ————————————————————————————————————————————————————————————
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function syncEffectiveTheme() {
  const mode = document.documentElement.dataset.themeMode || 'system';
  const effective = mode === 'system' ? (darkQuery.matches ? 'dark' : 'light') : mode;
  if (document.documentElement.dataset.effectiveTheme !== effective) {
    document.documentElement.dataset.effectiveTheme = effective;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effective === 'dark' ? '#1b1916' : '#f6f1e7');
    render();
  }
}
darkQuery.addEventListener('change', syncEffectiveTheme);

// ——— Events ———————————————————————————————————————————————————————————
function runAction(name, element, event) {
  const handler = screen().actions?.[name] || SHARED_ACTIONS[name];
  if (!handler) { console.warn(`No handler for action ${name}`); return; }
  try {
    const result = handler(element, event);
    if (result?.catch) result.catch((error) => toast(error.message, { tone: 'error' }));
  } catch (error) {
    console.error(error);
    toast(error.message, { tone: 'error' });
  }
}

root.addEventListener('click', (event) => {
  if (isDragging()) return;
  const link = event.target.closest('a[data-task-link]');
  if (link && act.isDesktopShell()) {
    event.preventDefault();
    act.openTaskLink(link.dataset.taskLink, link.href);
    return;
  }
  const actionEl = event.target.closest('[data-action]');
  if (actionEl && !actionEl.disabled && root.contains(actionEl)) {
    if (actionEl.tagName === 'INPUT' && actionEl.type === 'checkbox') { runAction(actionEl.dataset.action, actionEl, event); return; }
    event.preventDefault();
    runAction(actionEl.dataset.action, actionEl, event);
    if (store.ui.navOpen && actionEl.closest('.contents') && actionEl.dataset.action !== 'nav-toggle') { store.ui.navOpen = false; render(); }
    return;
  }
  if (event.target.closest('a[href]')) {
    if (store.ui.navOpen) { store.ui.navOpen = false; render(); }
    return;
  }
  if (event.target.closest('button, input, textarea, select, label, summary, details > *:not(summary)')) return;
  // Whole cards open their record.
  const card = event.target.closest('[data-project].project-card, [data-idea].idea-card, [data-book].book-card');
  if (card) {
    if (card.dataset.project) act.openProject(card.dataset.project);
    else if (card.dataset.idea) act.openIdea(card.dataset.idea);
    else act.openBook(card.dataset.book);
  }
});

root.addEventListener('contextmenu', (event) => {
  const target = event.target.closest('[data-task]:not(.is-input), .project-card[data-project], .idea-card[data-idea], .book-card[data-book], tr[data-book]');
  if (!target || event.target.closest('input, textarea')) return;
  event.preventDefault();
  const anchor = { x: event.clientX, y: event.clientY };
  if (target.dataset.task) taskMenu(target.dataset.task, anchor);
  else if (target.dataset.project) projectMenu(target.dataset.project, anchor);
  else if (target.dataset.idea) ideaMenu(target.dataset.idea, anchor);
  else if (target.dataset.book) bookMenu(target.dataset.book, anchor);
});

root.addEventListener('dblclick', (event) => {
  const row = event.target.closest('[data-task]:not(.is-input)');
  if (row && event.target.closest('.task-title') && !lookup.task(row.dataset.task)?.trashedAt) {
    event.preventDefault();
    taskList.startRename(row.dataset.task);
  }
});

root.addEventListener('pointerdown', (event) => {
  if (event.target.closest('[data-rail-resize]')) { rail.startRailResize(event); return; }
  const source = event.target.closest('[data-draggable]');
  if (!source || event.button !== 0) return;
  const kind = source.dataset.draggable;
  if (kind === 'task') taskList.startTaskDrag(event, source);
  else if (kind === 'project') projectsScreen.startProjectDrag(event, source);
  else if (kind === 'idea') creationScreen.startIdeaDrag(event, source);
  else if (kind === 'book') readingScreen.startBookDrag(event, source);
});

root.addEventListener('input', (event) => {
  const el = event.target;
  if (el.matches('.composer-input')) { rail.onComposerInput(el); return; }
  if (el.matches('[data-page-filter]')) { (store.ui.route.section === 'tasks' ? tasksScreen.onFilterInput : (value) => { store.ui.filter = value; render(); })(el.value); return; }
  if (el.matches('[data-task-field]')) { taskSheet.onTaskFieldInput(el); return; }
  if (el.matches('[data-project-field]')) { projectsScreen.onProjectFieldInput(el); return; }
  if (el.matches('[data-idea-field]')) { creationScreen.onIdeaFieldInput(el); return; }
  if (el.matches('[data-quick-input]')) { store.ui.drafts[el.dataset.quickInput] = el.value; render(); return; }
  if (el.matches('[data-timer-description]')) { todayScreen.onTimerDescription(el.value); return; }
  if (el.matches('[data-setting], [data-domain], [data-category], [data-command-filter], [data-accent-custom]')) settingsScreen.onSettingInput(el);
});

root.addEventListener('change', (event) => {
  const el = event.target;
  if (el.matches('[data-log-type]')) insightsScreen.onLogType(el.value);
  else if (el.matches('[data-reading-tag]')) readingScreen.onReadingTag(el.value);
  else if (el.matches('[data-creation-status]')) setPref('creation.status', el.value);
  else if (el.matches('[data-project-progress]')) projectsScreen.onProgressChange(el);
  else if (el.matches('[data-workspace]')) settingsScreen.onSettingInput(el);
  else if (el.matches('[data-setting], [data-domain], [data-accent-custom]')) settingsScreen.onSettingInput(el, { commit: true });
  else if (el.matches('[data-category]')) settingsScreen.onSettingInput(el, { commit: true });
});

root.addEventListener('focusout', (event) => {
  const el = event.target;
  if (el.matches('[data-task-field]')) taskSheet.flushField(el.dataset.taskId, el.dataset.taskField);
  else if (el.matches('[data-project-field]')) projectsScreen.flushProjectField(el.dataset.projectId, el.dataset.projectField);
  else if (el.matches('[data-rename]') && store.ui.editing?.id === el.dataset.rename) taskList.commitRename(el);
});

root.addEventListener('submit', (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.matches('[data-quick-add]')) taskList.submitQuickAdd(form);
  else if (form.matches('[data-agent-form]')) rail.sendMessage();
  else if (form.matches('[data-request-form]')) rail.submitRequestForm(form);
  else if (form.matches('[data-login-code-form]')) rail.submitLoginCode(form);
  else if (form.matches('[data-milestone-add]')) almanacScreen.submitMilestone(form);
  else if (form.matches('[data-category-add]')) settingsScreen.submitCategory(form);
});

root.addEventListener('scroll', (event) => {
  if (event.target.matches?.('[data-agent-scroll]')) rail.onRailScroll(event.target);
}, true);

document.addEventListener('error', (event) => {
  if (event.target.matches?.('img[data-cover]')) {
    event.target.closest('.book-cover')?.classList.add('is-missing');
    event.target.remove();
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || isPaletteOpen() || isDialogOpen() || isMenuOpen() || document.querySelector('.capture-backdrop:not(.is-leaving)')) return;
  const target = event.target;
  const typing = target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (rail.onComposerKey(event)) return;
  if (taskSheet.onTaskFieldKey(event)) return;
  if (taskList.handleTaskInputKey(event)) return;
  if (creationScreen.onEditorKey(event)) return;
  if (target.matches?.('[data-idea-add]')) {
    if (event.key === 'Enter') { event.preventDefault(); creationScreen.submitInlineIdea(target); }
    else if (event.key === 'Escape') { event.preventDefault(); store.ui.addingIdeaIn = null; render(); }
    return;
  }
  if (target.matches?.('[data-page-filter]') && event.key === 'Escape') {
    event.preventDefault();
    if (target.value) { target.value = ''; store.ui.filter = ''; render(); } else target.blur();
    return;
  }
  if (target.matches?.('[data-project-field]') && (event.key === 'Enter' && target.tagName === 'INPUT' || event.key === 'Escape')) {
    event.preventDefault();
    target.blur();
    return;
  }
  if (!typing && taskList.handleTaskKey(event)) return;
  // J / K / arrows start keyboard navigation in a task list when nothing is focused.
  if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && ['j', 'k', 'ArrowDown', 'ArrowUp'].includes(event.key)
    && !store.ui.sheet && !target.closest?.('[data-task], .menu, .rail') && root.querySelector('.main [data-task]:not(.is-input)')) {
    event.preventDefault();
    taskList.focusFirstRow();
    return;
  }
  if (handleGlobalKey(event)) return;
  if (typing) return;
  if (event.key === 'Escape') {
    if (store.ui.navOpen) { store.ui.navOpen = false; render(); return; }
    if (store.ui.sheet) { taskSheet.flushTaskDrafts(); act.closeSheet(); restoreRowFocus(); return; }
    if (store.ui.selection.size) { store.ui.selection = new Set(); render(); return; }
  }
  // J/K step through the list while a detail sheet is open.
  if (store.ui.sheet?.kind === 'task' && (event.key === 'j' || event.key === 'k') && !event.metaKey && !event.ctrlKey) {
    const rows = taskList.currentRows();
    const index = rows.indexOf(store.ui.sheet.id);
    const next = rows[index + (event.key === 'j' ? 1 : -1)];
    if (next) { event.preventDefault(); taskSheet.flushTaskDrafts(); store.ui.focusId = next; act.openTask(next); }
    return;
  }
  // Enter opens a focused card.
  if (event.key === 'Enter' && target.matches?.('.project-card, .idea-card, .book-card')) {
    event.preventDefault();
    if (target.dataset.project) act.openProject(target.dataset.project);
    else if (target.dataset.idea) act.openIdea(target.dataset.idea);
    else if (target.dataset.book) act.openBook(target.dataset.book);
  }
});

function restoreRowFocus() {
  const id = store.ui.focusId;
  if (!id) return;
  requestAnimationFrame(() => root.querySelector(`.main [data-task="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
}

// Live clocks for running timers, and the day strip once a minute.
let lastMinute = new Date().getMinutes();
setInterval(() => {
  for (const element of document.querySelectorAll('[data-elapsed-since]')) {
    const text = elapsed(element.dataset.elapsedSince);
    if (element.textContent !== text) element.textContent = text;
  }
  const minute = new Date().getMinutes();
  if (minute !== lastMinute) { lastMinute = minute; render(); }
}, 1000);

// ——— Live events from the server (agents, CLI, other windows) —————————
onEvent('history', () => rail.onHistoryChanged());
onEvent('workspace', (payload) => { if (payload.workspace) { setWorkspace(payload.workspace); syncEffectiveTheme(); } });
onEvent('codex', (payload) => rail.handleAgentEvent('codex', payload));
onEvent('claude', (payload) => rail.handleAgentEvent('claude', payload));
onEvent('ui', (payload) => {
  if (payload.type === 'navigate' && payload.to) navigate(payload.to.startsWith('/') ? payload.to : `/${payload.to}`);
  else if (payload.type === 'open') act.openRecord(payload.kind, payload.id);
  else if (payload.type === 'toast') toast(payload.message, { tone: payload.tone === 'error' ? 'error' : 'agent' });
  else if (payload.type === 'capture') openCapture({ kind: payload.kind, text: payload.text });
  else if (payload.type === 'palette') openPalette(payload.query || '');
});

// ——— Route lifecycle ——————————————————————————————————————————————————
let previousSection = null;
onRoute((route, { changedSection }) => {
  if (!changedSection) return;
  taskSheet.flushTaskDrafts();
  projectsScreen.flushProjectDrafts();
  if (previousSection === 'creation') void creationScreen.leaveEditor();
  if (previousSection && previousSection !== route.section) SCREENS[previousSection]?.onLeave?.();
  previousSection = route.section;
  closeMenus({ restoreFocus: false });
  store.ui.navOpen = false;
  requestAnimationFrame(() => root.querySelector('.screen-host .scroll-y, .screen-host')?.scrollTo?.({ top: 0 }));
});

// ——— Boot —————————————————————————————————————————————————————————————
configureToasts({ onUndo: (operationId) => undo(operationId), onRedo: () => redo() });
interceptLinks(root);
subscribe(paint);

// On narrow screens the rail floats over the page, so it starts closed there
// (without changing the saved desktop preference).
if (matchMedia('(max-width: 1100px)').matches) store.prefs.railOpen = false;

async function boot() {
  store.ui.error = null;
  try {
    const state = await fetchState();
    applyAppearance(state.workspace);
    syncEffectiveTheme();
    previousSection = null;
    applyLocation();
    previousSection = store.ui.route.section;
  } catch (error) {
    store.ui.error = error.message;
    render();
  }
}

syncEffectiveTheme();
paint();
await boot();
connectEvents();
