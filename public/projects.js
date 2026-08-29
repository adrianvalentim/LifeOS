import { renderCodexContextButton } from './codex-context.js';
import { renderProjectTaskPanel } from './tasks.js';

export const PROJECT_STATUS_LABELS = {
  to_do: 'To do',
  next_up: 'Next up',
  doing: 'Doing',
  paused: 'Paused',
  done: 'Done',
  dropped: 'Dropped',
};

export const PROJECT_STATUS_DESCRIPTIONS = {
  to_do: 'Someday, not yet committed',
  next_up: 'Ready to begin',
  doing: 'Actively receiving attention',
  paused: 'Intentionally on hold',
  done: 'Completed history',
  dropped: 'Deliberately abandoned',
};

export const PROJECT_BOARD_STATUSES = ['next_up', 'doing', 'done'];
export const ACTIVE_PROJECT_STATUSES = ['to_do', 'next_up', 'doing'];
export const PROJECT_LIST_STATUSES = Object.keys(PROJECT_STATUS_LABELS);

const PROJECT_FILTER_PRESETS = [
  { id: 'all', label: 'All', statuses: PROJECT_LIST_STATUSES },
  { id: 'next_doing', label: 'Next up + Doing', statuses: ['next_up', 'doing'] },
  { id: 'doing', label: 'Doing', statuses: ['doing'] },
  { id: 'done', label: 'Done', statuses: ['done'] },
];

export function createProjectsUiState() {
  return {
    view: 'list',
    statusFilter: [...PROJECT_LIST_STATUSES],
    filtersOpen: false,
    statusNotice: null,
    selectedProjectId: null,
    deleteProjectId: null,
    deletingProjectId: null,
    deleteError: null,
    movingProjectId: null,
  };
}

export function projectsWithStatus(dashboard, projectId, status) {
  const current = dashboard?.projects?.find((project) => project.id === projectId);
  if (!current || current.status === status || !PROJECT_LIST_STATUSES.includes(status)) return dashboard;

  const projects = dashboard.projects.map((project) => project.id === projectId ? { ...project, status } : project);
  const activeCount = projects.filter((project) => ACTIVE_PROJECT_STATUSES.includes(project.status)).length;
  const criticalCount = projects.filter((project) => ACTIVE_PROJECT_STATUSES.includes(project.status) && project.health === 'critical').length;
  return {
    ...dashboard,
    projects,
    summary: {
      ...dashboard.summary,
      activeCount,
      criticalCount,
    },
  };
}

export function normalizeProjectStatusFilter(value) {
  const requested = Array.isArray(value) ? value : String(value || '').split(',');
  const selected = new Set(requested.filter((status) => PROJECT_LIST_STATUSES.includes(status)));
  return selected.size ? PROJECT_LIST_STATUSES.filter((status) => selected.has(status)) : [...PROJECT_LIST_STATUSES];
}

export function projectStatusFilterPreset(statuses) {
  const normalized = normalizeProjectStatusFilter(statuses);
  return PROJECT_FILTER_PRESETS.find((preset) => sameStatuses(normalized, preset.statuses))?.id || 'custom';
}

export function renderProjects(projects, domains, ui, options = {}) {
  const selected = projects.find((project) => project.id === ui.selectedProjectId);
  const deleteTarget = projects.find((project) => project.id === ui.deleteProjectId);
  return `
    <div class="projects-workspace">
      <div class="projects-toolbar">
        ${ui.view === 'list' ? renderProjectListControls(projects, ui) : '<p class="project-board-purpose">Focused execution: Next up, Doing, and Done</p>'}
        <div class="project-view-switch" role="group" aria-label="Projects view">
          <button class="project-view-button ${ui.view === 'list' ? 'active' : ''}" data-project-view="list" type="button">List</button>
          <button class="project-view-button ${ui.view === 'kanban' ? 'active' : ''}" data-project-view="kanban" type="button">Kanban</button>
        </div>
      </div>
      ${ui.view === 'list' && ui.filtersOpen ? renderProjectFilters(projects, ui) : ''}
      ${renderProjectStatusNotice(ui)}
      ${ui.view === 'kanban' ? renderProjectBoard(projects, domains, ui) : renderProjectList(projects, domains, ui)}
      ${selected ? renderProjectDetail(selected, domains[selected.domain], ui.movingProjectId === selected.id, domains, { ...options, statusFilter: ui.statusFilter }) : ''}
      ${deleteTarget ? renderDeleteConfirmation(deleteTarget, ui) : ''}
    </div>
  `;
}

function renderProjectListControls(projects, ui) {
  const activePreset = projectStatusFilterPreset(ui.statusFilter);
  return `
    <div class="project-list-tools">
      <div class="project-focus-presets" role="group" aria-label="Project status focus">
        <span class="project-tool-label">Focus</span>
        ${PROJECT_FILTER_PRESETS.map((preset) => `<button class="project-focus-button ${activePreset === preset.id ? 'active' : ''}" data-project-filter-preset="${preset.statuses.join(',')}" type="button" aria-pressed="${activePreset === preset.id}">${preset.label}</button>`).join('')}
        <button class="project-focus-button project-custom-filter ${activePreset === 'custom' ? 'active' : ''}" data-project-filter-toggle type="button" aria-expanded="${ui.filtersOpen}" aria-controls="project-status-filters">${activePreset === 'custom' ? `${ui.statusFilter.length} statuses` : 'Custom'}</button>
      </div>
    </div>
  `;
}

function renderProjectFilters(projects, ui) {
  return `
    <div class="project-status-filters" id="project-status-filters">
      <span class="smallcaps">Show statuses</span>
      <div class="project-status-filter-options">
        ${PROJECT_LIST_STATUSES.map((status) => {
          const selected = ui.statusFilter.includes(status);
          const count = projects.filter((project) => project.status === status).length;
          return `<button class="project-status-filter ${selected ? 'active' : ''}" data-project-filter-status="${status}" type="button" aria-pressed="${selected}"><span class="project-status-dot status-${status}"></span>${PROJECT_STATUS_LABELS[status]} <b>${count}</b></button>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderProjectStatusNotice(ui) {
  const notice = ui.statusNotice;
  if (!notice) return '';
  return `
    <div class="project-status-notice" role="status">
      <span><b>${escapeHtml(notice.name)}</b> moved to ${escapeHtml(PROJECT_STATUS_LABELS[notice.toStatus])}. It is outside the current focus.</span>
      <span class="project-status-notice-actions">
        <button data-project-notice-show="${notice.toStatus}" type="button">Show ${escapeHtml(PROJECT_STATUS_LABELS[notice.toStatus])}</button>
        <button data-project-notice-undo="${escapeAttribute(notice.projectId)}" data-project-notice-status="${notice.fromStatus}" type="button">Undo</button>
        <button data-project-notice-dismiss type="button" aria-label="Dismiss status message">×</button>
      </span>
    </div>
  `;
}

function renderProjectList(projects, domains, ui) {
  const sections = PROJECT_LIST_STATUSES.map((status) => {
    const items = projects.filter((project) => project.status === status);
    return { status, items, live: items.length > 0 && ui.statusFilter.includes(status) };
  });
  if (!sections.some((section) => section.live)) {
    return `<div class="project-list-empty"><p>No projects match this focus.</p><button data-project-filter-preset="${PROJECT_LIST_STATUSES.join(',')}" type="button">Show all projects</button></div>`;
  }
  return `
    <div class="projects-list project-move-surface ${ui.movingProjectId ? 'is-saving' : ''}" aria-label="Project portfolio" aria-describedby="project-move-instructions" ${ui.movingProjectId ? 'aria-busy="true"' : ''}>
      <p class="project-move-instructions" id="project-move-instructions">Hold or drag a project to reveal every status lane, then drop it on one. Keyboard users can focus a project and press Control plus the left or right arrow key.</p>
      ${sections.map((section) => section.live ? renderProjectListSection(section, domains, ui) : renderProjectListLane(section)).join('')}
    </div>
  `;
}

function renderProjectListSection({ status, items }, domains, ui) {
  return `
    <section class="project-list-section status-${status}" data-project-drop-status="${status}" data-project-drop-label="${PROJECT_STATUS_LABELS[status]}">
      <div class="project-list-section-inner">
        <header class="project-list-section-head">
          <div><span class="project-status-dot status-${status}"></span><h2>${PROJECT_STATUS_LABELS[status]}</h2><span>${PROJECT_STATUS_DESCRIPTIONS[status]}</span></div>
          <b>${items.length}</b>
        </header>
        <div class="projects-grid project-list-section-body">
          ${items.map((project) => renderProjectEntry(project, domains[project.domain], ui)).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderProjectListLane({ status, items }) {
  const hint = items.length ? `${items.length} hidden by focus \u00b7 drop here` : 'Drop a project here';
  return `
    <section class="project-list-section project-list-lane status-${status}" data-project-drop-status="${status}" data-project-drop-label="${PROJECT_STATUS_LABELS[status]}" data-project-latent="true" aria-hidden="true">
      <div class="project-list-section-inner">
        <header class="project-list-section-head">
          <div><span class="project-status-dot status-${status}"></span><h2>${PROJECT_STATUS_LABELS[status]}</h2><span>${PROJECT_STATUS_DESCRIPTIONS[status]}</span></div>
          <span class="project-list-drop-hint" data-hint="${escapeAttribute(hint)}" data-hint-active="Release here"></span>
        </header>
      </div>
    </section>
  `;
}

function renderProjectBoard(projects, domains, ui) {
  return `
    <div class="project-board project-move-surface ${ui.movingProjectId ? 'is-saving' : ''}" aria-describedby="project-board-instructions" ${ui.movingProjectId ? 'aria-busy="true"' : ''}>
      <p class="project-board-instructions" id="project-board-instructions">Drag projects between columns. Keyboard users can focus a card and press Control plus the left or right arrow key.</p>
      ${PROJECT_BOARD_STATUSES.map((status) => {
        const items = projects.filter((project) => project.status === status);
        return `
          <section class="project-column status-${status}" data-project-drop-status="${status}" data-project-drop-label="${PROJECT_STATUS_LABELS[status]}">
            <header class="project-column-head">
              <div><span class="project-column-mark"></span><h2>${PROJECT_STATUS_LABELS[status]}</h2></div>
              <span class="project-column-count">${items.length}</span>
            </header>
            <div class="project-column-body">
              ${items.length ? items.map((project) => renderProjectBoardCard(project, domains[project.domain], ui)).join('') : '<div class="project-column-empty">Drop a project here</div>'}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function renderProjectEntry(project, domain, ui) {
  const moving = ui.movingProjectId === project.id;
  return `
    <article class="project-entry project-openable is-movable ${moving ? 'is-saving' : ''}" style="--domain:${escapeAttribute(domain.color)}" data-project-detail="${escapeAttribute(project.id)}" data-project-drag-id="${escapeAttribute(project.id)}" data-project-drag-status="${project.status}" aria-roledescription="movable project" role="button" tabindex="0" aria-label="${escapeAttribute(project.name)}. ${escapeAttribute(PROJECT_STATUS_LABELS[project.status])}." ${moving ? 'aria-busy="true"' : ''}>
      <div class="swatch"></div>
      <div>${renderProjectContent(project, domain)}</div>
    </article>
  `;
}

function renderProjectBoardCard(project, domain, ui) {
  const moving = ui.movingProjectId === project.id;
  return `
    <article class="project-board-card project-openable ${moving ? 'is-saving' : ''}" style="--domain:${escapeAttribute(domain.color)}" data-project-drag-id="${escapeAttribute(project.id)}" data-project-drag-status="${project.status}" data-project-detail="${escapeAttribute(project.id)}" role="button" tabindex="0" aria-roledescription="movable project" aria-label="${escapeAttribute(project.name)}. ${escapeAttribute(PROJECT_STATUS_LABELS[project.status])}." ${moving ? 'aria-busy="true"' : ''}>
      <span class="project-drag-grip" aria-hidden="true">⠿</span>
      <div class="project-card-rule"></div>
      <div>${renderProjectContent(project, domain)}</div>
    </article>
  `;
}

function renderProjectContent(project, domain, { showStatus = false } = {}) {
  const healthColor = healthColorFor(project.health);
  const due = dueLabel(project.dueInDays);
  const lastClass = project.lastTouchedLabel.includes('h ago') || project.lastTouchedLabel.includes('m ago') ? 'healthy' : project.health === 'critical' ? 'critical' : '';
  const dueClass = project.dueInDays != null && project.dueInDays <= 3 ? 'critical' : '';
  return `
    <div class="project-head">
      <div class="project-name">${escapeHtml(project.name)}</div>
      <div class="project-domain">${escapeHtml(domain.label)}</div>
      <div class="health-tag" style="color:${healthColor}"><span class="status-dot"></span>${escapeHtml(project.health)}</div>
    </div>
    <div class="project-subtitle">${escapeHtml(project.subtitle)}</div>
    ${renderProjectCategories(project.categoryLabels)}
    <div class="project-note">${escapeHtml(project.note)}</div>
    <div class="project-stats">
      ${showStatus ? `<span class="stat"><span class="stat-k">Status</span><span class="stat-v project-status-value">${escapeHtml(PROJECT_STATUS_LABELS[project.status])}</span></span>` : ''}
      <span class="stat"><span class="stat-k">Last</span><span class="stat-v ${lastClass}">${escapeHtml(project.lastTouchedLabel)}</span></span>
      <span class="stat"><span class="stat-k">Week</span><span class="stat-v">${escapeHtml(project.weekHoursLabel)}</span></span>
      <span class="stat"><span class="stat-k">Due</span><span class="stat-v ${dueClass}">${escapeHtml(due)}</span></span>
      ${project.taskSummary?.total ? `<span class="stat"><span class="stat-k">Tasks</span><span class="stat-v">${project.taskSummary.completed}/${project.taskSummary.total}</span></span>` : ''}
      ${project.streak > 0 ? `<span class="stat"><span class="stat-k">Streak</span><span class="stat-v" style="color:var(--accent)">${project.streak}d</span></span>` : ''}
    </div>
    ${renderProgress(project)}
  `;
}

function renderProjectDetail(project, domain, moving, domains, options) {
  const outsideFocus = options.statusFilter && !options.statusFilter.includes(project.status);
  return `
    <div class="project-detail-backdrop" data-project-detail-close>
      <article class="project-detail" style="--domain:${escapeAttribute(domain.color)}" role="dialog" aria-modal="true" aria-labelledby="project-detail-title">
        ${renderCodexContextButton('project', project.id, project.name)}
        <button class="project-detail-close" data-project-detail-close type="button" aria-label="Close project details">×</button>
        <div class="project-detail-heading">
          <span class="project-detail-domain">${escapeHtml(domain.label)}</span>
          <h2 id="project-detail-title">${escapeHtml(project.name)}</h2>
          <p>${escapeHtml(project.subtitle)}</p>
          ${renderProjectCategories(project.categoryLabels)}
        </div>
        <label class="project-detail-status">
          <span>Project status</span>
          <select data-project-status-project="${escapeAttribute(project.id)}" aria-label="Status for ${escapeAttribute(project.name)}" ${moving ? 'disabled' : ''}>
            ${projectStatusOptions(project.status)}
          </select>
          <small>${escapeHtml(PROJECT_STATUS_DESCRIPTIONS[project.status])}</small>
        </label>
        ${outsideFocus ? `<p class="project-detail-focus-note" role="status">This project is outside the current List focus. It will remain available in ${escapeHtml(PROJECT_STATUS_LABELS[project.status])} after you close details.</p>` : ''}
        <div class="project-detail-metadata">
          <span><b>Health</b>${escapeHtml(project.health)}</span>
          <span><b>Last touched</b>${escapeHtml(project.lastTouchedLabel)}</span>
          <span><b>This week</b>${escapeHtml(project.weekHoursLabel)}</span>
          <span><b>Weekly plan</b>${escapeHtml(formatHours(project.plannedHours))}</span>
          <span><b>Due</b>${escapeHtml(dueLabel(project.dueInDays))}</span>
          <span><b>Streak</b>${project.streak ? `${project.streak}d` : '—'}</span>
          <span><b>Tasks</b>${project.taskSummary?.total ? `${project.taskSummary.completed}/${project.taskSummary.total} complete` : 'None yet'}</span>
        </div>
        <section class="project-detail-note"><span class="smallcaps-strong">Current note</span><p>${escapeHtml(project.note || 'No project note.')}</p></section>
        ${project.nextAction ? `<section class="project-detail-note"><span class="smallcaps-strong">Next action</span><p>${escapeHtml(project.nextAction)}</p></section>` : ''}
        ${renderProgress(project, true)}
        ${renderProjectTaskPanel(options.tasks, project, domains, options.tasksUi || {}, { today: options.today })}
        <section class="project-danger-zone"><span class="smallcaps">Permanent action</span><button data-project-delete-request="${escapeAttribute(project.id)}" type="button">Delete project</button></section>
      </article>
    </div>
  `;
}

function renderDeleteConfirmation(project, ui) {
  const deleting = ui.deletingProjectId === project.id;
  return `
    <div class="project-delete-backdrop">
      <section class="project-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-project-title" aria-describedby="delete-project-description" ${deleting ? 'aria-busy="true"' : ''}>
        <span class="smallcaps">Permanent deletion</span>
        <h2 id="delete-project-title">Delete “${escapeHtml(project.name)}”?</h2>
        <p id="delete-project-description">This removes the project from LifeOS. Its tracked time will remain in Analytics as historical category data. It cannot be undone inside the app.</p>
        ${ui.deleteError ? `<p class="project-delete-error" role="alert">${escapeHtml(ui.deleteError)}</p>` : ''}
        <div class="project-delete-actions"><button data-project-delete-cancel type="button" ${deleting ? 'disabled' : ''}>Cancel</button><button class="danger" data-project-delete-confirm="${escapeAttribute(project.id)}" type="button" ${deleting ? 'disabled' : ''}>${deleting ? 'Deleting…' : 'Delete permanently'}</button></div>
      </section>
    </div>
  `;
}

function renderProgress(project, detailed = false) {
  if (project.progress == null) return '';
  const percentage = Math.round(project.progress * 100);
  return `
    <div class="progress ${detailed ? 'project-detail-progress' : ''}" style="--progress:${percentage}%">
      <div class="bar"><i class="bar-fill"></i></div>
      <span class="pct">${percentage}%</span>
    </div>
  `;
}

function renderProjectCategories(labels = []) {
  if (!labels.length) return '';
  return `<div class="project-categories" aria-label="Project categories">${labels.map((label) => `<span class="project-category">${escapeHtml(label)}</span>`).join('')}</div>`;
}

function projectStatusOptions(selected) {
  return PROJECT_LIST_STATUSES.map((status) => `<option value="${status}" ${status === selected ? 'selected' : ''}>${PROJECT_STATUS_LABELS[status]}</option>`).join('');
}

function sameStatuses(left, right) {
  return left.length === right.length && left.every((status) => right.includes(status));
}

function dueLabel(dueInDays) {
  if (dueInDays == null) return '—';
  if (dueInDays < 0) return `${Math.abs(dueInDays)}d late`;
  return `${dueInDays}d`;
}

function formatHours(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? `${number}h` : `${number.toFixed(1)}h`;
}

function healthColorFor(health) {
  if (health === 'critical') return 'var(--critical)';
  if (health === 'attention') return 'var(--attention)';
  return 'var(--healthy)';
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
