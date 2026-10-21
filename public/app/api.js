// The browser's only path to LifeOS data: named commands (the same ones agents
// use), optimistic updates with rollback, Undo toasts, and live events.
import { render, setState, setWorkspace, store } from './store.js';
import { toast } from './ui/toast.js';

let lastMtime = 0;
let refreshTimer = 0;
const eventHandlers = new Map();

export async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    // WebKit reports an unreachable server only as "Load failed".
    throw Object.assign(new Error('LifeOS couldn’t reach its local server. Try again in a moment; if it keeps failing, use Refresh LifeOS (⌘R).'), { cause: error, code: 'unreachable' });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `LifeOS request failed (${response.status}).`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }
  return body;
}

export const postJson = (url, body) => request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export async function fetchState() {
  const range = store.prefs.insights.range || 'week';
  const state = await request(`/api/state?range=${encodeURIComponent(range)}`);
  if (state.storeMtime) lastMtime = Math.max(lastMtime, state.storeMtime);
  setState(state);
  return state;
}

export function scheduleRefresh(delay = 120) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    fetchState().catch((error) => toast(error.message, { tone: 'error' }));
  }, delay);
}

/**
 * Run a LifeOS command.
 * @param {string} name
 * @param {object} input
 * @param {{ optimistic?: (state) => any, pending?: string[], undo?: boolean, quiet?: boolean, success?: string }} options
 */
export async function run(name, input = {}, options = {}) {
  const { optimistic, pending = [], undo = true, quiet = false, success } = options;
  const before = store.state;
  if (optimistic && before) {
    try {
      const next = optimistic(before);
      if (next) { store.state = next; render(); }
    } catch (error) {
      console.warn('Optimistic update skipped', error);
    }
  }
  for (const id of pending) store.ui.pending.add(id);
  if (pending.length) render();
  try {
    const body = await postJson(`/api/run/${name}?state=1`, input);
    if (body.state) {
      if (body.state.storeMtime) lastMtime = Math.max(lastMtime, body.state.storeMtime);
      setState(body.state);
    } else if (body.workspace) {
      setWorkspace(body.workspace);
    } else if (optimistic && store.state !== before) {
      // A command without returned state still changed records; confirm them.
      scheduleRefresh(0);
    }
    if (!quiet && body.operationId) {
      toast(success || body.label, undo ? { undo: body.operationId } : {});
    }
    if (body.operationId) store.ui.lastOperation = body.operationId;
    return body.result;
  } catch (error) {
    if (optimistic && before) {
      store.state = before;
      render();
    }
    if (!options.silentError) toast(error.message, { tone: 'error' });
    throw error;
  } finally {
    for (const id of pending) store.ui.pending.delete(id);
    if (pending.length) render();
  }
}

export async function undo(operationId) {
  try {
    const body = await postJson('/api/run/history.undo?state=1', operationId ? { operationId } : { source: 'app' });
    if (body.state) setState(body.state);
    if (body.result?.workspace) setWorkspace(body.result.workspace);
    toast(body.label || 'Undone', { tone: 'quiet', redo: true });
  } catch (error) {
    toast(error.message, { tone: 'error' });
  }
}

export async function redo() {
  try {
    const body = await postJson('/api/run/history.redo?state=1', {});
    if (body.state) setState(body.state);
    if (body.result?.workspace) setWorkspace(body.result.workspace);
    toast(body.label || 'Redone', { tone: 'quiet', undo: body.operationId });
  } catch (error) {
    toast(error.message, { tone: 'error' });
  }
}

export function onEvent(type, handler) {
  eventHandlers.set(type, handler);
}

export function connectEvents() {
  let source;
  let retry = 1000;
  let retryTimer = 0;
  const open = () => {
    clearTimeout(retryTimer);
    source?.close();
    const current = new EventSource('/api/events');
    source = current;
    current.addEventListener('ready', () => {
      retry = 1000;
      if (store.ui.connection !== 'live') {
        // Records may have changed while the server was away.
        const wasDown = store.ui.connection !== 'connecting';
        store.ui.connection = 'live';
        if (wasDown) scheduleRefresh(0);
        render();
      }
    });
    current.addEventListener('lifeos', (event) => {
      let payload = {};
      try { payload = JSON.parse(event.data); } catch { /* ignore */ }
      if (payload.mtime && payload.mtime <= lastMtime) return;
      scheduleRefresh();
    });
    for (const type of ['history', 'workspace', 'ui', 'codex', 'claude']) {
      current.addEventListener(type, (event) => {
        let payload = {};
        try { payload = JSON.parse(event.data); } catch { return; }
        eventHandlers.get(type)?.(payload);
      });
    }
    current.addEventListener('error', () => {
      if (source !== current) return;
      if (current.readyState === EventSource.CLOSED) {
        store.ui.connection = 'offline';
        render();
        retryTimer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 15000);
      } else if (store.ui.connection === 'live') {
        store.ui.connection = 'reconnecting';
        render();
      }
    });
  };
  open();
  // A window that sat hidden while its server restarted may wait a long time
  // for WebKit's own retry; coming back to it reconnects at once.
  const reconnectNow = () => {
    if (document.visibilityState !== 'visible' || store.ui.connection === 'live') return;
    retry = 1000;
    open();
  };
  document.addEventListener('visibilitychange', reconnectNow);
  window.addEventListener('focus', reconnectNow);
}

let presenceTimer = 0;
export function reportPresence(presence) {
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    postJson('/api/ui/presence', presence).catch(() => undefined);
  }, 250);
}

// Small immutable helpers for optimistic updates.
export const optimistic = {
  task(state, id, patch) {
    return {
      ...state,
      tasks: {
        ...state.tasks,
        items: state.tasks.items.map((task) => (task.id === id ? { ...task, ...(typeof patch === 'function' ? patch(task) : patch) } : task)),
      },
    };
  },
  tasks(state, ids, patch) {
    const set = new Set(ids);
    return {
      ...state,
      tasks: { ...state.tasks, items: state.tasks.items.map((task) => (set.has(task.id) ? { ...task, ...(typeof patch === 'function' ? patch(task) : patch) } : task)) },
    };
  },
  project(state, id, patch) {
    return { ...state, projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch } : project)) };
  },
  book(state, id, patch) {
    return { ...state, reading: { ...state.reading, books: state.reading.books.map((book) => (book.id === id ? { ...book, ...patch } : book)) } };
  },
  idea(state, id, patch) {
    return { ...state, creation: { ...state.creation, ideas: state.creation.ideas.map((idea) => (idea.id === id ? { ...idea, ...patch } : idea)) } };
  },
};
