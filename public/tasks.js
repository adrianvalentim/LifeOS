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
  };
}

export function renderTasks(tasks, projects, domains, ui, options = {}) {
  const filter = normalizeTaskFilter(ui.filter, projects);
  const roots = scopedTaskRoots(tasks.items, filter);
  const scope = taskScope(filter, tasks, projects);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const tree = taskTree(tasks.items);
  return `
    <div class="tasks-workspace">
      ${renderTaskSidebar(tasks, projects, domains, filter)}
      <main class="tasks-main">
        <header class="tasks-header">
          <div>
            <span class="tasks-eyebrow">Task ledger</span>
            <h1>${escapeHtml(scope.label)}</h1>
            <p>${escapeHtml(scope.copy)}</p>
          </div>
          ${renderTaskSummary(scope.summary)}
        </header>
        ${renderTaskCreateForm(projects, filter, ui.creating)}
        <section class="task-list-section" aria-labelledby="task-list-heading">
          <div class="task-list-heading">
            <h2 id="task-list-heading">${scope.summary.open} open</h2>
            <span>${scope.summary.completed} completed</span>
          </div>
          ${roots.length
            ? `<ul class="task-tree task-root-list">${roots.map((task) => renderTaskNode(task, tree, projectById, domains, ui, options)).join('')}</ul>`
            : renderTaskEmpty(scope.label)}
        </section>
      </main>
    </div>
  `;
}

export function renderProjectTaskPanel(tasks, project, domains, ui, options = {}) {
  if (!tasks) return '';
  const projectTasks = tasks.items.filter((task) => task.projectId === project.id);
  const roots = projectTasks.filter((task) => task.parentTaskId == null);
  const tree = taskTree(projectTasks);
  const projectById = new Map([[project.id, project]]);
  const summary = project.taskSummary || summarize(projectTasks);
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
        ? `<ul class="task-tree project-task-tree">${roots.map((task) => renderTaskNode(task, tree, projectById, domains, ui, { ...options, compact: true })).join('')}</ul>`
        : '<p class="project-task-empty">No tasks are associated with this project yet.</p>'}
    </section>
  `;
}

export function renderTaskOverlays(tasks, projects, ui, options = {}) {
  const selected = tasks?.items.find((task) => task.id === ui.selectedTaskId);
  const deleteTarget = tasks?.items.find((task) => task.id === ui.deleteTaskId);
  return `${selected ? renderTaskDetail(selected, tasks, projects, ui, options) : ''}${deleteTarget ? renderTaskDeleteConfirmation(deleteTarget, ui) : ''}`;
}

function renderTaskSidebar(tasks, projects, domains, activeFilter) {
  return `
    <aside class="task-sidebar" aria-label="Task scopes">
      <div class="task-sidebar-title">Lists</div>
      ${taskFilterButton('all', 'All tasks', tasks.summary.open, activeFilter)}
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
    </aside>
  `;
}

function taskFilterButton(filter, label, count, activeFilter, kind = 'all', color = null) {
  return `
    <button class="task-filter ${filter === activeFilter ? 'active' : ''}" data-task-filter="${escapeAttribute(filter)}" type="button" ${filter === activeFilter ? 'aria-current="page"' : ''} style="${color ? `--task-project:${escapeAttribute(color)}` : ''}">
      <span class="task-filter-icon ${kind}" aria-hidden="true"></span>
      <span>${escapeHtml(label)}</span>
      <b>${count}</b>
    </button>
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
        <input id="new-task-title" name="title" maxlength="300" autocomplete="off" placeholder="Add a task…" ${creating ? 'disabled' : ''} required>
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
      <button class="task-add-button" type="submit" ${creating ? 'disabled' : ''}>${creating ? 'Adding…' : 'Add task'}</button>
    </form>
  `;
}

function renderTaskNode(task, tree, projectById, domains, ui, options = {}) {
  const children = tree.get(task.id) || [];
  const project = task.projectId ? projectById.get(task.projectId) : null;
  const domain = project ? domains[project.domain] : null;
  const saving = ui.savingTaskId === task.id;
  const completed = task.status === 'completed';
  const checkboxLabel = completed ? `Reopen ${task.title}` : task.subtreeTotal > 1
    ? `Complete ${task.title} and its subtasks`
    : `Complete ${task.title}`;
  return `
    <li class="task-node ${completed ? 'is-completed' : ''}" data-task-node="${escapeAttribute(task.id)}" style="--task-domain:${escapeAttribute(domain?.color || 'var(--ink-faint)')}">
      <article class="task-item ${saving ? 'is-saving' : ''}" data-task-detail="${escapeAttribute(task.id)}" ${saving ? 'aria-busy="true"' : ''}>
        <label class="task-checkbox">
          <input type="checkbox" data-task-completion="${escapeAttribute(task.id)}" aria-label="${escapeAttribute(checkboxLabel)}" ${completed ? 'checked' : ''} ${saving ? 'disabled' : ''}>
          <span aria-hidden="true"></span>
        </label>
        <div class="task-copy">
          <div class="task-title-line">
            <button class="task-title" data-task-detail-button="${escapeAttribute(task.id)}" type="button" aria-label="Open details for ${escapeAttribute(task.title)}">${escapeHtml(task.title)}</button>
            ${task.directSubtaskCount ? `<span class="task-subtask-count">${task.directSubtaskCount} ${task.directSubtaskCount === 1 ? 'subtask' : 'subtasks'}</span>` : ''}
          </div>
          <div class="task-meta">
            ${options.compact
              ? `<span class="task-project-label">${escapeHtml(project?.name || 'Inbox')}</span>`
              : renderTaskProjectControl(task, projectById, saving)}
            ${renderDueDate(task.schedule?.dueDate, options.today)}
            ${task.notes ? '<span class="task-note-indicator">Notes</span>' : ''}
            ${task.subtreeTotal > 1 ? `<span class="task-progress-copy">${task.subtreeCompleted}/${task.subtreeTotal} complete</span>` : ''}
          </div>
          ${task.subtreeTotal > 1 ? renderSubtreeProgress(task) : ''}
        </div>
        <button class="task-subtask-button" data-task-subtask-open="${escapeAttribute(task.id)}" type="button" aria-expanded="${ui.addingSubtaskToId === task.id ? 'true' : 'false'}" ${saving ? 'disabled' : ''}>+ Subtask</button>
      </article>
      ${ui.addingSubtaskToId === task.id ? renderSubtaskForm(task, ui.creating) : ''}
      ${children.length ? `<ul class="task-tree task-children">${children.map((child) => renderTaskNode(child, tree, projectById, domains, ui, options)).join('')}</ul>` : ''}
    </li>
  `;
}

function renderTaskDetail(task, tasks, projects, ui, options) {
  const project = task.projectId ? projects.find((candidate) => candidate.id === task.projectId) : null;
  const parent = task.parentTaskId ? tasks.items.find((candidate) => candidate.id === task.parentTaskId) : null;
  const draft = ui.detailDraft && ui.selectedTaskId === task.id
    ? ui.detailDraft
    : { title: task.title, notes: task.notes || '' };
  const dirty = draft.title !== task.title || draft.notes !== (task.notes || '');
  const updating = ui.updatingTaskId === task.id;
  return `
    <div class="task-detail-backdrop" data-task-detail-close>
      <article class="task-detail" role="dialog" aria-modal="true" aria-labelledby="task-detail-dialog-title" ${updating ? 'aria-busy="true"' : ''}>
        <button class="task-detail-close" data-task-detail-close type="button" aria-label="Close task details">×</button>
        <header class="task-detail-heading">
          <span class="tasks-eyebrow" id="task-detail-dialog-title">Task details</span>
          <span class="task-detail-status ${task.status}">${task.status === 'completed' ? 'Completed' : 'Open'}</span>
        </header>
        <form class="task-detail-form" data-task-update="${escapeAttribute(task.id)}">
          <label class="task-detail-title-field" for="task-detail-title">
            <span class="visually-hidden">Task title</span>
            <input id="task-detail-title" name="title" maxlength="300" value="${escapeAttribute(draft.title)}" ${updating ? 'disabled' : ''} required>
          </label>
          <div class="task-detail-metadata">
            <span><b>List</b>${escapeHtml(project?.name || 'Inbox')}</span>
            <span><b>Due</b>${task.schedule?.dueDate ? escapeHtml(formatShortDate(task.schedule.dueDate)) : 'No date'}</span>
            <span><b>${parent ? 'Parent' : 'Subtasks'}</b>${parent ? escapeHtml(parent.title) : `${task.directSubtaskCount || 0}`}</span>
          </div>
          <label class="task-detail-notes" for="task-detail-notes">
            <span>Notes</span>
            <textarea id="task-detail-notes" name="notes" maxlength="20000" placeholder="Add context, links, or the next thought…" ${updating ? 'disabled' : ''}>${escapeHtml(draft.notes)}</textarea>
          </label>
          ${ui.detailError ? `<p class="task-detail-error" role="alert">${escapeHtml(ui.detailError)}</p>` : ''}
          <footer class="task-detail-footer">
            <button class="task-detail-delete" data-task-delete-request="${escapeAttribute(task.id)}" type="button" ${updating ? 'disabled' : ''}>Delete task</button>
            <div class="task-detail-save">
              <span data-task-save-state aria-live="polite">${updating ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
              <button type="submit" ${updating || !dirty ? 'disabled' : ''}>${updating ? 'Saving…' : 'Save changes'}</button>
            </div>
          </footer>
        </form>
      </article>
    </div>
  `;
}

function renderTaskDeleteConfirmation(task, ui) {
  const deleting = ui.deletingTaskId === task.id;
  const descendantCount = Math.max(0, Number(task.subtreeTotal || 1) - 1);
  const consequence = descendantCount
    ? `This also removes ${descendantCount} ${descendantCount === 1 ? 'subtask' : 'subtasks'} beneath it.`
    : 'This removes the task from LifeOS.';
  return `
    <div class="task-delete-backdrop">
      <section class="task-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-description" ${deleting ? 'aria-busy="true"' : ''}>
        <span class="smallcaps">Permanent deletion</span>
        <h2 id="delete-task-title">Delete “${escapeHtml(task.title)}”?</h2>
        <p id="delete-task-description">${consequence} This cannot be undone inside the app.</p>
        ${ui.deleteError ? `<p class="task-delete-error" role="alert">${escapeHtml(ui.deleteError)}</p>` : ''}
        <div class="task-delete-actions">
          <button data-task-delete-cancel type="button" ${deleting ? 'disabled' : ''}>Cancel</button>
          <button class="danger" data-task-delete-confirm="${escapeAttribute(task.id)}" type="button" ${deleting ? 'disabled' : ''}>${deleting ? 'Deleting…' : 'Delete task'}</button>
        </div>
      </section>
    </div>
  `;
}

function renderTaskProjectControl(task, projectById, saving) {
  if (task.parentTaskId) {
    return `<span class="task-project-label">${escapeHtml(task.projectId ? projectById.get(task.projectId)?.name || 'Project' : 'Inbox')}</span>`;
  }
  return `
    <label class="task-project-select">
      <span class="visually-hidden">Project for ${escapeHtml(task.title)}</span>
      <select data-task-project="${escapeAttribute(task.id)}" aria-label="Project for ${escapeAttribute(task.title)}" ${saving ? 'disabled' : ''}>
        <option value="" ${task.projectId == null ? 'selected' : ''}>Inbox</option>
        ${projectOptions([...projectById.values()], task.projectId)}
      </select>
    </label>
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

function renderSubtreeProgress(task) {
  const percentage = Math.round(task.progress * 100);
  return `<div class="task-subtree-progress" aria-label="${percentage}% complete"><i><b style="width:${percentage}%"></b></i></div>`;
}

function renderDueDate(dueDate, today) {
  if (!dueDate) return '';
  let label = dueDate;
  let className = '';
  if (today) {
    const delta = Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    if (delta < 0) {
      label = `${Math.abs(delta)}d overdue`;
      className = 'overdue';
    } else if (delta === 0) {
      label = 'Due today';
      className = 'today';
    } else if (delta === 1) {
      label = 'Due tomorrow';
    } else {
      label = `Due ${formatShortDate(dueDate)}`;
    }
  }
  return `<time class="task-due ${className}" datetime="${escapeAttribute(dueDate)}">${escapeHtml(label)}</time>`;
}

function renderTaskEmpty(label) {
  return `<div class="task-empty"><span aria-hidden="true">✓</span><h3>${escapeHtml(label)} is clear.</h3><p>Add a task above or choose another scope.</p></div>`;
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

function scopedTaskRoots(items, filter) {
  return items.filter((task) => task.parentTaskId == null && (
    filter === 'all'
    || (filter === 'inbox' && task.projectId == null)
    || (filter.startsWith('project:') && task.projectId === filter.slice(8))
  ));
}

function taskScope(filter, tasks, projects) {
  if (filter === 'inbox') {
    return { label: 'Inbox', copy: 'Independent commitments without a project.', summary: tasks.summary.inbox };
  }
  if (filter.startsWith('project:')) {
    const project = projects.find((candidate) => candidate.id === filter.slice(8));
    return {
      label: project?.name || 'Project tasks',
      copy: 'Project work and its next concrete steps.',
      summary: tasks.summary.byProject[project?.id] || summarize([]),
    };
  }
  return { label: 'All tasks', copy: 'Independent and project work in one place.', summary: tasks.summary };
}

function normalizeTaskFilter(filter, projects) {
  if (filter === 'inbox') return filter;
  if (filter?.startsWith('project:') && projects.some((project) => project.id === filter.slice(8))) return filter;
  return 'all';
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

function formatShortDate(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
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
