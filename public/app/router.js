// Path routing: /today, /tasks?list=today, /projects/portia, /creation/<id>,
// /reading?view=library, /insights?range=month, /almanac, /settings/agents.
// Old ?tab= links from the previous interface still resolve.
import { render, store } from './store.js';

export const SECTIONS = ['today', 'tasks', 'projects', 'creation', 'reading', 'insights', 'almanac', 'settings'];
const listeners = new Set();

export function parseLocation(loc = location) {
  const url = new URL(loc.href);
  const params = url.searchParams;
  // Legacy query-string navigation.
  if (params.has('tab')) {
    const tab = params.get('tab') === 'analytics' ? 'insights' : params.get('tab');
    const next = new URLSearchParams();
    if (params.get('taskScope')) next.set('list', params.get('taskScope'));
    if (params.get('projectView') === 'kanban') next.set('view', 'board');
    if (params.get('view') === 'library') next.set('view', 'library');
    if (params.get('range')) next.set('range', params.get('range'));
    const idea = params.get('idea');
    return { section: SECTIONS.includes(tab) ? tab : null, id: idea || null, params: next, legacy: true };
  }
  const [section, ...rest] = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const resolved = section === 'analytics' ? 'insights' : section;
  return {
    section: SECTIONS.includes(resolved) ? resolved : null,
    id: rest.length ? decodeURIComponent(rest.join('/')) : null,
    params,
  };
}

export function href(section, id = null, params = null) {
  const query = params ? new URLSearchParams(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== '')) : null;
  return `/${section}${id ? `/${encodeURIComponent(id)}` : ''}${query && [...query].length ? `?${query}` : ''}`;
}

export function navigate(to, { replace = false, keepSheet = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) return;
  const target = `${url.pathname}${url.search}`;
  if (target !== `${location.pathname}${location.search}`) {
    history[replace ? 'replaceState' : 'pushState'](null, '', target);
  }
  applyLocation({ keepSheet });
}

export function setParams(patch, { replace = true } = {}) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  navigate(`${url.pathname}${url.search}`, { replace, keepSheet: true });
}

export function applyLocation({ keepSheet = false } = {}) {
  const parsed = parseLocation();
  const start = store.state?.workspace?.startScreen || 'projects';
  const route = { ...parsed, section: parsed.section || start };
  if (parsed.legacy) {
    history.replaceState(null, '', href(route.section, route.section === 'creation' ? route.id : null, Object.fromEntries(route.params)));
  }
  const changedSection = store.ui.route.section !== route.section || store.ui.route.id !== route.id;
  store.ui.route = route;
  if (changedSection) {
    store.ui.selection = new Set();
    store.ui.filter = '';
    if (!keepSheet) store.ui.sheet = null;
  }
  for (const listener of listeners) listener(route, { changedSection });
  render();
}

export function onRoute(listener) {
  listeners.add(listener);
}

export function interceptLinks(root) {
  root.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}`);
  });
  window.addEventListener('popstate', () => applyLocation());
}
