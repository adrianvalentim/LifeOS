import { run } from '../api.js';
import { cx, html } from '../dom.js';
import { normalize, plural } from '../format.js';
import { icon } from '../icons.js';
import { navigate } from '../router.js';
import { render, setPref, store } from '../store.js';
import { canReorder, collectTags, groupTasks, GROUPINGS, listCounts, normalizeList, SORTS, taskScope } from '../task-model.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { renderBulkBar, renderQuickAdd, renderTaskGroups } from '../components/task-list.js';
import { togglePin } from '../actions.js';

export function currentList() {
  return normalizeList(store.ui.route.params.get('list') || 'all', store.state);
}

function viewSettings(scope) {
  const prefs = store.prefs.tasks;
  const key = scope.id;
  const perList = prefs.lists?.[key] || {};
  return {
    groupBy: perList.groupBy ?? scope.defaultGroup ?? prefs.groupBy ?? 'none',
    sortBy: perList.sortBy ?? scope.defaultSort ?? (scope.flat ? 'due' : prefs.sortBy || 'manual'),
  };
}

function setViewSetting(scope, patch) {
  const lists = { ...(store.prefs.tasks.lists || {}) };
  lists[scope.id] = { ...(lists[scope.id] || {}), ...patch };
  setPref('tasks.lists', lists);
}

function filterItems(items) {
  const needle = normalize(store.ui.filter);
  if (!needle) return items;
  return items.filter((task) => normalize(`${task.title} ${task.notes} ${task.tags.join(' ')}`).includes(needle));
}

export function render_() {
  const state = store.state;
  if (state.tasks.authority && !(state.tasks.authority.mode === 'online' && state.tasks.authority.phase === 'active')) {
    return html`<div class="screen-empty">${icon('warning', { size: 22 })}<h2>Task transfer pending</h2><p>Your task snapshot is preserved locally. Editing resumes when the shared task store is activated.</p></div>`;
  }
  const list = currentList();
  const scope = taskScope(list, state);
  const settings = viewSettings(scope);
  const filtered = { ...scope, items: filterItems(scope.items) };
  const reorderable = canReorder(scope, settings.groupBy, settings.sortBy) && !store.ui.filter;
  const groups = groupTasks(filtered.items, settings, state);
  const completed = scope.completed ? filterItems(scope.completed) : list.startsWith('project:') || list === 'inbox'
    ? filterItems(state.tasks.items.filter((task) => !task.trashedAt && task.status === 'completed' && (list === 'inbox' ? task.projectId == null : task.projectId === list.slice(8)) && !task.parentTaskId))
    : [];
  const openCount = scope.lifecycle === 'active' ? filtered.items.length : null;
  const online = state.tasks.authority?.mode === 'online';
  return html`<div class="screen tasks-screen">
    ${renderListsPane(list)}
    <section class="list-pane scroll-y" aria-label="${scope.label}">
      <header class="page-head">
        <div class="page-title">
          <span class="page-icon">${icon(scope.icon || 'tasks', { size: 20 })}</span>
          <div>
            <h1>${scope.label}</h1>
            <p>${scope.copy}${online ? html` · <span class="${state.tasks.authority.online === false ? 'warn' : 'quiet'}">${state.tasks.authority.online === false ? 'Offline — cached tasks, reconnect to edit' : 'Synced to cloud'}</span>` : ''}</p>
          </div>
        </div>
        <div class="page-tools">
          <label class="filter-field">${icon('search', { size: 14 })}<input type="search" placeholder="Filter" value="${store.ui.filter}" data-page-filter aria-label="Filter this list"><kbd>/</kbd></label>
          ${store.ui.filter && scope.lifecycle === 'active' ? html`<button type="button" class="button ghost small" data-action="tasks-save-filter">${icon('list', { size: 14 })}Save view</button>` : ''}
          ${scope.view ? html`<button type="button" class="icon-button" data-action="tasks-edit-view" aria-label="Edit view">${icon('sliders', { size: 15 })}</button>` : ''}
          <button type="button" class="button ghost small" data-action="tasks-view-options" aria-haspopup="menu">${icon('sliders', { size: 14 })}${settings.groupBy !== 'none' ? GROUPINGS[settings.groupBy] || 'By day' : SORTS[settings.sortBy] || 'View'}</button>
        </div>
      </header>
      ${scope.lifecycle === 'active' ? renderQuickAdd({ id: `tasks:${list}`, placeholder: quickAddPlaceholder(scope), defaults: scope.defaults || {} }) : ''}
      ${openCount !== null && openCount > 0 ? html`<div class="list-summary">${plural(openCount, 'open task')}${reorderable ? html`<span>Drag to reorder · drag right to nest</span>` : ''}</div>` : ''}
      ${filtered.items.length ? renderTaskGroups(groups, scope, { reorderable }) : renderEmpty(scope)}
      ${completed.length ? html`<details class="completed-fold" data-keep-open data-key="completed-${list}">
        <summary>${icon('chevron-right', { size: 13 })}<span>Completed</span><b>${completed.length}</b></summary>
        ${renderTaskGroups([{ id: 'all', tasks: completed.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))) }], { ...scope, id: `${scope.id}-done`, flat: true, lifecycle: 'completed' }, { showProject: scope.flat })}
      </details>` : ''}
      ${list === 'trash' && filtered.items.length && !online ? html`<p class="list-foot">Items leave Trash automatically 30 days after deletion.</p>` : ''}
    </section>
    ${renderBulkBar()}
  </div>`;
}

function quickAddPlaceholder(scope) {
  if (scope.id === 'today') return 'Add a task for today';
  if (scope.project) return `Add to ${scope.project.name}`;
  if (scope.id === 'inbox') return 'Capture to Inbox';
  return 'Add a task — #tag @project !high fri 3pm';
}

function renderEmpty(scope) {
  return html`<div class="list-empty">
    <div class="empty-mark">${icon(scope.lifecycle === 'trash' ? 'trash' : 'check', { size: 22 })}</div>
    <h3>${store.ui.filter ? 'No tasks match this filter' : scope.empty || 'Nothing here'}</h3>
    ${scope.lifecycle === 'active' && !store.ui.filter ? html`<p>Press <kbd>N</kbd> anywhere to capture, or type above.</p>` : ''}
  </div>`;
}

function renderListsPane(active) {
  const state = store.state;
  const counts = listCounts(state);
  const tags = collectTags(state.tasks.items).filter((tag) => tag.open > 0);
  const projects = state.projects.filter((project) => !['done', 'dropped'].includes(project.status) || state.tasks.summary.byProject[project.id]?.open);
  const activeStatuses = ['doing', 'next_up', 'to_do'];
  const current = projects.filter((project) => activeStatuses.includes(project.status)).sort((a, b) => a.name.localeCompare(b.name));
  const other = projects.filter((project) => !activeStatuses.includes(project.status)).sort((a, b) => a.name.localeCompare(b.name));
  const item = (list, label, iconName, count, extra = {}) => html`<a class="${cx('list-link', active === list && 'is-active', extra.tone)}" href="/tasks?list=${encodeURIComponent(list)}" ${extra.drop === false ? '' : html`data-drop-list="${list}"`} ${active === list ? html`aria-current="page"` : ''} data-key="list-${list}">
    ${extra.swatch ? html`<i class="dot" style="--dot:${extra.swatch}"></i>` : html`<span class="list-icon">${icon(iconName, { size: 15 })}</span>`}
    <span class="list-label">${label}</span>
    ${extra.alert ? html`<b class="count is-alert" title="${extra.alert} overdue">${count}</b>` : count ? html`<b class="count">${count}</b>` : ''}
  </a>`;
  return html`<nav class="lists-pane scroll-y" aria-label="Task lists">
    <div class="list-section">
      ${item('inbox', 'Inbox', 'inbox', counts.inbox)}
      ${item('today', 'Today', 'calendar', counts.today, { alert: counts.overdue })}
      ${item('next7', 'Upcoming', 'upcoming', counts.next7, { drop: false })}
      ${item('all', 'All tasks', 'tasks', counts.all, { drop: false })}
    </div>
    <div class="list-section">
      <div class="list-heading"><span>Views</span><button type="button" class="icon-button tiny" data-action="tasks-new-view" aria-label="New view" title="New saved view">${icon('plus', { size: 13 })}</button></div>
      ${state.workspace.views.length ? state.workspace.views.map((view) => item(`view:${view.id}`, view.name, view.icon || 'list', viewCount(view), { drop: false })) : html`<button type="button" class="list-hint" data-action="tasks-new-view">Save a filtered list…</button>`}
    </div>
    <div class="list-section">
      <div class="list-heading"><span>Projects</span></div>
      ${current.map((project) => item(`project:${project.id}`, project.name, 'projects', state.tasks.summary.byProject[project.id]?.open || 0, { swatch: state.domains[project.domain]?.color }))}
      ${other.length ? html`<details class="list-more" data-keep-open><summary>${other.length} more</summary>${other.map((project) => item(`project:${project.id}`, project.name, 'projects', state.tasks.summary.byProject[project.id]?.open || 0, { swatch: state.domains[project.domain]?.color, tone: 'is-muted' }))}</details>` : ''}
    </div>
    ${tags.length ? html`<div class="list-section"><div class="list-heading"><span>Tags</span></div>
      ${tags.map((tag) => item(`tag:${tag.label}`, tag.label, 'hash', tag.open))}</div>` : ''}
    <div class="list-section is-bottom">
      ${item('completed', 'Completed', 'check', 0)}
      ${item('trash', 'Trash', 'trash', counts.trash)}
    </div>
  </nav>`;
}

function viewCount(view) {
  const scope = taskScope(`view:${view.id}`, store.state);
  return scope.items.length;
}

export const actions = {
  'tasks-view-options': (el) => {
    const scope = taskScope(currentList(), store.state);
    const settings = viewSettings(scope);
    const groupOptions = scope.id === 'next7' ? { day: 'By day', ...GROUPINGS } : scope.id === 'completed' ? { completedDay: 'By day completed', ...GROUPINGS } : GROUPINGS;
    openMenu({
      anchor: el,
      align: 'end',
      width: 240,
      items: [
        { type: 'header', label: 'Group by' },
        ...Object.entries(groupOptions).map(([value, label]) => ({ label, checked: settings.groupBy === value, run: () => setViewSetting(scope, { groupBy: value }) })),
        { type: 'separator' },
        { type: 'header', label: 'Sort by' },
        ...Object.entries(SORTS).filter(([value]) => value !== 'manual' || !scope.flat).map(([value, label]) => ({ label, checked: settings.sortBy === value, run: () => setViewSetting(scope, { sortBy: value }) })),
        { type: 'separator' },
        { label: store.state.workspace.density === 'compact' ? 'Comfortable rows' : 'Compact rows', icon: 'sliders', run: () => run('workspace.update', { density: store.state.workspace.density === 'compact' ? 'comfortable' : 'compact' }, { quiet: true }) },
        { label: 'Expand all subtasks', icon: 'chevron-down', run: () => setPref('tasks.collapsed', {}) },
        ...(scope.lifecycle === 'active' ? [{ label: 'Save as view…', icon: 'list', run: () => editView(null, filterFromScope(scope)) }] : []),
        ...(scope.project || scope.view || scope.id.startsWith('tag:') ? [{ label: isPinned(scope) ? 'Unpin from sidebar' : 'Pin to sidebar', icon: 'pin', run: () => togglePin(scope.project ? 'project' : scope.view ? 'view' : 'tag', scope.project?.id || scope.view?.id || scope.id.slice(4)) }] : []),
      ],
    });
  },
  'tasks-new-view': () => editView(),
  'tasks-edit-view': () => {
    const scope = taskScope(currentList(), store.state);
    if (scope.view) editView(scope.view);
  },
  'tasks-save-filter': () => {
    const scope = taskScope(currentList(), store.state);
    editView(null, { ...filterFromScope(scope), text: store.ui.filter });
  },
};

function isPinned(scope) {
  const kind = scope.project ? 'project' : scope.view ? 'view' : 'tag';
  const id = scope.project?.id || scope.view?.id || scope.id.slice(4);
  return store.state.workspace.pinned.some((pin) => pin.kind === kind && pin.id === id);
}

function filterFromScope(scope) {
  const filter = {};
  if (scope.project) filter.projects = [scope.project.id];
  if (scope.id === 'inbox') filter.projects = ['inbox'];
  if (scope.id.startsWith('tag:')) filter.tags = [scope.id.slice(4)];
  if (scope.id === 'today') filter.due = 'today';
  if (scope.id === 'next7') filter.due = 'next7';
  return filter;
}

export async function editView(view = null, preset = {}) {
  const state = store.state;
  const filter = { ...(view?.filter || {}), ...preset };
  const values = await formDialog({
    title: view ? `Edit “${view.name}”` : 'New saved view',
    description: view ? '' : 'A saved view is a live, filtered task list in your sidebar. Agents can create them too.',
    submitLabel: view ? 'Save view' : 'Create view',
    fields: [
      { name: 'name', label: 'Name', value: view?.name || '', required: true, autofocus: true, placeholder: 'Writing this week' },
      { name: 'icon', label: 'Icon', type: 'select', value: view?.icon || 'list', options: ['list', 'star', 'flag', 'bolt', 'pen', 'book', 'film', 'mail', 'heart', 'target', 'clock', 'leaf'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) },
      { name: 'project', label: 'List', type: 'select', value: filter.projects?.length === 1 ? filter.projects[0] : '', options: [{ value: '', label: 'Any list' }, { value: 'inbox', label: 'Inbox' }, ...state.projects.map((project) => ({ value: project.id, label: project.name }))] },
      { name: 'tags', label: 'Tags', value: (filter.tags || []).join(', '), placeholder: 'writing, research', hint: 'Matches tasks with any of these tags.' },
      { name: 'priority', label: 'Priority', type: 'select', value: (filter.priorities || []).join(','), options: [{ value: '', label: 'Any priority' }, { value: 'high', label: 'High' }, { value: 'high,medium', label: 'High or medium' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'none', label: 'No priority' }] },
      { name: 'due', label: 'Due', type: 'select', value: filter.due || 'any', options: [{ value: 'any', label: 'Any time' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'By today' }, { value: 'next7', label: 'Within 7 days' }, { value: 'next30', label: 'Within 30 days' }, { value: 'dated', label: 'Has a date' }, { value: 'nodate', label: 'No date' }] },
      { name: 'status', label: 'Status', type: 'select', value: filter.status || 'open', options: [{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'Open and completed' }] },
      { name: 'text', label: 'Contains text', value: filter.text || '', placeholder: 'Optional words in the title or notes' },
      { name: 'groupBy', label: 'Group by', type: 'select', value: view?.groupBy || 'none', options: Object.entries(GROUPINGS).map(([value, label]) => ({ value, label })) },
      { name: 'sortBy', label: 'Sort by', type: 'select', value: view?.sortBy || 'due', options: Object.entries(SORTS).filter(([value]) => value !== 'manual').map(([value, label]) => ({ value, label })) },
    ],
  });
  if (!values) return;
  const payload = {
    name: values.name,
    icon: values.icon,
    filter: {
      projects: values.project ? [values.project] : [],
      tags: values.tags.split(',').map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean),
      priorities: values.priority ? values.priority.split(',') : [],
      due: values.due,
      status: values.status,
      text: values.text.trim(),
    },
    groupBy: values.groupBy,
    sortBy: values.sortBy,
  };
  try {
    if (view) {
      await run('views.update', { viewId: view.id, ...payload });
    } else {
      const result = await run('views.create', payload);
      if (result?.view) { store.ui.filter = ''; navigate(`/tasks?list=view:${encodeURIComponent(result.view.id)}`); }
    }
  } catch { /* toast shown */ }
}

export async function deleteView(view) {
  const ok = await confirmDialog({ title: `Delete “${view.name}”?`, body: 'Only the saved view is removed; tasks are untouched. You can undo right after.', confirmLabel: 'Delete view', danger: true });
  if (!ok) return;
  navigate('/tasks');
  await run('views.delete', { viewId: view.id }).catch(() => undefined);
}

export function presence() {
  const scope = taskScope(currentList(), store.state);
  return { title: scope.label, list: scope.id };
}

export function onFilterInput(value) {
  store.ui.filter = value;
  render();
}

export default { id: 'tasks', render: render_, actions, presence };
