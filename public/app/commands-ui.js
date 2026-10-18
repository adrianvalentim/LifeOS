// UI-level actions for the palette and the global keyboard map. Each wraps a
// LifeOS command or a navigation, and is listed once so the palette, the
// shortcuts help and the key handler can never disagree.
import * as act from './actions.js';
import { fetchState, redo, run, undo } from './api.js';
import { escapeHtml } from './dom.js';
import { navigate } from './router.js';
import { render, setPref, store } from './store.js';
import { openCapture } from './ui/capture.js';
import { toast } from './ui/toast.js';

export const SHORTCUTS = [
  { group: 'Anywhere', items: [
    ['⌘ K', 'Search and commands'], ['N', 'Quick capture (new task)'], ['L', 'Log time'], ['T', 'Start a timer'],
    ['⌘ Z', 'Undo'], ['⇧ ⌘ Z', 'Redo'], ['⌘ J', 'Show or hide the agent rail'], ['⌘ \\', 'Show or hide the sidebar'],
    ['⌘ ,', 'Settings'], ['/', 'Filter the current list'], ['?', 'This help'],
  ] },
  { group: 'Go to', items: [
    ['G then H', 'Today'], ['G then T', 'Tasks'], ['G then I', 'Inbox'], ['G then U', 'Upcoming'], ['G then P', 'Projects'],
    ['G then C', 'Creation'], ['G then R', 'Reading'], ['G then S', 'Insights (stats)'], ['G then A', 'Almanac'],
  ] },
  { group: 'Lists', items: [
    ['↑ ↓  or  J K', 'Move focus'], ['↵', 'Open details'], ['Space', 'Complete / reopen'], ['X', 'Select (⇧ to extend)'],
    ['D', 'Due date'], ['P', 'Priority'], ['M', 'Move to list'], ['#', 'Tags'], ['S', 'Add subtask'], ['1 2 3 0', 'Set priority'],
    ['⌫', 'Move to Trash'], ['⌘ D', 'Duplicate'], ['⌥ ↑ ↓', 'Reorder'], ['Tab  ⇧ Tab', 'Nest / un-nest'], ['⇧ F10', 'Actions menu'],
  ] },
  { group: 'Detail sheet', items: [['Esc', 'Close'], ['⌘ ↵', 'Close and save'], ['J K', 'Next / previous item (outside fields)']] },
];

export function paletteActions() {
  const state = store.state;
  const running = Boolean(state.activeSession);
  const go = (label, path, iconName, shortcut, keywords = '') => ({ group: 'Go to', label, icon: iconName, shortcut, keywords, run: () => navigate(path) });
  return [
    { label: 'New task', icon: 'plus', shortcut: 'N', suggested: true, keywords: 'add create todo capture', weight: 40, run: () => openCapture({ kind: 'task' }) },
    { label: 'Log time', icon: 'clock', shortcut: 'L', suggested: true, keywords: 'track record hours entry', weight: 30, run: () => openCapture({ kind: 'log' }) },
    running
      ? { label: 'Stop timer and log', icon: 'stop', suggested: true, keywords: 'session finish', weight: 50, run: () => act.stopTimer() }
      : { label: 'Start focus timer', icon: 'play', shortcut: 'T', suggested: true, keywords: 'session begin focus pomodoro', weight: 30, run: () => openCapture({ kind: 'timer' }) },
    ...(running ? [{ label: 'Discard running timer', icon: 'x', keywords: 'cancel session', run: () => act.discardTimer() }] : []),
    { label: 'New project', icon: 'projects', keywords: 'add create', run: () => openCapture({ kind: 'project' }) },
    { label: 'New idea', icon: 'creation', keywords: 'creation short video script story', run: () => openCapture({ kind: 'idea' }) },
    { label: 'Add a book', icon: 'reading', keywords: 'reading library search open library isbn', run: () => import('./screens/reading.js').then(({ openBookSearch }) => openBookSearch('')) },
    { label: 'Record a milestone', icon: 'star', keywords: 'achievement win almanac', run: () => openCapture({ kind: 'milestone' }) },
    { label: 'Save a task view…', icon: 'list', keywords: 'smart list filter perspective', run: () => import('./screens/tasks.js').then(({ editView }) => editView()) },
    go('Today', '/today', 'today', 'G H', 'home dashboard'),
    go('Tasks', '/tasks', 'tasks', 'G T', 'todo'),
    go('Inbox', '/tasks?list=inbox', 'inbox', 'G I'),
    go('Upcoming — next 7 days', '/tasks?list=next7', 'upcoming', 'G U', 'week schedule'),
    go('Today’s tasks', '/tasks?list=today', 'calendar', '', 'due today overdue'),
    go('Completed tasks', '/tasks?list=completed', 'check', '', 'done archive'),
    go('Trash', '/tasks?list=trash', 'trash', '', 'deleted restore'),
    go('Projects', '/projects', 'projects', 'G P', 'portfolio'),
    go('Project board', '/projects?view=board', 'board', '', 'kanban'),
    go('Creation', '/creation', 'creation', 'G C', 'ideas videos shorts'),
    go('Reading', '/reading', 'reading', 'G R', 'books'),
    go('Reading library', '/reading?view=library', 'table', '', 'books all'),
    go('Insights', '/insights', 'insights', 'G S', 'analytics stats statistics time hours'),
    go('Time log', '/insights#time-log', 'clock', '', 'entries history edit'),
    go('Almanac', '/almanac', 'almanac', 'G A', 'streaks milestones challenge record'),
    go('Settings', '/settings', 'settings', '⌘ ,', 'preferences options'),
    go('Agents & MCP setup', '/settings/agents', 'sparkle', '', 'codex claude mcp cli sdk automation'),
    go('Planning settings', '/settings/planning', 'target', '', 'domains weekly plan deep target'),
    { group: 'App', label: 'Undo last change', icon: 'undo', shortcut: '⌘ Z', keywords: 'revert', run: () => undo() },
    { group: 'App', label: 'Redo', icon: 'redo', shortcut: '⇧ ⌘ Z', run: () => redo() },
    { group: 'App', label: 'Show activity', icon: 'activity', keywords: 'history log changes agent', run: () => { setPref('railOpen', true); setPref('railTab', 'activity'); } },
    { group: 'App', label: 'Ask Codex', icon: 'sparkle', keywords: 'agent assistant chat ai openai', run: () => { setPref('railOpen', true); setPref('railTab', 'agent'); setPref('railAgent', 'codex'); requestAnimationFrame(() => document.querySelector('.composer-input')?.focus()); } },
    { group: 'App', label: 'Ask Claude', icon: 'sparkle', keywords: 'agent assistant chat ai anthropic claude code', run: () => { setPref('railOpen', true); setPref('railTab', 'agent'); setPref('railAgent', 'claude'); requestAnimationFrame(() => document.querySelector('.composer-input')?.focus()); } },
    { group: 'App', label: 'Toggle dark mode', icon: 'moon', keywords: 'theme light appearance', run: () => act.cycleTheme() },
    { group: 'App', label: 'Use system theme', icon: 'sun', keywords: 'appearance automatic', run: () => act.setTheme('system') },
    { group: 'App', label: state.workspace.density === 'compact' ? 'Comfortable density' : 'Compact density', icon: 'sliders', keywords: 'spacing rows', run: () => run('workspace.update', { density: state.workspace.density === 'compact' ? 'comfortable' : 'compact' }, { quiet: true }) },
    { group: 'App', label: store.prefs.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar', icon: 'sidebar', shortcut: '⌘ \\', run: () => setPref('sidebarCollapsed', !store.prefs.sidebarCollapsed) },
    { group: 'App', label: store.prefs.railOpen ? 'Hide agent rail' : 'Show agent rail', icon: 'rail', run: () => setPref('railOpen', !store.prefs.railOpen) },
    { group: 'App', label: 'Back up now', icon: 'download', keywords: 'snapshot google drive', run: () => run('storage.backupNow', {}, { quiet: true }).then(() => toast('Snapshot written to your backup folder', { tone: 'quiet' })).catch(() => undefined) },
    { group: 'App', label: 'Reload data', icon: 'refresh', keywords: 'refresh sync', run: () => fetchState().then(() => toast('Data reloaded', { tone: 'quiet' })) },
    { group: 'App', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', keywords: 'help keys', run: () => showShortcuts() },
  ];
}

export function showShortcuts() {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog shortcuts-dialog';
  dialog.innerHTML = `<div class="dialog-inner">
    <header class="dialog-head"><h2>Keyboard shortcuts</h2><button type="button" class="icon-button" data-close aria-label="Close">✕</button></header>
    <div class="shortcuts-grid">${SHORTCUTS.map((group) => `<section><h3>${escapeHtml(group.group)}</h3><dl>${group.items.map(([keys, label]) => `<div><dt>${keys.split('  ').map((part) => part.split(' ').map((key) => (['then', 'or'].includes(key) ? `<span>${key}</span>` : `<kbd>${escapeHtml(key)}</kbd>`)).join('')).join('<span>·</span>')}</dt><dd>${escapeHtml(label)}</dd></div>`).join('')}</dl></section>`).join('')}</div>
  </div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target.closest('[data-close]')) dialog.close(); });
  dialog.showModal();
}

// Two-key "go to" sequences (G then a letter).
const GO = { h: '/today', t: '/tasks', i: '/tasks?list=inbox', u: '/tasks?list=next7', p: '/projects', c: '/creation', r: '/reading', s: '/insights', a: '/almanac' };
let pendingG = 0;

export function handleGlobalKey(event) {
  const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;
  if (mod && key.toLowerCase() === 'k') { event.preventDefault(); import('./ui/palette.js').then(({ openPalette }) => openPalette()); return true; }
  if (mod && key.toLowerCase() === 'j') { event.preventDefault(); toggleRail(); return true; }
  if (mod && key === '\\') { event.preventDefault(); setPref('sidebarCollapsed', !store.prefs.sidebarCollapsed); return true; }
  if (mod && key === ',') { event.preventDefault(); navigate('/settings'); return true; }
  if (typing) return false;
  if (mod && key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return true; }
  if (mod || event.altKey) return false;
  if (pendingG && Date.now() - pendingG < 1200) {
    pendingG = 0;
    const target = GO[key.toLowerCase()];
    if (target) { event.preventDefault(); navigate(target); return true; }
    return false;
  }
  if (key === 'g') { pendingG = Date.now(); return true; }
  if (key === 'n') { event.preventDefault(); openCapture({ kind: store.ui.route.section === 'creation' ? 'idea' : store.ui.route.section === 'reading' ? 'book' : store.ui.route.section === 'almanac' ? 'milestone' : 'task' }); return true; }
  if (key === 'l') { event.preventDefault(); openCapture({ kind: 'log' }); return true; }
  if (key === 't' && !store.ui.focusId) { event.preventDefault(); if (store.state.activeSession) toast('A timer is already running — stop it from the sidebar.', { tone: 'info' }); else openCapture({ kind: 'timer' }); return true; }
  if (key === '?') { event.preventDefault(); showShortcuts(); return true; }
  if (key === '/') {
    const filter = document.querySelector('[data-page-filter]');
    if (filter) { event.preventDefault(); filter.focus(); filter.select?.(); return true; }
  }
  return false;
}

export function toggleRail() {
  const open = !store.prefs.railOpen;
  setPref('railOpen', open);
  if (open) requestAnimationFrame(() => document.querySelector(store.prefs.railTab !== 'activity' ? '.composer-input' : '.rail')?.focus());
  render();
}
