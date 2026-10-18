// ⌘K: go anywhere, find anything, do anything. Records, screens, saved views,
// settings and every action share one ranked list; → or Tab on a record opens
// its actions. Unmatched text becomes "Create task…" or "Ask Codex/Claude…".
import { escapeHtml } from '../dom.js';
import { fuzzyScore, IDEA_STATUS, PROJECT_STATUS, READING_STATUS } from '../format.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { lookup, store } from '../store.js';
import * as act from '../actions.js';
import { paletteActions } from '../commands-ui.js';
import { bookMenu, ideaMenu, projectMenu, taskMenu } from '../menus.js';
import { closeMenus } from './menu.js';

let root = null;
let state = null;

export function isPaletteOpen() {
  return Boolean(root);
}

export function openPalette(query = '') {
  closeMenus({ restoreFocus: false });
  state = { query, index: 0, results: [], returnFocus: document.activeElement };
  if (!root) mount();
  const input = root.querySelector('.palette-input');
  input.value = query;
  refresh();
  input.focus();
  input.select();
}

export function closePalette({ restore = true } = {}) {
  if (!root) return;
  const element = root;
  root = null;
  element.classList.add('is-leaving');
  setTimeout(() => element.remove(), 120);
  const back = state?.returnFocus;
  state = null;
  if (restore && back?.isConnected) back.focus({ preventScroll: true });
}

function mount() {
  root = document.createElement('div');
  root.className = 'palette-backdrop';
  root.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="palette-search">${icon('search', { size: 17 })}<input class="palette-input" type="text" placeholder="Search or type a command…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list"><kbd>esc</kbd></div>
    <div class="palette-list" id="palette-list" role="listbox"></div>
    <footer class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>→</kbd> actions</span><span><kbd>⌘</kbd><kbd>↵</kbd> create task</span></footer>
  </div>`;
  document.body.append(root);
  requestAnimationFrame(() => root?.classList.add('is-in'));
  const input = root.querySelector('.palette-input');
  input.addEventListener('input', () => { state.query = input.value; state.index = 0; refresh(); });
  input.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', (event) => { if (event.target === root) { event.preventDefault(); closePalette(); } });
  root.addEventListener('click', (event) => {
    const row = event.target.closest('[data-result]');
    if (row) choose(Number(row.dataset.result));
  });
  root.addEventListener('pointermove', (event) => {
    const row = event.target.closest('[data-result]');
    if (!row) return;
    const index = Number(row.dataset.result);
    if (index !== state.index) { state.index = index; paintSelection(); }
  });
}

function entityResults(query) {
  const s = store.state;
  const out = [];
  const add = (item, ...texts) => {
    const score = Math.max(...texts.filter(Boolean).map((text, position) => fuzzyScore(query, text) * (position === 0 ? 1 : 0.6)));
    if (score > 0) out.push({ ...item, score });
  };
  for (const project of s.projects) {
    add({ group: 'Projects', kind: 'project', id: project.id, label: project.name, sub: `${PROJECT_STATUS[project.status].label}${project.subtitle ? ` · ${project.subtitle}` : ''}`, swatch: s.domains[project.domain]?.color, run: () => act.openProject(project.id), menu: (anchor) => projectMenu(project.id, anchor) }, project.name, project.subtitle);
  }
  const names = new Map(s.projects.map((project) => [project.id, project.name]));
  for (const task of s.tasks.items) {
    if (task.trashedAt) continue;
    add({ group: 'Tasks', kind: 'task', id: task.id, label: task.title, sub: `${task.projectId ? names.get(task.projectId) : 'Inbox'}${task.status === 'completed' ? ' · completed' : ''}`, icon: task.status === 'completed' ? 'check' : 'circle', boost: task.status === 'completed' ? -60 : 0, run: () => act.openRecord('task', task.id), menu: (anchor) => taskMenu(task.id, anchor) }, task.title, task.tags.join(' '));
  }
  for (const book of s.reading.books) {
    add({ group: 'Books', kind: 'book', id: book.id, label: book.title, sub: `${book.authors.join(', ')} · ${READING_STATUS[book.status]}`, icon: 'reading', run: () => act.openRecord('book', book.id), menu: (anchor) => bookMenu(book.id, anchor) }, book.title, book.authors.join(' '));
  }
  for (const idea of s.creation.ideas) {
    add({ group: 'Ideas', kind: 'idea', id: idea.id, label: idea.title, sub: `${idea.type === 'long_video' ? 'Long video' : idea.type === 'short' ? 'Short' : idea.type} · ${IDEA_STATUS[idea.status]}`, icon: 'creation', run: () => act.openIdea(idea.id), menu: (anchor) => ideaMenu(idea.id, anchor) }, idea.title);
  }
  for (const view of s.workspace.views) {
    add({ group: 'Views', kind: 'view', id: view.id, label: view.name, sub: 'Saved task view', icon: view.icon || 'list', run: () => navigate(`/tasks?list=view:${encodeURIComponent(view.id)}`) }, view.name);
  }
  return out.map((item) => ({ ...item, score: item.score + (item.boost || 0) }));
}

function recentResults() {
  const out = [];
  for (const entry of store.prefs.recent.slice(0, 6)) {
    if (entry.kind === 'project') { const project = lookup.project(entry.id); if (project) out.push({ group: 'Recent', label: project.name, sub: 'Project', swatch: store.state.domains[project.domain]?.color, run: () => act.openProject(project.id), menu: (anchor) => projectMenu(project.id, anchor) }); }
    if (entry.kind === 'task') { const task = lookup.task(entry.id); if (task && !task.trashedAt) out.push({ group: 'Recent', label: task.title, sub: 'Task', icon: 'tasks', run: () => act.openRecord('task', task.id), menu: (anchor) => taskMenu(task.id, anchor) }); }
    if (entry.kind === 'book') { const book = lookup.book(entry.id); if (book) out.push({ group: 'Recent', label: book.title, sub: 'Book', icon: 'reading', run: () => act.openRecord('book', book.id) }); }
    if (entry.kind === 'idea') { const idea = lookup.idea(entry.id); if (idea) out.push({ group: 'Recent', label: idea.title, sub: 'Idea', icon: 'creation', run: () => act.openIdea(idea.id) }); }
  }
  return out;
}

function refresh() {
  const query = state.query.trim();
  const actions = paletteActions();
  let results;
  if (!query) {
    results = [
      ...recentResults(),
      ...actions.filter((action) => action.suggested).map((action) => ({ ...action, group: 'Suggestions' })),
    ];
  } else {
    const scoredActions = actions
      .map((action) => ({ ...action, group: action.group || 'Actions', score: Math.max(fuzzyScore(query, action.label), fuzzyScore(query, action.keywords || '') * 0.7) + (action.weight || 0) }))
      .filter((action) => action.score > 0);
    const entities = entityResults(query);
    const all = [...entities, ...scoredActions].sort((a, b) => b.score - a.score);
    // Keep the best few per group, ordered by each group's best match.
    const groups = new Map();
    for (const item of all) {
      const list = groups.get(item.group) || [];
      if (list.length < (item.group === 'Tasks' ? 8 : 6)) list.push(item);
      groups.set(item.group, list);
    }
    results = [...groups.values()].flat();
    results.push(
      { group: 'Create', label: `Create task “${query}”`, icon: 'plus', run: () => import('./capture.js').then(({ openCapture }) => openCapture({ kind: 'task', text: query })) },
      { group: 'Create', label: `Ask ${store.prefs.railAgent === 'claude' ? 'Claude' : 'Codex'}: “${query}”`, icon: 'sparkle', run: () => import('../rail.js').then(({ askAgent }) => askAgent(query)) },
    );
  }
  state.results = results;
  state.index = Math.min(state.index, Math.max(0, results.length - 1));
  paint();
}

function paint() {
  const list = root.querySelector('.palette-list');
  let lastGroup = null;
  list.innerHTML = state.results.map((item, index) => {
    const header = item.group !== lastGroup ? `<div class="palette-group">${escapeHtml(item.group)}</div>` : '';
    lastGroup = item.group;
    return `${header}<div class="palette-row ${index === state.index ? 'is-active' : ''}" data-result="${index}" role="option" aria-selected="${String(index === state.index)}" id="palette-row-${index}">
      <span class="palette-icon">${item.swatch ? `<i class="menu-swatch" style="--swatch:${escapeHtml(item.swatch)}"></i>` : icon(item.icon || 'arrow-right', { size: 15 })}</span>
      <span class="palette-label">${escapeHtml(item.label)}${item.sub ? `<small>${escapeHtml(item.sub)}</small>` : ''}</span>
      ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}
      ${item.menu ? `<span class="palette-more" title="Actions (→)">${icon('chevron-right', { size: 14 })}</span>` : ''}
    </div>`;
  }).join('') || '<div class="palette-empty">No matches</div>';
  paintSelection();
}

function paintSelection() {
  root.querySelectorAll('.palette-row').forEach((row) => {
    const active = Number(row.dataset.result) === state.index;
    row.classList.toggle('is-active', active);
    row.setAttribute('aria-selected', String(active));
    if (active) row.scrollIntoView({ block: 'nearest' });
  });
  root.querySelector('.palette-input').setAttribute('aria-activedescendant', `palette-row-${state.index}`);
}

function choose(index) {
  const item = state.results[index];
  if (!item) return;
  closePalette({ restore: false });
  item.run?.();
}

function onKey(event) {
  if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
    event.preventDefault();
    state.index = (state.index + 1) % Math.max(1, state.results.length);
    paintSelection();
  } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
    event.preventDefault();
    state.index = (state.index - 1 + state.results.length) % Math.max(1, state.results.length);
    paintSelection();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      const text = state.query.trim();
      closePalette({ restore: false });
      if (text) import('./capture.js').then(({ openCapture }) => openCapture({ kind: 'task', text }));
      return;
    }
    choose(state.index);
  } else if ((event.key === 'ArrowRight' && event.target.selectionStart === event.target.value.length) || event.key === 'Tab') {
    const item = state.results[state.index];
    if (!item?.menu) return;
    event.preventDefault();
    const row = root.querySelector(`[data-result="${state.index}"]`);
    const rect = row.getBoundingClientRect();
    const anchor = { x: rect.right - 12, y: rect.top };
    closePalette({ restore: false });
    item.menu(anchor);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closePalette();
  }
}
