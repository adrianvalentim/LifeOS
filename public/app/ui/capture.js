// Quick capture — one box for everything you might add (press N anywhere).
// Text is parsed live ("Call Ana fri 3pm !high #calls @Portia"); recognized
// pieces are highlighted in place and listed as chips you can dismiss. Field
// buttons do the same without any syntax. Defaults come from where you are.
import { escapeHtml } from '../dom.js';
import { ACTIVITY_LABELS, formatDate, formatTime, normalize, relativeDay } from '../format.js';
import { icon } from '../icons.js';
import { activeTrigger, formatDuration, parseCapture, tokenFor } from '../nlp.js';
import { lookup, store } from '../store.js';
import * as act from '../actions.js';
import { run } from '../api.js';
import { closeMenus, isMenuOpen } from './menu.js';
import { knownTags, pickDate, pickFromList, pickPriority, pickProject, pickTags } from './pickers.js';

const KINDS = [
  { id: 'task', label: 'Task', icon: 'tasks', placeholder: 'Add a task — try “Draft outline fri 3pm !high #writing @Portia”' },
  { id: 'log', label: 'Log time', icon: 'clock', placeholder: '“1h 30m Vulcano color pass ~creative yesterday”' },
  { id: 'timer', label: 'Start timer', icon: 'play', placeholder: 'What are you about to focus on? “@Portia rewrite act III”' },
  { id: 'idea', label: 'Idea', icon: 'creation', placeholder: 'A question, story or spark — add a date to schedule a Short' },
  { id: 'project', label: 'Project', icon: 'projects', placeholder: 'Name the project — add a deadline like “dec 1”' },
  { id: 'book', label: 'Book', icon: 'reading', placeholder: 'Title, author or ISBN to look up' },
  { id: 'milestone', label: 'Milestone', icon: 'star', placeholder: 'Something worth remembering you achieved' },
];

let root = null;
let state = null;

export function isCaptureOpen() {
  return Boolean(root);
}

function contextDefaults() {
  const route = store.ui.route;
  const defaults = {};
  if (route.section === 'tasks') {
    const list = route.params.get('list') || 'all';
    if (list.startsWith('project:')) defaults.projectId = list.slice(8);
    if (list === 'inbox') defaults.projectId = null;
    if (list === 'today') defaults.dueDate = store.state.meta.today;
    if (list.startsWith('tag:')) defaults.tags = [list.slice(4)];
    if (list.startsWith('view:')) {
      const view = store.state.workspace.views.find((item) => item.id === list.slice(5));
      if (view?.filter.projects.length === 1) defaults.projectId = view.filter.projects[0] === 'inbox' ? null : view.filter.projects[0];
      if (view?.filter.tags.length) defaults.tags = [...view.filter.tags];
    }
  }
  if (route.section === 'projects' && route.id) defaults.projectId = route.id;
  if (route.section === 'today') defaults.dueDate = store.state.meta.today;
  return defaults;
}

function kindForRoute() {
  const section = store.ui.route.section;
  if (section === 'creation') return 'idea';
  if (section === 'reading') return 'book';
  if (section === 'almanac') return 'milestone';
  return 'task';
}

export function openCapture({ kind = null, text = '', projectId, dueDate, tags } = {}) {
  closeMenus({ restoreFocus: false });
  const defaults = contextDefaults();
  if (projectId !== undefined) defaults.projectId = projectId;
  if (dueDate !== undefined) defaults.dueDate = dueDate;
  if (tags !== undefined) defaults.tags = tags;
  state = {
    kind: kind || kindForRoute(),
    text,
    ignore: new Set(),
    overrides: {},
    defaults,
    suggest: null,
    busy: false,
    returnFocus: document.activeElement,
  };
  if (!root) mount();
  paint();
  const input = root.querySelector('.capture-input');
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

export function closeCapture() {
  if (!root) return;
  root.classList.add('is-leaving');
  const element = root;
  root = null;
  setTimeout(() => element.remove(), 140);
  const back = state?.returnFocus;
  state = null;
  if (back?.isConnected) back.focus({ preventScroll: true });
}

function mount() {
  root = document.createElement('div');
  root.className = 'capture-backdrop';
  root.innerHTML = `<div class="capture" role="dialog" aria-modal="true" aria-label="Quick capture">
    <div class="capture-kinds" role="tablist"></div>
    <div class="capture-field">
      <div class="capture-mirror" aria-hidden="true"></div>
      <textarea class="capture-input" rows="1" spellcheck="true" autocomplete="off" aria-label="What do you want to add?"></textarea>
    </div>
    <div class="capture-suggest" role="listbox" hidden></div>
    <div class="capture-chips"></div>
    <div class="capture-fields"></div>
    <footer class="capture-foot"></footer>
  </div>`;
  document.body.append(root);
  requestAnimationFrame(() => root?.classList.add('is-in'));
  const input = root.querySelector('.capture-input');
  root.addEventListener('pointerdown', (event) => {
    if (event.target === root) { event.preventDefault(); closeCapture(); }
  });
  input.addEventListener('input', () => {
    state.text = input.value;
    updateSuggest(input);
    paint({ keepInput: true });
  });
  input.addEventListener('keyup', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { updateSuggest(input); paintSuggest(); }
  });
  input.addEventListener('click', () => { updateSuggest(input); paintSuggest(); });
  input.addEventListener('scroll', () => { root.querySelector('.capture-mirror').scrollTop = input.scrollTop; });
  input.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
}

function parsed() {
  const projects = store.state.projects;
  return parseCapture(state.text, { today: store.state.meta.today, projects, mode: state.kind, ignore: state.ignore });
}

function resolved() {
  const p = parsed();
  const o = state.overrides;
  const d = state.defaults;
  const pick = (key, parsedValue) => (key in o ? o[key] : parsedValue !== null && parsedValue !== undefined && !(Array.isArray(parsedValue) && !parsedValue.length) ? parsedValue : d[key]);
  return {
    parsed: p,
    title: p.title,
    projectId: 'projectId' in o ? o.projectId : p.projectId !== null ? p.projectId : d.projectId,
    dueDate: pick('dueDate', p.dueDate),
    startTime: pick('startTime', p.startTime),
    priority: pick('priority', p.priority) || 'none',
    tags: [...new Set([...(d.tags || []), ...p.tags, ...(o.tags || [])])],
    durationMinutes: pick('durationMinutes', p.durationMinutes),
    activityType: pick('activityType', p.activityType),
    ideaType: o.ideaType || 'short',
    domain: o.domain,
  };
}

function paint({ keepInput = false } = {}) {
  if (!root) return;
  const kind = KINDS.find((item) => item.id === state.kind);
  const r = resolved();
  root.querySelector('.capture-kinds').innerHTML = KINDS.map((item, index) => `
    <button type="button" role="tab" class="capture-kind ${item.id === state.kind ? 'is-active' : ''}" data-kind="${item.id}" aria-selected="${String(item.id === state.kind)}" title="${escapeHtml(item.label)} · ⌘${index + 1}">
      ${icon(item.icon, { size: 14 })}<span>${escapeHtml(item.label)}</span></button>`).join('');
  const input = root.querySelector('.capture-input');
  if (!keepInput) input.value = state.text;
  input.placeholder = kind.placeholder;
  autosize(input);
  root.querySelector('.capture-mirror').innerHTML = mirrorHtml(state.text, r.parsed.tokens);
  root.querySelector('.capture-chips').innerHTML = chipsHtml(r);
  root.querySelector('.capture-fields').innerHTML = fieldsHtml(r);
  root.querySelector('.capture-foot').innerHTML = footHtml(r);
  paintSuggest();
}

function autosize(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(160, input.scrollHeight)}px`;
}

function mirrorHtml(text, tokens) {
  let out = '';
  let cursor = 0;
  for (const token of tokens.filter((item) => !item.inferred && item.start !== undefined).sort((a, b) => a.start - b.start)) {
    out += escapeHtml(text.slice(cursor, token.start));
    out += `<mark class="tok tok-${token.type}">${escapeHtml(text.slice(token.start, token.end))}</mark>`;
    cursor = token.end;
  }
  out += escapeHtml(text.slice(cursor));
  return `${out}​`;
}

function chip(type, label, key, iconName, tone = '') {
  return `<span class="cap-chip cap-${type} ${tone}">${icon(iconName, { size: 13 })}<span>${escapeHtml(label)}</span>${key ? `<button type="button" data-unparse="${escapeHtml(key)}" aria-label="Keep “${escapeHtml(label)}” as text">${icon('x', { size: 11 })}</button>` : ''}</span>`;
}

function chipsHtml(r) {
  const today = store.state.meta.today;
  const parts = [];
  for (const token of r.parsed.tokens) {
    const key = token.inferred ? `project:inferred` : token.key;
    if (token.type === 'date') parts.push(chip('date', `${relativeDay(token.value, today)} · ${formatDate(token.value, { today })}`, key, 'calendar'));
    if (token.type === 'time') parts.push(chip('time', formatTime(token.value), key, 'clock'));
    if (token.type === 'priority') parts.push(chip('priority', token.label, key, 'flag', `prio-${token.value}`));
    if (token.type === 'tag') parts.push(chip('tag', token.value, key, 'hash'));
    if (token.type === 'project') parts.push(chip('project', token.label, token.inferred ? 'inferred-project' : key, 'projects'));
    if (token.type === 'duration') parts.push(chip('duration', formatDuration(token.value), key, 'timer'));
    if (token.type === 'activity') parts.push(chip('activity', ACTIVITY_LABELS[token.value], key, 'bolt'));
  }
  return parts.join('');
}

function fieldButton(field, iconName, label, active, tone = '') {
  return `<button type="button" class="cap-field ${active ? 'is-set' : ''} ${tone}" data-field="${field}">${icon(iconName, { size: 14 })}<span>${escapeHtml(label)}</span></button>`;
}

function fieldsHtml(r) {
  const today = store.state.meta.today;
  const project = r.projectId ? lookup.project(r.projectId) : null;
  const projectLabel = project ? project.name : r.projectId === null ? 'Inbox' : state.kind === 'log' || state.kind === 'timer' ? 'No project' : 'Inbox';
  const fields = [];
  if (['task', 'log', 'timer'].includes(state.kind)) fields.push(fieldButton('project', project ? 'projects' : 'inbox', projectLabel, Boolean(project)));
  if (state.kind === 'task') {
    fields.push(fieldButton('date', 'calendar', r.dueDate ? `${relativeDay(r.dueDate, today)}${r.startTime ? ` ${formatTime(r.startTime)}` : ''}` : 'Date', Boolean(r.dueDate)));
    fields.push(fieldButton('priority', 'flag', r.priority !== 'none' ? `${r.priority[0].toUpperCase()}${r.priority.slice(1)}` : 'Priority', r.priority !== 'none', `prio-${r.priority}`));
    fields.push(fieldButton('tags', 'hash', r.tags.length ? r.tags.join(', ') : 'Tags', r.tags.length > 0));
  }
  if (state.kind === 'log') {
    fields.push(fieldButton('duration', 'timer', r.durationMinutes ? formatDuration(r.durationMinutes) : 'Duration', Boolean(r.durationMinutes)));
    fields.push(fieldButton('activity', 'bolt', r.activityType ? ACTIVITY_LABELS[r.activityType] : 'Type: auto', Boolean(r.activityType)));
    fields.push(fieldButton('date', 'calendar', r.dueDate ? relativeDay(r.dueDate, today) : 'Today', Boolean(r.dueDate)));
  }
  if (state.kind === 'timer') fields.push(fieldButton('activity', 'bolt', r.activityType ? ACTIVITY_LABELS[r.activityType] : 'Type: auto', Boolean(r.activityType)));
  if (state.kind === 'idea') {
    fields.push(fieldButton('ideaType', 'film', r.ideaType === 'short' ? 'Short' : r.ideaType === 'long_video' ? 'Long video' : r.ideaType, true));
    fields.push(fieldButton('date', 'calendar', r.dueDate ? relativeDay(r.dueDate, today) : 'Date', Boolean(r.dueDate)));
  }
  if (state.kind === 'project') {
    const domain = store.state.domains[r.domain || Object.keys(store.state.domains)[0]];
    fields.push(fieldButton('domain', 'layers', domain?.label || 'Domain', Boolean(r.domain)));
    fields.push(fieldButton('date', 'flag', r.dueDate ? `Due ${formatDate(r.dueDate, { today })}` : 'Deadline', Boolean(r.dueDate)));
  }
  if (state.kind === 'milestone') fields.push(fieldButton('date', 'calendar', r.dueDate ? formatDate(r.dueDate, { today }) : 'Today', Boolean(r.dueDate)));
  return fields.join('');
}

function footHtml(r) {
  const ready = Boolean(r.title.trim()) && !(state.kind === 'log' && !r.durationMinutes);
  const verb = { task: 'Add task', log: 'Log time', timer: 'Start timer', idea: 'Add idea', project: 'Create project', book: 'Search books', milestone: 'Record milestone' }[state.kind];
  const hint = state.kind === 'task' ? '#tag  @project  !high  fri 3pm  for 30m'
    : state.kind === 'log' ? '2h 15m  @project  ~creative  yesterday'
      : state.kind === 'timer' ? '@project  ~deep' : state.kind === 'idea' ? 'Dated Shorts appear in Tasks' : '';
  return `<span class="capture-hint">${escapeHtml(hint)}</span>
    <span class="capture-keys">${['task', 'idea', 'milestone'].includes(state.kind) ? '<span><kbd>⇧</kbd><kbd>↵</kbd> add another</span>' : ''}<span><kbd>⌘</kbd><kbd>↵</kbd> ${state.kind === 'book' ? 'add manually' : 'add & open'}</span></span>
    <button type="button" class="button is-primary" data-submit ${ready && !state.busy ? '' : 'disabled'}>${escapeHtml(state.busy ? 'Saving…' : verb)} <kbd>↵</kbd></button>`;
}

function updateSuggest(input) {
  if (!['task', 'log', 'timer'].includes(state.kind)) { state.suggest = null; return; }
  const trigger = activeTrigger(input.value, input.selectionStart);
  if (!trigger) { state.suggest = null; return; }
  const needle = normalize(trigger.query);
  let options;
  if (trigger.trigger === '@') {
    options = [{ value: 'inbox', label: 'Inbox', icon: 'inbox' }, ...store.state.projects
      .filter((project) => !['done', 'dropped'].includes(project.status))
      .map((project) => ({ value: project.name, label: project.name, swatch: store.state.domains[project.domain]?.color }))]
      .filter((option) => !needle || normalize(option.label).includes(needle)).slice(0, 7);
  } else {
    options = knownTags().map((tag) => ({ value: tag.label, label: tag.label, icon: 'hash', hint: tag.count ? String(tag.count) : '' }))
      .filter((option) => !needle || normalize(option.label).includes(needle)).slice(0, 7);
    if (trigger.query && !options.some((option) => normalize(option.label) === needle)) options.push({ value: trigger.query, label: `New tag “${trigger.query}”`, icon: 'plus' });
  }
  // A complete, exact match needs no menu; Enter should submit.
  if (needle && options.some((option) => normalize(option.value) === needle && !String(option.label).startsWith('New tag'))) options = [];
  state.suggest = options.length ? { ...trigger, options, index: Math.min(state.suggest?.index || 0, options.length - 1) } : null;
}

function paintSuggest() {
  const box = root?.querySelector('.capture-suggest');
  if (!box) return;
  if (!state.suggest) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const field = root.querySelector('.capture-field');
  box.style.top = `${field.offsetTop + field.offsetHeight + 2}px`;
  box.innerHTML = state.suggest.options.map((option, index) => `
    <button type="button" class="suggest-item ${index === state.suggest.index ? 'is-active' : ''}" data-suggest="${index}" role="option" aria-selected="${String(index === state.suggest.index)}">
      ${option.swatch ? `<i class="menu-swatch" style="--swatch:${escapeHtml(option.swatch)}"></i>` : icon(option.icon || 'dot', { size: 14 })}
      <span>${escapeHtml(option.label)}</span>${option.hint ? `<small>${escapeHtml(option.hint)}</small>` : ''}</button>`).join('');
}

function acceptSuggest(index = state.suggest.index) {
  const option = state.suggest.options[index];
  const input = root.querySelector('.capture-input');
  const { start, trigger } = state.suggest;
  const caret = input.selectionStart;
  const insertion = `${tokenFor(trigger, option.value)} `;
  state.text = `${state.text.slice(0, start)}${insertion}${state.text.slice(caret).replace(/^\s+/, '')}`;
  state.suggest = null;
  input.value = state.text;
  const position = start + insertion.length;
  input.setSelectionRange(position, position);
  paint({ keepInput: true });
}

function onKey(event) {
  if (state.suggest) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = state.suggest.options.length;
      state.suggest.index = (state.suggest.index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      paintSuggest();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      acceptSuggest();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      state.suggest = null;
      paintSuggest();
      return;
    }
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (isMenuOpen()) return;
    closeCapture();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && /^[1-7]$/.test(event.key)) {
    event.preventDefault();
    switchKind(KINDS[Number(event.key) - 1].id);
    return;
  }
  if (event.key === 'Tab' && !event.shiftKey && !state.text.trim()) {
    event.preventDefault();
    const index = KINDS.findIndex((item) => item.id === state.kind);
    switchKind(KINDS[(index + 1) % KINDS.length].id);
    return;
  }
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    void submit({ keepOpen: event.shiftKey, open: event.metaKey || event.ctrlKey });
  }
}

function switchKind(kind) {
  state.kind = kind;
  state.ignore = new Set();
  state.suggest = null;
  paint();
  root.querySelector('.capture-input').focus();
}

function onClick(event) {
  const kind = event.target.closest('[data-kind]');
  if (kind) { switchKind(kind.dataset.kind); return; }
  const unparse = event.target.closest('[data-unparse]');
  if (unparse) {
    const key = unparse.dataset.unparse;
    if (key === 'inferred-project') state.overrides.projectId = null;
    else state.ignore.add(key);
    paint();
    root.querySelector('.capture-input').focus();
    return;
  }
  const suggestion = event.target.closest('[data-suggest]');
  if (suggestion) { acceptSuggest(Number(suggestion.dataset.suggest)); root.querySelector('.capture-input').focus(); return; }
  if (event.target.closest('[data-submit]')) { void submit({}); return; }
  const field = event.target.closest('[data-field]');
  if (field) openField(field.dataset.field, field);
}

function openField(field, anchor) {
  const r = resolved();
  const refocus = () => { paint(); root?.querySelector('.capture-input')?.focus(); };
  if (field === 'project') {
    pickProject({ anchor, value: r.projectId ?? null, allowInbox: true, title: state.kind === 'task' ? 'List' : 'Project', onPick: (value) => { state.overrides.projectId = value; refocus(); } });
  } else if (field === 'date') {
    pickDate({
      anchor, value: r.dueDate,
      onPick: (value) => { state.overrides.dueDate = value; if (!value) state.overrides.startTime = null; refocus(); },
      ...(state.kind === 'task' ? { time: r.startTime, onTime: (value) => { state.overrides.startTime = value; if (value && !r.dueDate) state.overrides.dueDate = store.state.meta.today; refocus(); } } : {}),
    });
  } else if (field === 'priority') {
    pickPriority({ anchor, value: r.priority, onPick: (value) => { state.overrides.priority = value; refocus(); } });
  } else if (field === 'tags') {
    pickTags({ anchor, value: state.overrides.tags || [], onChange: (tags) => { state.overrides.tags = tags; paint(); } });
  } else if (field === 'duration') {
    pickFromList({ anchor, title: 'Duration', value: r.durationMinutes, options: [15, 25, 30, 45, 60, 90, 120, 180, 240].map((minutes) => ({ value: minutes, label: formatDuration(minutes) })), onPick: (value) => { state.overrides.durationMinutes = value; refocus(); } });
  } else if (field === 'activity') {
    pickFromList({ anchor, title: 'Activity type', value: r.activityType, options: [{ value: null, label: 'Automatic', description: 'Inferred from the description' }, ...Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label }))], onPick: (value) => { state.overrides.activityType = value; refocus(); } });
  } else if (field === 'ideaType') {
    const types = [...new Set(['short', 'long_video', ...store.state.creation.ideas.map((idea) => idea.type)])];
    pickFromList({ anchor, title: 'Type', value: r.ideaType, options: types.map((value) => ({ value, label: value === 'short' ? 'Short' : value === 'long_video' ? 'Long video' : value })), onPick: (value) => { state.overrides.ideaType = value; refocus(); } });
  } else if (field === 'domain') {
    pickFromList({ anchor, title: 'Domain', value: r.domain, options: Object.entries(store.state.domains).map(([value, domain]) => ({ value, label: domain.label, swatch: domain.color })), onPick: (value) => { state.overrides.domain = value; refocus(); } });
  }
}

async function submit({ keepOpen = false, open = false }) {
  const r = resolved();
  const title = r.title.trim();
  if (!title || state.busy) return;
  if (state.kind === 'log' && !r.durationMinutes) {
    root.querySelector('.capture-field').classList.add('is-shake');
    setTimeout(() => root?.querySelector('.capture-field')?.classList.remove('is-shake'), 400);
    return;
  }
  const kind = state.kind;
  const sticky = { overrides: { projectId: state.overrides.projectId, tags: state.overrides.tags } };
  state.busy = true;
  paint({ keepInput: true });
  const original = state.text;
  if (!keepOpen) closeCapture();
  try {
    if (kind === 'task') {
      await act.createTask({ title, projectId: r.projectId === undefined ? null : r.projectId, dueDate: r.dueDate, startTime: r.startTime, priority: r.priority, tags: r.tags, durationMinutes: r.durationMinutes }, { open });
    } else if (kind === 'log') {
      await act.logTime({ durationMinutes: r.durationMinutes, ...(r.projectId !== undefined ? { projectId: r.projectId } : {}), activityType: r.activityType || undefined, description: title, rawInput: original, ...(r.dueDate ? { date: r.dueDate } : {}) });
    } else if (kind === 'timer') {
      await act.startTimer({ projectId: r.projectId ?? null, description: title, activityType: r.activityType || undefined });
    } else if (kind === 'idea') {
      await act.createIdea({ title, type: r.ideaType, ...(r.dueDate ? { date: r.dueDate } : {}) }, { open });
    } else if (kind === 'project') {
      await act.createProject({ name: title, ...(r.domain ? { domain: r.domain } : {}), ...(r.dueDate ? { deadline: r.dueDate } : {}) }, { open: true });
    } else if (kind === 'milestone') {
      await run('milestones.create', { text: title, ...(r.dueDate ? { date: r.dueDate } : {}) });
    } else if (kind === 'book') {
      const { openBookSearch } = await import('../screens/reading.js');
      openBookSearch(open ? '' : title, { manualTitle: open ? title : null });
    }
  } finally {
    if (state && keepOpen) {
      state.busy = false;
      state.text = '';
      state.ignore = new Set();
      state.overrides = sticky.overrides;
      paint();
      root?.querySelector('.capture-input')?.focus();
    }
  }
}
