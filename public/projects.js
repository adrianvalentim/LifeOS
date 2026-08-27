import { renderCodexContextButton } from './codex-context.js';
import { renderProjectTaskPanel } from './tasks.js';

export const PROJECT_STATUS_LABELS = {
  to_do: 'To-do',
  next_up: 'Next up',
  doing: 'Doing',
  done: 'Done',
  dropped: 'Dropped',
};

export const PROJECT_BOARD_STATUSES = ['next_up', 'doing', 'done'];
export const ACTIVE_PROJECT_STATUSES = ['to_do', 'next_up', 'doing'];
const ALL_PROJECT_STATUSES = Object.keys(PROJECT_STATUS_LABELS);

export function createProjectsUiState() {
  return {
    view: 'list',
    selectedProjectId: null,
    deleteProjectId: null,
    deletingProjectId: null,
    deleteError: null,
    movingProjectId: null,
  };
}

export function projectsWithStatus(dashboard, projectId, status) {
  const current = dashboard?.projects?.find((project) => project.id === projectId);
  if (!current || current.status === status || !ALL_PROJECT_STATUSES.includes(status)) return dashboard;

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

export function renderProjects(projects, domains, ui, options = {}) {
  const selected = projects.find((project) => project.id === ui.selectedProjectId);
  const deleteTarget = projects.find((project) => project.id === ui.deleteProjectId);
  return `
    <div class="projects-workspace">
      <div class="projects-toolbar">
        <div class="project-view-switch" role="group" aria-label="Projects view">
          <button class="project-view-button ${ui.view === 'list' ? 'active' : ''}" data-project-view="list" type="button">List</button>
          <button class="project-view-button ${ui.view === 'kanban' ? 'active' : ''}" data-project-view="kanban" type="button">Kanban</button>
        </div>
      </div>
      ${ui.view === 'kanban' ? renderProjectBoard(projects, domains, ui) : renderProjectList(projects, domains)}
      ${selected ? renderProjectDetail(selected, domains[selected.domain], ui.movingProjectId === selected.id, domains, options) : ''}
      ${deleteTarget ? renderDeleteConfirmation(deleteTarget, ui) : ''}
    </div>
  `;
}

function renderProjectList(projects, domains) {
  return `<div class="projects-grid projects-list" aria-label="All projects">${projects.map((project) => renderProjectEntry(project, domains[project.domain])).join('')}</div>`;
}

function renderProjectBoard(projects, domains, ui) {
  return `
    <div class="project-board ${ui.movingProjectId ? 'is-saving' : ''}" aria-describedby="project-board-instructions" ${ui.movingProjectId ? 'aria-busy="true"' : ''}>
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

function renderProjectEntry(project, domain) {
  return `
    <article class="project-entry project-openable" style="--domain:${escapeAttribute(domain.color)}" data-project-detail="${escapeAttribute(project.id)}" role="button" tabindex="0" aria-label="Open ${escapeAttribute(project.name)} details">
      <div class="swatch"></div>
      <div>${renderProjectContent(project, domain, { showStatus: true })}</div>
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
        </label>
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
  return ALL_PROJECT_STATUSES.map((status) => `<option value="${status}" ${status === selected ? 'selected' : ''}>${PROJECT_STATUS_LABELS[status]}</option>`).join('');
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
