export const TASK_PRIORITIES = ['high', 'medium', 'low', 'none'];
export const TASK_GROUPINGS = ['none', 'priority', 'due', 'project', 'tag'];
export const TASK_SORTS = ['manual', 'priority', 'due', 'title', 'created'];
export const TASK_DENSITIES = ['compact', 'comfortable'];

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 };
const GROUPING_LABELS = {
  none: 'None',
  priority: 'Priority',
  due: 'Due date',
  project: 'List',
  tag: 'Tag',
};
const SORT_LABELS = {
  manual: 'Custom order',
  priority: 'Priority',
  due: 'Due date',
  title: 'Title',
  created: 'Date created',
};

export function createTasksUiState() {
  return {
    filter: 'all',
    addingSubtaskToId: null,
    savingTaskId: null,
    creating: false,
    selectedTaskId: null,
    detailDraft: null,
    detailError: null,
    updatingTaskId: null,
    deleteTaskId: null,
    deletingTaskId: null,
    deleteError: null,
    groupBy: 'none',
    sortBy: 'manual',
    density: 'compact',
    viewOptionsOpen: false,
    menu: null,
  };
}

export function renderTasks(tasks, projects, domains, ui, options = {}) {
  const filter = normalizeTaskFilter(ui.filter, projects, tasks);
  const scope = taskScope(filter, tasks, projects, options.today);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tree = taskTree(tasks.items);
  const groups = groupTasks(scope.items, ui, projects, options.today);
  const view = {
    ...options,
    projectById,
    tree,
    flat: scope.flat,
    lifecycle: scope.lifecycle,
    scopeFilter: filter,
  };
  const reorderable = scope.lifecycle === 'active' && canReorder(ui) && !scope.flat;
  const showCreate = !['completed', 'trash'].includes(scope.lifecycle);
  const listHeading = scope.lifecycle === 'completed'
    ? `${scope.summary.completed} completed`
    : scope.lifecycle === 'trash'
      ? `${scope.summary.total} in trash`
      : `${scope.summary.open} open`;
  return `
    <div class="tasks-workspace ${ui.density === 'comfortable' ? 'is-comfortable' : 'is-compact'}">
      ${renderTaskSidebar(tasks, projects, domains, filter, options.today)}
      <main class="tasks-main">
        <header class="tasks-header">
          <div>
            <span class="tasks-eyebrow">Task ledger</span>
            <h1>${escapeHtml(scope.label)}</h1>
            <p>${escapeHtml(scope.copy)}</p>
          </div>
          ${scope.lifecycle === 'trash'
            ? '<div class="task-retention-note"><b>30 days</b><span>automatic cleanup</span></div>'
            : renderTaskSummary(scope.summary)}
        </header>
        ${showCreate ? renderTaskCreateForm(projects, filter, ui.creating) : ''}
        <section class="task-list-section" aria-labelledby="task-list-heading">
          <div class="task-list-heading">
            <h2 id="task-list-heading">${listHeading}</h2>
            <div class="task-list-tools">
              ${scope.lifecycle === 'trash'
                ? '<span>Oldest items leave automatically</span>'
                : scope.lifecycle === 'completed'
                  ? '<span>Finished work archive</span>'
                  : `<span>${scope.summary.completed} completed</span>`}
              ${renderViewOptions(ui, reorderable)}
            </div>
          </div>
          ${scope.items.length
            ? groups.map((group) => renderTaskGroup(group, domains, ui, view, reorderable)).join('')
            : renderTaskEmpty(scope.label, scope.emptyCopy)}
          ${scope.completedItems?.length
            ? renderSmartCompleted(scope.completedItems, domains, ui, { ...view, lifecycle: 'completed', flat: true })
            : ''}
        </section>
      </main>
    </div>
  `;
}

export function renderProjectTaskPanel(tasks, project, domains, ui, options = {}) {
  if (!tasks) return '';
  const projectTasks = tasks.items.filter((task) => task.projectId === project.id);
  const roots = taskSubsetRoots(projectTasks, isOpenTask);
  const tree = taskTree(tasks.items);
  const projectById = new Map([[project.id, project]]);
  const summary = project.taskSummary || summarize(projectTasks.filter((task) => !task.trashedAt));
  const view = { ...options, projectById, tree, compact: true, lifecycle: 'active' };
  return `
    <section class="project-task-panel" aria-labelledby="project-task-heading">
      <div class="project-task-panel-head">
        <div>
          <span class="smallcaps-strong">Tasks</span>
          <h3 id="project-task-heading">${summary.open} open · ${summary.completed} complete</h3>
        </div>
        <button class="task-text-button" data-task-manage-project="${escapeAttribute(project.id)}" type="button">Open Tasks</button>
      </div>
      ${renderCompactProgress(summary)}
      <form class="project-task-create" data-project-task-create="${escapeAttribute(project.id)}">
        <label class="visually-hidden" for="project-task-title-${escapeAttribute(project.id)}">New task for ${escapeHtml(project.name)}</label>
        <input id="project-task-title-${escapeAttribute(project.id)}" name="title" maxlength="300" autocomplete="off" placeholder="Add a project task…" ${ui.creating ? 'disabled' : ''} required>
        <button type="submit" ${ui.creating ? 'disabled' : ''}>Add</button>
      </form>
      ${roots.length
        ? `<ul class="task-tree project-task-tree">${roots.map((task) => renderTaskNode(task, domains, ui, view, false)).join('')}</ul>`
        : '<p class="project-task-empty">No tasks are associated with this project yet.</p>'}
    </section>
  `;
}

export function renderTaskOverlays(tasks, projects, ui, options = {}) {
  const selected = tasks?.items.find((task) => task.id === ui.selectedTaskId);
  const deleteTarget = tasks?.items.find((task) => task.id === ui.deleteTaskId);
  const menuTarget = tasks?.items.find((task) => task.id === ui.menu?.taskId);
  return [
    menuTarget ? renderTaskContextMenu(menuTarget, tasks, projects, ui, options) : '',
    selected ? renderTaskDetail(selected, tasks, projects, ui, options) : '',
    deleteTarget ? renderTaskDeleteConfirmation(deleteTarget, ui) : '',
  ].join('');
}

function renderTaskSidebar(tasks, projects, domains, activeFilter, today) {
  const counts = smartListCounts(tasks.items, today);
  const tags = collectTags(tasks.items).filter((tag) => tag.open > 0);
  return `
    <aside class="task-sidebar" aria-label="Task scopes">
      <div class="task-sidebar-title">Lists</div>
      ${taskFilterButton('all', 'All tasks', tasks.summary.open, activeFilter)}
      ${taskFilterButton('today', 'Today', counts.today, activeFilter, 'today')}
      ${taskFilterButton('next7', 'Next 7 days', counts.next7, activeFilter, 'upcoming')}
      ${taskFilterButton('inbox', 'Inbox', tasks.summary.inbox.open, activeFilter, 'inbox')}
      <div class="task-sidebar-title projects">Projects</div>
      <div class="task-project-filters">
        ${[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((project) => {
          const summary = tasks.summary.byProject[project.id] || summarize([]);
          const domain = domains[project.domain];
          return taskFilterButton(
            `project:${project.id}`,
            project.name,
            summary.open,
            activeFilter,
            'project',
            domain?.color,
          );
        }).join('')}
      </div>
      ${tags.length
        ? `<div class="task-sidebar-title tags">Tags</div>
           <div class="task-tag-filters">
             ${tags.map((tag) => taskFilterButton(
               `tag:${tag.label}`,
               tag.label,
               tag.open,
               activeFilter,
               'tag',
             )).join('')}
           </div>`
        : ''}
      <div class="task-sidebar-lifecycle">
        ${taskFilterButton('completed', 'Completed', tasks.summary.completed, activeFilter, 'completed')}
        ${taskFilterButton('trash', 'Trash', tasks.summary.trashed || 0, activeFilter, 'trash')}
      </div>
    </aside>
  `;
}

function taskFilterButton(filter, label, count, activeFilter, kind = 'all', color = null) {
  // Tag scopes compare on the normalized label so a differently-cased scope still highlights.
  const active = filter === activeFilter || (
    filter.startsWith('tag:')
    && String(activeFilter || '').startsWith('tag:')
    && normalizeText(filter.slice(4)) === normalizeText(activeFilter.slice(4))
  );
  return `
    <button class="task-filter ${active ? 'active' : ''}" data-task-filter="${escapeAttribute(filter)}" ${taskDropEnabled(filter) ? `data-task-drop-filter="${escapeAttribute(filter)}"` : ''} type="button" ${active ? 'aria-current="page"' : ''} style="${color ? `--task-project:${escapeAttribute(color)}` : ''}">
      <span class="task-filter-icon ${kind}" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
      <b>${count}</b>
    </button>
  `;
}

function renderViewOptions(ui, reorderable) {
  return `
    <div class="task-view-options">
      <button class="task-view-trigger ${ui.viewOptionsOpen ? 'is-open' : ''}" data-task-view-options type="button" aria-expanded="${ui.viewOptionsOpen}" aria-haspopup="true" aria-label="View options">
        <span aria-hidden="true">⋮⋮</span> View
      </button>
      ${ui.viewOptionsOpen
        ? `<div class="task-view-panel" role="group" aria-label="View options">
            <label class="task-view-field">
              <span>Group by</span>
              <select data-task-group-by>
                ${TASK_GROUPINGS.map((value) => `<option value="${value}" ${value === ui.groupBy ? 'selected' : ''}>${GROUPING_LABELS[value]}</option>`).join('')}
              </select>
            </label>
            <label class="task-view-field">
              <span>Sort by</span>
              <select data-task-sort-by>
                ${TASK_SORTS.map((value) => `<option value="${value}" ${value === ui.sortBy ? 'selected' : ''}>${SORT_LABELS[value]}</option>`).join('')}
              </select>
            </label>
            <label class="task-view-field">
              <span>Density</span>
              <select data-task-density>
                ${TASK_DENSITIES.map((value) => `<option value="${value}" ${value === ui.density ? 'selected' : ''}>${value === 'compact' ? 'Compact' : 'Comfortable'}</option>`).join('')}
              </select>
            </label>
            <p class="task-view-hint">${reorderable
              ? 'Drag a task to reorder it, or drag right to nest it under the task above. A focused row also moves with Option and the arrow keys.'
              : 'Switch to custom order without grouping to drag tasks into place.'}</p>
          </div>`
        : ''}
    </div>
  `;
}

function renderTaskGroup(group, domains, ui, view, reorderable) {
  return `
    <section class="task-group ${group.id === 'all' ? 'is-single' : ''}" data-task-group="${escapeAttribute(group.id)}">
      ${group.id === 'all'
        ? ''
        : `<h3 class="task-group-heading" style="--task-group-color:${escapeAttribute(group.color || 'var(--ink-faint)')}">
            <span>${escapeHtml(group.label)}</span><b>${group.tasks.length}</b>
          </h3>`}
      <ul class="task-tree task-root-list">
        ${group.tasks.map((task) => renderTaskNode(task, domains, ui, view, reorderable)).join('')}
      </ul>
    </section>
  `;
}

function renderSmartCompleted(tasks, domains, ui, view) {
  return `
    <details class="task-completed-disclosure">
      <summary><span>Completed</span><b>${tasks.length}</b></summary>
      <ul class="task-tree task-root-list">
        ${sortTasks(tasks, 'created').map((task) => renderTaskNode(task, domains, ui, view, false)).join('')}
      </ul>
    </details>
  `;
}

function renderTaskNode(task, domains, ui, view, reorderable) {
  const children = view.flat ? [] : (view.tree.get(task.id) || []).filter((child) => (
    taskMatchesLifecycle(child, view.lifecycle)
  ));
  const project = task.projectId ? view.projectById.get(task.projectId) : null;
  const domain = project ? domains[project.domain] : null;
  const saving = ui.savingTaskId === task.id;
  const completed = task.status === 'completed';
  const trashed = Boolean(task.trashedAt);
  const priority = normalizePriority(task.priority);
  const checkboxLabel = completed ? `Reopen ${task.title}` : task.subtreeTotal > 1
    ? `Complete ${task.title} and its subtasks`
    : `Complete ${task.title}`;
  const showProject = !view.compact && (
    view.flat
    || ['all', 'completed', 'trash'].includes(view.scopeFilter)
    || String(view.scopeFilter || '').startsWith('tag:')
  );
  const subtreeTotal = trashed ? task.trashSubtreeTotal : task.subtreeTotal;
  return `
    <li class="task-node ${completed ? 'is-completed' : ''} ${trashed ? 'is-trashed' : ''} ${ui.menu?.taskId === task.id ? 'is-menu-open' : ''}" data-task-node="${escapeAttribute(task.id)}" style="--task-domain:${escapeAttribute(domain?.color || 'var(--ink-faint)')}">
      <article class="task-item ${saving ? 'is-saving' : ''} priority-${priority}" data-task-detail="${escapeAttribute(task.id)}" ${reorderable ? `data-task-drag-id="${escapeAttribute(task.id)}"` : ''} tabindex="0" ${saving ? 'aria-busy="true"' : ''}>
        ${reorderable ? '<span class="task-drag-handle" aria-hidden="true">⠿</span>' : ''}
        ${trashed
          ? '<span class="task-trash-marker" aria-hidden="true"></span>'
          : `<label class="task-checkbox">
              <input type="checkbox" data-task-completion="${escapeAttribute(task.id)}" aria-label="${escapeAttribute(checkboxLabel)}" ${completed ? 'checked' : ''} ${saving ? 'disabled' : ''}>
              <span aria-hidden="true"></span>
            </label>`}
        <div class="task-copy">
          <div class="task-title-line">
            ${priority === 'none' ? '' : `<span class="task-priority-flag ${priority}" title="${PRIORITY_LABELS[priority]} priority"><span class="visually-hidden">${PRIORITY_LABELS[priority]} priority</span><span aria-hidden="true">⚑</span></span>`}
            <button class="task-title" data-task-detail-button="${escapeAttribute(task.id)}" type="button" aria-label="Open details for ${escapeAttribute(task.title)}">${escapeHtml(task.title)}</button>
            ${renderTaskTags(task)}
          </div>
        </div>
        <div class="task-meta">
          ${task.notes ? '<span class="task-note-indicator" title="Has notes"><span class="visually-hidden">Has notes</span><span aria-hidden="true">≡</span></span>' : ''}
          ${subtreeTotal > 1 && !trashed ? `<span class="task-progress-copy">${task.subtreeCompleted}/${task.subtreeTotal}</span>` : ''}
          ${renderLifecycleDate(task, view.lifecycle)}
          ${renderDueDate(task.schedule?.dueDate, view.today, completed)}
          ${showProject || view.compact ? `<span class="task-project-label">${escapeHtml(project?.name || 'Inbox')}</span>` : ''}
        </div>
        <div class="task-row-actions">
          ${trashed ? '' : `<button class="task-icon-button" data-task-subtask-open="${escapeAttribute(task.id)}" type="button" aria-expanded="${ui.addingSubtaskToId === task.id ? 'true' : 'false'}" aria-label="Add a subtask to ${escapeAttribute(task.title)}" ${saving ? 'disabled' : ''}><span aria-hidden="true">+</span></button>`}
          <button class="task-icon-button" data-task-menu="${escapeAttribute(task.id)}" type="button" aria-haspopup="menu" aria-expanded="${ui.menu?.taskId === task.id ? 'true' : 'false'}" aria-label="Actions for ${escapeAttribute(task.title)}" ${saving ? 'disabled' : ''}><span aria-hidden="true">⋯</span></button>
        </div>
      </article>
      ${!trashed && ui.addingSubtaskToId === task.id ? renderSubtaskForm(task, ui.creating) : ''}
      ${children.length ? `<ul class="task-tree task-children">${children.map((child) => renderTaskNode(child, domains, ui, view, reorderable)).join('')}</ul>` : ''}
    </li>
  `;
}

function renderTaskTags(task) {
  const tags = task.tags || [];
  if (!tags.length) return '';
  return `<span class="task-tag-list">${tags.map((tag) => `<button class="task-tag" data-task-tag-filter="${escapeAttribute(tag)}" type="button" aria-label="Show tasks tagged ${escapeAttribute(tag)}">${escapeHtml(tag)}</button>`).join('')}</span>`;
}

function renderTaskContextMenu(task, tasks, projects, ui, options) {
  const menu = ui.menu;
  if (task.trashedAt) {
    return `
      <div class="task-menu-backdrop" data-task-menu-close>
        <div class="task-menu" role="menu" aria-label="Actions for ${escapeAttribute(task.title)}" style="--task-menu-x:${Math.round(menu.x)}px;--task-menu-y:${Math.round(menu.y)}px">
          <div class="task-menu-title">${escapeHtml(task.title)}</div>
          <div class="task-menu-items">
            <button class="task-menu-item" data-task-menu-detail="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">✎</span>Open details</button>
            <button class="task-menu-item" data-task-restore="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">↶</span>Restore</button>
            <div class="task-menu-separator" role="separator"></div>
            <button class="task-menu-item danger" data-task-delete-request="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">✕</span>Delete forever</button>
          </div>
        </div>
      </div>
    `;
  }
  const priority = normalizePriority(task.priority);
  const today = options.today || null;
  const knownTags = collectTags(tasks.items).map((entry) => entry.label);
  const taskTags = new Set((task.tags || []).map((tag) => normalizeText(tag)));
  const dates = today
    ? [
      ['Today', shiftDate(today, 0)],
      ['Tomorrow', shiftDate(today, 1)],
      ['Next week', shiftDate(today, 7)],
    ]
    : [];
  return `
    <div class="task-menu-backdrop" data-task-menu-close>
      <div class="task-menu" role="menu" aria-label="Actions for ${escapeAttribute(task.title)}" style="--task-menu-x:${Math.round(menu.x)}px;--task-menu-y:${Math.round(menu.y)}px">
        <div class="task-menu-title">${escapeHtml(task.title)}</div>
        ${dates.length
          ? `<div class="task-menu-section">
              <span class="task-menu-label">Date</span>
              <div class="task-menu-row">
                ${dates.map(([label, date]) => `<button class="task-menu-chip ${task.schedule?.dueDate === date ? 'is-active' : ''}" data-task-due-set="${escapeAttribute(task.id)}" data-task-due-date="${date}" role="menuitem" type="button">${label}</button>`).join('')}
                <button class="task-menu-chip ${task.schedule?.dueDate ? '' : 'is-active'}" data-task-due-set="${escapeAttribute(task.id)}" data-task-due-date="" role="menuitem" type="button">No date</button>
              </div>
            </div>`
          : ''}
        <div class="task-menu-section">
          <span class="task-menu-label">Priority</span>
          <div class="task-menu-row">
            ${TASK_PRIORITIES.map((value) => `
              <button class="task-menu-flag ${value} ${value === priority ? 'is-active' : ''}" data-task-priority-set="${escapeAttribute(task.id)}" data-task-priority="${value}" role="menuitem" type="button" aria-label="${PRIORITY_LABELS[value]} priority">
                <span aria-hidden="true">⚑</span>
              </button>
            `).join('')}
          </div>
        </div>
        <div class="task-menu-items">
          <button class="task-menu-item" data-task-menu-detail="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">✎</span>Open details</button>
          <button class="task-menu-item" data-task-menu-subtask="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">⌐</span>Add subtask</button>
          <button class="task-menu-item" data-task-menu-move="${escapeAttribute(task.id)}" role="menuitem" type="button" aria-expanded="${menu.submenu === 'project'}"><span aria-hidden="true">→</span>Move to<b>${escapeHtml(projectName(projects, task.projectId))}</b></button>
          ${menu.submenu === 'project' ? renderMoveSubmenu(task, projects) : ''}
          <button class="task-menu-item" data-task-menu-tags="${escapeAttribute(task.id)}" role="menuitem" type="button" aria-expanded="${menu.submenu === 'tag'}"><span aria-hidden="true">◆</span>Tags<b>${(task.tags || []).length || ''}</b></button>
          ${menu.submenu === 'tag' ? renderTagSubmenu(task, knownTags, taskTags) : ''}
          <div class="task-menu-separator" role="separator"></div>
          <button class="task-menu-item" data-task-duplicate="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">⧉</span>Duplicate</button>
          <button class="task-menu-item danger" data-task-delete-request="${escapeAttribute(task.id)}" role="menuitem" type="button"><span aria-hidden="true">⌫</span>Move to Trash</button>
        </div>
      </div>
    </div>
  `;
}

function renderMoveSubmenu(task, projects) {
  if (task.parentTaskId) {
    return '<p class="task-menu-note">A subtask always follows its parent task\'s list.</p>';
  }
  return `
    <div class="task-menu-submenu">
      <button class="task-menu-subitem ${task.projectId ? '' : 'is-active'}" data-task-project-set="${escapeAttribute(task.id)}" data-task-project-id="" role="menuitem" type="button">Inbox</button>
      ${[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((project) => `
        <button class="task-menu-subitem ${project.id === task.projectId ? 'is-active' : ''}" data-task-project-set="${escapeAttribute(task.id)}" data-task-project-id="${escapeAttribute(project.id)}" role="menuitem" type="button">${escapeHtml(project.name)}</button>
      `).join('')}
    </div>
  `;
}

function renderTagSubmenu(task, knownTags, taskTags) {
  return `
    <div class="task-menu-submenu">
      ${knownTags.length
        ? knownTags.map((tag) => `
          <button class="task-menu-subitem ${taskTags.has(normalizeText(tag)) ? 'is-active' : ''}" data-task-tag-toggle="${escapeAttribute(task.id)}" data-task-tag="${escapeAttribute(tag)}" role="menuitem" type="button">${escapeHtml(tag)}</button>
        `).join('')
        : '<p class="task-menu-note">No tags yet.</p>'}
      <form class="task-menu-tag-form" data-task-tag-create="${escapeAttribute(task.id)}">
        <label class="visually-hidden" for="task-menu-tag-input">New tag for ${escapeHtml(task.title)}</label>
        <input id="task-menu-tag-input" name="tag" maxlength="40" autocomplete="off" placeholder="New tag…" required>
        <button type="submit">Add</button>
      </form>
    </div>
  `;
}

function renderTaskCreateForm(projects, filter, creating) {
  const selectedProjectId = filter.startsWith('project:') ? filter.slice(8) : '';
  const inboxSelected = filter === 'inbox' || !selectedProjectId;
  return `
    <form class="task-quick-add" data-task-create>
      <div class="task-quick-title">
        <label class="visually-hidden" for="new-task-title">Task title</label>
        <span class="task-add-mark" aria-hidden="true">+</span>
        <input id="new-task-title" name="title" maxlength="300" autocomplete="off" placeholder="Add a task…  try #tag or !high" ${creating ? 'disabled' : ''} required>
      </div>
      <label class="task-quick-field">
        <span>Project</span>
        <select name="projectId" ${creating ? 'disabled' : ''}>
          <option value="" ${inboxSelected ? 'selected' : ''}>Inbox</option>
          ${projectOptions(projects, selectedProjectId)}
        </select>
      </label>
      <label class="task-quick-field due">
        <span>Due</span>
        <input name="dueDate" type="date" ${creating ? 'disabled' : ''}>
      </label>
      <label class="task-quick-field priority">
        <span>Priority</span>
        <select name="priority" ${creating ? 'disabled' : ''}>
          ${['none', 'low', 'medium', 'high'].map((value) => `<option value="${value}">${PRIORITY_LABELS[value]}</option>`).join('')}
        </select>
      </label>
      <button class="task-add-button" type="submit" ${creating ? 'disabled' : ''}>${creating ? 'Adding…' : 'Add task'}</button>
    </form>
  `;
}

function renderTaskDetail(task, tasks, projects, ui, options) {
  const project = task.projectId ? projects.find((candidate) => candidate.id === task.projectId) : null;
  const parent = task.parentTaskId ? tasks.items.find((candidate) => candidate.id === task.parentTaskId) : null;
  const trashed = Boolean(task.trashedAt);
  const draft = ui.detailDraft && ui.selectedTaskId === task.id
    ? ui.detailDraft
    : { title: task.title, notes: task.notes || '' };
  const dirty = !trashed && (draft.title !== task.title || draft.notes !== (task.notes || ''));
  const updating = ui.updatingTaskId === task.id;
  const disabled = updating || trashed;
  const priority = normalizePriority(task.priority);
  return `
    <div class="task-detail-backdrop" data-task-detail-close>
      <article class="task-detail" role="dialog" aria-modal="true" aria-labelledby="task-detail-dialog-title" ${updating ? 'aria-busy="true"' : ''}>
        <button class="task-detail-close" data-task-detail-close type="button" aria-label="Close task details">×</button>
        <header class="task-detail-heading">
          <span class="tasks-eyebrow" id="task-detail-dialog-title">Task details</span>
          <span class="task-detail-status ${trashed ? 'trashed' : task.status}">${trashed ? 'Trash' : task.status === 'completed' ? 'Completed' : 'Open'}</span>
        </header>
        <form class="task-detail-form" data-task-update="${escapeAttribute(task.id)}">
          <label class="task-detail-title-field" for="task-detail-title">
            <span class="visually-hidden">Task title</span>
            <input id="task-detail-title" name="title" maxlength="300" value="${escapeAttribute(draft.title)}" ${disabled ? 'disabled' : ''} required>
          </label>
          <div class="task-detail-controls">
            <label class="task-detail-control">
              <span>List</span>
              ${parent
                ? `<em>${escapeHtml(project?.name || 'Inbox')}</em>`
                : `<select data-task-project="${escapeAttribute(task.id)}" aria-label="List for ${escapeAttribute(task.title)}" ${disabled ? 'disabled' : ''}>
                    <option value="" ${task.projectId == null ? 'selected' : ''}>Inbox</option>
                    ${projectOptions(projects, task.projectId)}
                  </select>`}
            </label>
            <label class="task-detail-control">
              <span>Due</span>
              <input type="date" data-task-due="${escapeAttribute(task.id)}" value="${escapeAttribute(task.schedule?.dueDate || '')}" aria-label="Due date for ${escapeAttribute(task.title)}" ${disabled ? 'disabled' : ''}>
            </label>
            <label class="task-detail-control">
              <span>Priority</span>
              <select data-task-priority="${escapeAttribute(task.id)}" aria-label="Priority for ${escapeAttribute(task.title)}" ${disabled ? 'disabled' : ''}>
                ${['none', 'low', 'medium', 'high'].map((value) => `<option value="${value}" ${value === priority ? 'selected' : ''}>${PRIORITY_LABELS[value]}</option>`).join('')}
              </select>
            </label>
            <label class="task-detail-control">
              <span>${parent ? 'Parent' : 'Subtasks'}</span>
              <em>${parent ? escapeHtml(parent.title) : `${task.directSubtaskCount || 0}`}</em>
            </label>
          </div>
          <section class="task-detail-tags">
            <span class="task-detail-label">Tags</span>
            <div class="task-tag-editor">
              ${(task.tags || []).length
                ? (task.tags || []).map((tag) => `<span class="task-tag-chip">${escapeHtml(tag)}${trashed ? '' : `<button data-task-tag-remove="${escapeAttribute(tag)}" data-task-id="${escapeAttribute(task.id)}" type="button" aria-label="Remove tag ${escapeAttribute(tag)}">×</button>`}</span>`).join('')
                : '<em>No tags yet.</em>'}
            </div>
          </section>
          <label class="task-detail-notes" for="task-detail-notes">
            <span>Notes</span>
            <textarea id="task-detail-notes" name="notes" maxlength="20000" placeholder="Add context, links, or the next thought…" ${disabled ? 'disabled' : ''}>${escapeHtml(draft.notes)}</textarea>
          </label>
          ${ui.detailError ? `<p class="task-detail-error" role="alert">${escapeHtml(ui.detailError)}</p>` : ''}
          <footer class="task-detail-footer">
            ${trashed
              ? `<div class="task-detail-trash-actions">
                  <button class="task-detail-restore" data-task-restore="${escapeAttribute(task.id)}" type="button">Restore</button>
                  <button class="task-detail-delete" data-task-delete-request="${escapeAttribute(task.id)}" type="button">Delete forever</button>
                </div>
                <span class="task-detail-retention">Automatically deleted 30 days after ${escapeHtml(formatTimestampDate(task.trashedAt))}</span>`
              : `<button class="task-detail-delete" data-task-delete-request="${escapeAttribute(task.id)}" type="button" ${updating ? 'disabled' : ''}>Move to Trash</button>
                <div class="task-detail-save">
                  <span data-task-save-state aria-live="polite">${updating ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
                  <button type="submit" ${updating || !dirty ? 'disabled' : ''}>${updating ? 'Saving…' : 'Save changes'}</button>
                </div>`}
          </footer>
        </form>
        ${trashed ? '' : `<form class="task-detail-tag-form" data-task-tag-create="${escapeAttribute(task.id)}">
            <label class="visually-hidden" for="task-detail-tag">Add a tag to ${escapeHtml(task.title)}</label>
            <input id="task-detail-tag" name="tag" maxlength="40" autocomplete="off" placeholder="Add a tag…" required>
            <button type="submit">Add tag</button>
          </form>`}
      </article>
    </div>
  `;
}

function renderTaskDeleteConfirmation(task, ui) {
  const deleting = ui.deletingTaskId === task.id;
  const permanent = Boolean(task.trashedAt);
  const descendantCount = Math.max(0, Number(task.allSubtreeTotal || task.subtreeTotal || 1) - 1);
  const consequence = descendantCount
    ? `This also ${permanent ? 'deletes' : 'moves'} ${descendantCount} ${descendantCount === 1 ? 'subtask' : 'subtasks'} beneath it.`
    : permanent ? 'This permanently removes the task from LifeOS.' : 'This moves the task out of your active lists.';
  return `
    <div class="task-delete-backdrop">
      <section class="task-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-description" ${deleting ? 'aria-busy="true"' : ''}>
        <span class="smallcaps">${permanent ? 'Permanent deletion' : 'Recoverable deletion'}</span>
        <h2 id="delete-task-title">${permanent ? 'Delete' : 'Move'} “${escapeHtml(task.title)}” ${permanent ? 'forever' : 'to Trash'}?</h2>
        <p id="delete-task-description">${consequence} ${permanent ? 'This cannot be undone.' : 'Trash is cleaned automatically after 30 days; until then, you can restore it.'}</p>
        ${ui.deleteError ? `<p class="task-delete-error" role="alert">${escapeHtml(ui.deleteError)}</p>` : ''}
        <div class="task-delete-actions">
          <button data-task-delete-cancel type="button" ${deleting ? 'disabled' : ''}>Cancel</button>
          <button class="danger" ${permanent ? `data-task-delete-confirm="${escapeAttribute(task.id)}"` : `data-task-trash-confirm="${escapeAttribute(task.id)}"`} type="button" ${deleting ? 'disabled' : ''}>${deleting ? (permanent ? 'Deleting…' : 'Moving…') : (permanent ? 'Delete forever' : 'Move to Trash')}</button>
        </div>
      </section>
    </div>
  `;
}

function renderSubtaskForm(task, creating) {
  return `
    <form class="task-subtask-form" data-task-subtask-create="${escapeAttribute(task.id)}">
      <label class="visually-hidden" for="subtask-title-${escapeAttribute(task.id)}">New subtask under ${escapeHtml(task.title)}</label>
      <input id="subtask-title-${escapeAttribute(task.id)}" name="title" maxlength="300" autocomplete="off" placeholder="Describe the next step…" ${creating ? 'disabled' : ''} required>
      <label class="task-subtask-due"><span>Due</span><input name="dueDate" type="date" ${creating ? 'disabled' : ''}></label>
      <button type="submit" ${creating ? 'disabled' : ''}>Add</button>
      <button class="task-text-button" data-task-subtask-cancel type="button">Cancel</button>
    </form>
  `;
}

function renderTaskSummary(summary) {
  return `
    <div class="tasks-summary" aria-label="${summary.completed} of ${summary.total} tasks complete">
      <div class="tasks-summary-number">${Math.round(summary.progress * 100)}%</div>
      <div>
        <span>${summary.completed} of ${summary.total}</span>
        <i><b style="width:${Math.round(summary.progress * 100)}%"></b></i>
      </div>
    </div>
  `;
}

function renderCompactProgress(summary) {
  if (!summary.total) return '';
  return `<div class="project-task-progress" aria-label="${summary.completed} of ${summary.total} tasks complete"><i><b style="width:${Math.round(summary.progress * 100)}%"></b></i><span>${Math.round(summary.progress * 100)}%</span></div>`;
}

function renderDueDate(dueDate, today, completed = false) {
  if (!dueDate) return '';
  let label = formatShortDate(dueDate);
  let className = '';
  if (today && !completed) {
    const delta = dayDelta(dueDate, today);
    if (delta < 0) {
      label = `${Math.abs(delta)}d late`;
      className = 'overdue';
    } else if (delta === 0) {
      label = 'Today';
      className = 'today';
    } else if (delta === 1) {
      label = 'Tomorrow';
      className = 'soon';
    }
  }
  return `<time class="task-due ${className}" datetime="${escapeAttribute(dueDate)}">${escapeHtml(label)}</time>`;
}

function renderLifecycleDate(task, lifecycle) {
  if (lifecycle === 'trash' && task.trashedAt) {
    return `<time class="task-lifecycle-date" datetime="${escapeAttribute(task.trashedAt)}">Trashed ${escapeHtml(formatTimestampDate(task.trashedAt))}</time>`;
  }
  if (lifecycle === 'completed' && task.completedAt) {
    return `<time class="task-lifecycle-date" datetime="${escapeAttribute(task.completedAt)}">Done ${escapeHtml(formatTimestampDate(task.completedAt))}</time>`;
  }
  return '';
}

function renderTaskEmpty(label, copy = null) {
  return `<div class="task-empty"><span aria-hidden="true">✓</span><h3>${escapeHtml(label)} is clear.</h3><p>${escapeHtml(copy || 'Add a task above or choose another scope.')}</p></div>`;
}

function groupTasks(tasks, ui, projects, today) {
  const sorted = sortTasks(tasks, ui.sortBy);
  if (ui.groupBy === 'none' || !TASK_GROUPINGS.includes(ui.groupBy)) {
    return [{ id: 'all', label: '', tasks: sorted }];
  }
  const buckets = new Map();
  const push = (id, label, color, task) => {
    if (!buckets.has(id)) buckets.set(id, { id, label, color, tasks: [] });
    buckets.get(id).tasks.push(task);
  };
  const order = groupOrder(ui.groupBy, projects);
  for (const task of sorted) {
    for (const bucket of taskBuckets(task, ui.groupBy, projects, today)) {
      push(bucket.id, bucket.label, bucket.color, task);
    }
  }
  const indexOf = (id) => {
    const index = order.indexOf(id);
    return index < 0 ? order.length : index;
  };
  return [...buckets.values()].sort((a, b) => indexOf(a.id) - indexOf(b.id) || a.label.localeCompare(b.label));
}

function taskBuckets(task, groupBy, projects, today) {
  if (groupBy === 'priority') {
    const priority = normalizePriority(task.priority);
    return [{ id: `priority:${priority}`, label: priority === 'none' ? 'No priority' : `${PRIORITY_LABELS[priority]} priority`, color: priorityColor(priority) }];
  }
  if (groupBy === 'project') {
    const project = projects.find((candidate) => candidate.id === task.projectId);
    return [{ id: `project:${task.projectId || 'inbox'}`, label: project?.name || 'Inbox', color: null }];
  }
  if (groupBy === 'tag') {
    const tags = task.tags || [];
    if (!tags.length) return [{ id: 'tag:', label: 'No tag', color: null }];
    return tags.map((tag) => ({ id: `tag:${normalizeText(tag)}`, label: tag, color: null }));
  }
  return [dueBucket(task.schedule?.dueDate, today)];
}

function dueBucket(dueDate, today) {
  if (!dueDate) return { id: 'due:none', label: 'No date', color: null };
  if (!today) return { id: 'due:dated', label: 'Scheduled', color: null };
  const delta = dayDelta(dueDate, today);
  if (delta < 0) return { id: 'due:overdue', label: 'Overdue', color: 'var(--critical)' };
  if (delta === 0) return { id: 'due:today', label: 'Today', color: 'var(--attention)' };
  if (delta === 1) return { id: 'due:tomorrow', label: 'Tomorrow', color: null };
  if (delta <= 7) return { id: 'due:week', label: 'Next 7 days', color: null };
  return { id: 'due:later', label: 'Later', color: null };
}

function groupOrder(groupBy, projects) {
  if (groupBy === 'priority') return TASK_PRIORITIES.map((priority) => `priority:${priority}`);
  if (groupBy === 'due') return ['due:overdue', 'due:today', 'due:tomorrow', 'due:week', 'due:later', 'due:dated', 'due:none'];
  if (groupBy === 'project') {
    return ['project:inbox', ...[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((project) => `project:${project.id}`)];
  }
  return [];
}

function sortTasks(tasks, sortBy) {
  const items = [...tasks];
  if (sortBy === 'priority') {
    return items.sort((a, b) => completionDelta(a, b)
      || PRIORITY_RANK[normalizePriority(a.priority)] - PRIORITY_RANK[normalizePriority(b.priority)]
      || a.title.localeCompare(b.title));
  }
  if (sortBy === 'due') {
    return items.sort((a, b) => completionDelta(a, b)
      || compareDueDates(a.schedule?.dueDate, b.schedule?.dueDate)
      || a.title.localeCompare(b.title));
  }
  if (sortBy === 'title') {
    return items.sort((a, b) => completionDelta(a, b) || a.title.localeCompare(b.title));
  }
  if (sortBy === 'created') {
    return items.sort((a, b) => completionDelta(a, b)
      || Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }
  return items;
}

function completionDelta(a, b) {
  return (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0);
}

function compareDueDates(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

function taskTree(items) {
  const tree = new Map();
  for (const item of items) {
    const key = item.parentTaskId || null;
    if (!tree.has(key)) tree.set(key, []);
    tree.get(key).push(item);
  }
  return tree;
}

function taskSubsetRoots(items, predicate) {
  const matching = items.filter(predicate);
  const matchingIds = new Set(matching.map((task) => task.id));
  return matching.filter((task) => !task.parentTaskId || !matchingIds.has(task.parentTaskId));
}

function taskScope(filter, tasks, projects, today) {
  if (filter === 'today' || filter === 'next7') {
    const horizon = filter === 'today' ? 0 : 7;
    const scheduled = tasks.items.filter((task) => !task.trashedAt && dueWithin(task, today, horizon));
    const items = scheduled.filter(isOpenTask);
    const completedItems = scheduled.filter(isCompletedTask);
    return {
      label: filter === 'today' ? 'Today' : 'Next 7 days',
      copy: filter === 'today'
        ? 'Everything overdue or due before the day ends.'
        : 'Every dated commitment landing inside the coming week.',
      summary: summarize(scheduled),
      items,
      completedItems,
      flat: true,
      lifecycle: 'active',
      emptyCopy: completedItems.length ? 'Open tasks are clear; completed work is folded below.' : null,
    };
  }
  if (filter === 'completed') {
    const completed = tasks.items.filter(isCompletedTask);
    return {
      label: 'Completed',
      copy: 'Finished work, kept apart from active commitments.',
      summary: summarize(completed),
      items: taskSubsetRoots(tasks.items, isCompletedTask),
      flat: false,
      lifecycle: 'completed',
      emptyCopy: 'Completed tasks will collect here.',
    };
  }
  if (filter === 'trash') {
    const trashed = tasks.items.filter(isTrashedTask);
    return {
      label: 'Trash',
      copy: 'Recover tasks here before automatic deletion after 30 days.',
      summary: summarize(trashed),
      items: taskSubsetRoots(tasks.items, isTrashedTask),
      flat: false,
      lifecycle: 'trash',
      emptyCopy: 'Deleted tasks will remain here for 30 days.',
    };
  }
  if (filter === 'inbox') {
    return {
      label: 'Inbox',
      copy: 'Independent commitments without a project.',
      summary: tasks.summary.inbox,
      items: taskSubsetRoots(tasks.items, (task) => isOpenTask(task) && task.projectId == null),
      flat: false,
      lifecycle: 'active',
    };
  }
  if (filter.startsWith('project:')) {
    const project = projects.find((candidate) => candidate.id === filter.slice(8));
    return {
      label: project?.name || 'Project tasks',
      copy: 'Project work and its next concrete steps.',
      summary: tasks.summary.byProject[project?.id] || summarize([]),
      items: taskSubsetRoots(tasks.items, (task) => isOpenTask(task) && task.projectId === project?.id),
      flat: false,
      lifecycle: 'active',
    };
  }
  if (filter.startsWith('tag:')) {
    const label = filter.slice(4);
    const tagged = tasks.items.filter((task) => !task.trashedAt && (task.tags || [])
      .some((tag) => normalizeText(tag) === normalizeText(label)));
    return {
      label: `#${label}`,
      copy: 'Every task carrying this tag, across lists.',
      summary: summarize(tagged),
      items: tagged.filter(isOpenTask),
      flat: true,
      lifecycle: 'active',
    };
  }
  return {
    label: 'All tasks',
    copy: 'Independent and project work in one place.',
    summary: tasks.summary,
    items: taskSubsetRoots(tasks.items, isOpenTask),
    flat: false,
    lifecycle: 'active',
  };
}

function dueWithin(task, today, horizon) {
  const dueDate = task.schedule?.dueDate;
  if (!dueDate || !today) return false;
  const delta = dayDelta(dueDate, today);
  return delta <= horizon;
}

function smartListCounts(items, today) {
  return {
    today: items.filter((task) => isOpenTask(task) && dueWithin(task, today, 0)).length,
    next7: items.filter((task) => isOpenTask(task) && dueWithin(task, today, 7)).length,
  };
}

function collectTags(items) {
  const byKey = new Map();
  for (const task of items) {
    if (task.trashedAt) continue;
    for (const tag of task.tags || []) {
      const key = normalizeText(tag);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { label: tag, total: 0, open: 0 });
      const entry = byKey.get(key);
      entry.total += 1;
      if (task.status !== 'completed') entry.open += 1;
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function normalizeTaskFilter(filter, projects, tasks = null) {
  if (['inbox', 'today', 'next7', 'completed', 'trash'].includes(filter)) return filter;
  if (filter?.startsWith('project:') && projects.some((project) => project.id === filter.slice(8))) return filter;
  if (filter?.startsWith('tag:') && filter.length > 4) {
    if (!tasks) return filter;
    const known = collectTags(tasks.items)
      .find((tag) => tag.open > 0 && normalizeText(tag.label) === normalizeText(filter.slice(4)));
    return known ? `tag:${known.label}` : 'all';
  }
  return 'all';
}

export function canReorder(ui) {
  return ui.sortBy === 'manual' && ui.groupBy === 'none';
}

function isTrashedTask(task) {
  return Boolean(task.trashedAt);
}

function isOpenTask(task) {
  return !task.trashedAt && task.status === 'open';
}

function isCompletedTask(task) {
  return !task.trashedAt && task.status === 'completed';
}

function taskMatchesLifecycle(task, lifecycle) {
  if (lifecycle === 'trash') return isTrashedTask(task);
  if (lifecycle === 'completed') return isCompletedTask(task);
  return isOpenTask(task);
}

function taskDropEnabled(filter) {
  return filter === 'inbox' || filter.startsWith('project:') || filter.startsWith('tag:');
}

function projectName(projects, projectId) {
  if (!projectId) return 'Inbox';
  return projects.find((project) => project.id === projectId)?.name || 'Inbox';
}

function normalizePriority(value) {
  return TASK_PRIORITIES.includes(value) ? value : 'none';
}

function priorityColor(priority) {
  if (priority === 'none') return null;
  return `var(--priority-${priority})`;
}

function projectOptions(projects, selectedProjectId) {
  return [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => `<option value="${escapeAttribute(project.id)}" ${project.id === selectedProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`)
    .join('');
}

function summarize(items) {
  const total = items.length;
  const completed = items.filter((task) => task.status === 'completed').length;
  return { total, completed, open: total - completed, progress: total ? completed / total : 0 };
}

function dayDelta(date, today) {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

export function shiftDate(date, days) {
  const shifted = new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

function formatTimestampDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
