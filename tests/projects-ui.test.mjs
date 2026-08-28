import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectsUiState,
  normalizeProjectStatusFilter,
  projectStatusFilterPreset,
  projectsWithStatus,
  renderProjects,
} from '../public/projects.js';

const domains = {
  work: { label: 'Work', color: '#3a6b85' },
};

function project(id, name, status, health = 'healthy') {
  return {
    id,
    name,
    subtitle: `${name} subtitle`,
    note: `${name} note`,
    domain: 'work',
    status,
    health,
    lastTouchedLabel: '2h ago',
    weekHoursLabel: '3h',
    plannedHours: 5,
    dueInDays: 4,
    streak: 2,
    progress: 0.4,
    categoryLabels: id === 'doing' ? ['Infinitamente'] : [],
  };
}

function dashboard() {
  return {
    projects: [
      project('todo', 'Backlog', 'to_do'),
      project('next', 'Next', 'next_up', 'critical'),
      project('doing', 'Doing', 'doing'),
      project('paused', 'Paused', 'paused'),
      project('done', 'Done', 'done'),
      project('dropped', 'Dropped', 'dropped'),
    ],
    summary: { activeCount: 3, criticalCount: 1 },
  };
}

test('optimistic project moves are immutable and update active summaries', () => {
  const original = dashboard();
  const moved = projectsWithStatus(original, 'next', 'done');

  assert.notEqual(moved, original);
  assert.equal(original.projects[1].status, 'next_up');
  assert.equal(moved.projects[1].status, 'done');
  assert.equal(moved.summary.activeCount, 2);
  assert.equal(moved.summary.criticalCount, 0);
});

test('Kanban shows only Next up, Doing, and Done while keeping cards clickable and movable', () => {
  const ui = createProjectsUiState();
  ui.view = 'kanban';
  ui.movingProjectId = 'doing';
  const html = renderProjects(dashboard().projects, domains, ui);

  assert.match(html, /data-project-drop-status="next_up"/);
  assert.match(html, /data-project-drop-status="doing"/);
  assert.match(html, /data-project-drop-status="done"/);
  assert.doesNotMatch(html, /data-project-drop-status="to_do"/);
  assert.doesNotMatch(html, /data-project-drop-status="paused"/);
  assert.doesNotMatch(html, /data-project-drop-status="dropped"/);
  assert.match(html, /data-project-drag-id="doing"/);
  assert.match(html, /data-project-detail="doing"/);
  assert.doesNotMatch(html, /data-codex-context-kind/);
  assert.doesNotMatch(html, /data-project-delete-request/);
  assert.match(html, /class="project-board-card project-openable is-saving"/);
  assert.match(html, /aria-roledescription="movable project"/);
  assert.match(html, /class="project-category">Infinitamente<\/span>/);
  assert.doesNotMatch(html, /data-project-drag-id="todo"/);
  assert.doesNotMatch(html, /data-project-drag-id="paused"/);
  assert.doesNotMatch(html, /data-project-drag-id="dropped"/);
});

test('the List groups the complete portfolio and supports preset or custom status combinations', () => {
  const ui = createProjectsUiState();
  ui.statusFilter = normalizeProjectStatusFilter(['next_up', 'doing']);
  ui.filtersOpen = true;
  const html = renderProjects(dashboard().projects, domains, ui);

  assert.equal(projectStatusFilterPreset(ui.statusFilter), 'next_doing');
  assert.match(html, /data-project-filter-preset="next_up,doing"/);
  assert.match(html, /class="project-list-section status-next_up"/);
  assert.match(html, /class="project-list-section status-doing"/);
  assert.doesNotMatch(html, /data-project-detail="todo"/);
  assert.doesNotMatch(html, /data-project-detail="paused"/);
  assert.match(html, /data-project-filter-status="paused"/);

  ui.statusFilter = normalizeProjectStatusFilter(['to_do', 'paused', 'dropped']);
  assert.equal(projectStatusFilterPreset(ui.statusFilter), 'custom');
});

test('Organize mode exposes every status as a direct-manipulation target, including empty sections', () => {
  const ui = createProjectsUiState();
  ui.organizing = true;
  const projects = dashboard().projects.filter((item) => item.status !== 'paused');
  const html = renderProjects(projects, domains, ui);

  for (const status of ['to_do', 'next_up', 'doing', 'paused', 'done', 'dropped']) {
    assert.match(html, new RegExp(`data-project-drop-status="${status}"`));
  }
  assert.match(html, /class="project-list-drop-empty">Drop a project here/);
  assert.match(html, /data-project-drag-id="todo"/);
  assert.match(html, /aria-roledescription="movable project"/);
});

test('the open project detail exposes all statuses and Codex context', () => {
  const ui = createProjectsUiState();
  ui.selectedProjectId = 'todo';
  const html = renderProjects(dashboard().projects, domains, ui);

  for (const id of ['todo', 'next', 'doing', 'paused', 'done', 'dropped']) {
    assert.match(html, new RegExp(`data-project-detail="${id}"`));
  }
  assert.match(html, /data-codex-context-kind="project"/);
  assert.match(html, /data-codex-context-id="todo"/);
  assert.equal((html.match(/data-codex-context-id=/g) || []).length, 1);
  assert.match(html, /data-project-delete-request="todo"/);
  assert.equal((html.match(/data-project-delete-request=/g) || []).length, 1);
  assert.doesNotMatch(html, /role="alertdialog"/);
  assert.match(html, /data-project-status-project="todo"/);
  assert.match(html, /<option value="to_do" selected>To do<\/option>/);
  assert.match(html, /<option value="next_up" >Next up<\/option>/);
  assert.match(html, /<option value="doing" >Doing<\/option>/);
  assert.match(html, /<option value="paused" >Paused<\/option>/);
  assert.match(html, /<option value="done" >Done<\/option>/);
  assert.match(html, /<option value="dropped" >Dropped<\/option>/);
});

test('a move outside the current focus explains recovery and offers show and undo actions', () => {
  const ui = createProjectsUiState();
  ui.statusFilter = ['doing'];
  ui.selectedProjectId = 'paused';
  ui.statusNotice = {
    projectId: 'paused',
    name: 'Paused',
    fromStatus: 'doing',
    toStatus: 'paused',
  };
  const html = renderProjects(dashboard().projects, domains, ui);

  assert.match(html, /outside the current focus/);
  assert.match(html, /data-project-notice-show="paused"/);
  assert.match(html, /data-project-notice-undo="paused" data-project-notice-status="doing"/);
  assert.match(html, /This project is outside the current List focus/);
});

test('project deletion uses a named confirmation and explains preserved time history', () => {
  const ui = createProjectsUiState();
  ui.selectedProjectId = 'doing';
  ui.deleteProjectId = 'doing';
  ui.deletingProjectId = 'doing';
  const deletingHtml = renderProjects(dashboard().projects, domains, ui);

  assert.match(deletingHtml, /role="alertdialog"/);
  assert.match(deletingHtml, /Delete “Doing”\?/);
  assert.match(deletingHtml, /tracked time will remain in Analytics as historical category data/);
  assert.match(deletingHtml, /data-project-delete-cancel type="button" disabled/);
  assert.match(deletingHtml, /data-project-delete-confirm="doing" type="button" disabled>Deleting…<\/button>/);

  ui.deletingProjectId = null;
  ui.deleteError = 'This project cannot be deleted while it backs the active challenge.';
  const errorHtml = renderProjects(dashboard().projects, domains, ui);
  assert.match(errorHtml, /class="project-delete-error" role="alert"/);
  assert.match(errorHtml, /cannot be deleted while it backs the active challenge/);
});
