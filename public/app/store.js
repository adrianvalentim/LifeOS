// Client state: the server's derived view model plus ephemeral UI state.
// Renders are batched into one animation frame. Preferences that belong to
// this browser (view options, collapsed panels) persist in localStorage.

const PREFS_KEY = 'lifeos.ui.v2';

const defaults = () => ({
  sidebarCollapsed: false,
  railOpen: true,
  railTab: 'agent',
  railAgent: 'codex',
  railWidth: 360,
  tasks: { groupBy: 'none', sortBy: 'manual', showCompleted: false, collapsed: {} },
  projects: { view: 'list', focus: 'all', sort: 'health', collapsedGroups: {} },
  reading: { view: 'board', status: 'all', tag: 'all', sort: { key: 'status', dir: 'asc' } },
  creation: { view: 'board', type: 'all', status: 'all', sort: 'manual', split: true },
  insights: { range: 'week' },
  recent: [],
});

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const base = defaults();
    for (const key of Object.keys(base)) {
      if (saved[key] === undefined) continue;
      base[key] = typeof base[key] === 'object' && !Array.isArray(base[key]) ? { ...base[key], ...saved[key] } : saved[key];
    }
    return base;
  } catch {
    return defaults();
  }
}

export const store = {
  state: null,          // derived server state (includes .workspace)
  prefs: typeof localStorage !== 'undefined' ? loadPrefs() : defaults(),
  ui: {
    route: { section: 'projects', id: null, params: new URLSearchParams() },
    sheet: null,        // { kind: 'task'|'book'|'entry', id }
    palette: null,      // { query, index, mode }
    capture: null,      // { kind, text, ignore:Set, ... }
    menu: null,
    dialog: null,
    toasts: [],
    selection: new Set(),
    focusId: null,
    pending: new Set(), // record ids with a write in flight
    error: null,
    history: [],
    historyLoaded: false,
    connection: 'connecting',
    drafts: {},
    filter: '',
    addingSubtaskTo: null,
    editing: null,
  },
  listeners: new Set(),
};

// Renders batch into one animation frame. A hidden or throttled window gets
// no frames, so a short timer backs each frame up: changes made by agents
// still land while LifeOS is in the background.
let frame = 0;
let timer = 0;
function flush() {
  if (frame) cancelAnimationFrame(frame);
  clearTimeout(timer);
  frame = 0;
  timer = 0;
  for (const listener of store.listeners) listener();
}
export function render() {
  if (frame || timer) return;
  timer = setTimeout(flush, typeof document !== 'undefined' && document.hidden ? 16 : 120);
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush);
}
export function renderNow() {
  flush();
}

export function subscribe(listener) {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

export function setState(next) {
  if (!next) return;
  const workspace = next.workspace || store.state?.workspace;
  store.state = { ...next, workspace };
  render();
}

export function setWorkspace(workspace) {
  if (!store.state || !workspace) return;
  store.state = { ...store.state, workspace };
  applyAppearance(workspace);
  render();
}

export function patchUi(patch) {
  Object.assign(store.ui, patch);
  render();
}

export function setPref(path, value) {
  const keys = path.split('.');
  let target = store.prefs;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  target[keys.at(-1)] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(store.prefs)); } catch { /* optional */ }
  render();
}

export function rememberRecent(item) {
  const list = store.prefs.recent.filter((entry) => !(entry.kind === item.kind && entry.id === item.id));
  list.unshift({ kind: item.kind, id: item.id });
  setPref('recent', list.slice(0, 12));
}

export function applyAppearance(workspace) {
  const root = document.documentElement;
  root.dataset.themeMode = workspace?.theme?.mode || 'system';
  root.dataset.density = workspace?.density || 'comfortable';
  if (workspace?.theme?.accent) root.dataset.accent = workspace.theme.accent;
  else delete root.dataset.accent;
  root.style.setProperty('--accent-custom', workspace?.theme?.accent || '');
}

// Convenience lookups over the derived state.
export const lookup = {
  project: (id) => store.state?.projects.find((project) => project.id === id) || null,
  task: (id) => store.state?.tasks.items.find((task) => task.id === id) || null,
  book: (id) => store.state?.reading.books.find((book) => book.id === id) || null,
  idea: (id) => store.state?.creation.ideas.find((idea) => idea.id === id) || null,
  domain: (id) => store.state?.domains[id] || null,
};
