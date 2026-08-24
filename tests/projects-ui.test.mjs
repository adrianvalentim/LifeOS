import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectsUiState,
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
  assert.doesNotMatch(html, /data-project-drop-status="dropped"/);
  assert.match(html, /data-project-drag-id="doing"/);
  assert.match(html, /data-project-detail="doing"/);
  assert.match(html, /class="project-board-card project-openable is-saving"/);
  assert.match(html, /aria-roledescription="movable project"/);
  assert.match(html, /class="project-category">Infinitamente<\/span>/);
  assert.doesNotMatch(html, /data-project-drag-id="todo"/);
  assert.doesNotMatch(html, /data-project-drag-id="dropped"/);
});

test('the existing list view keeps all projects and detail exposes all five statuses', () => {
  const ui = createProjectsUiState();
  ui.selectedProjectId = 'todo';
  const html = renderProjects(dashboard().projects, domains, ui);

  for (const id of ['todo', 'next', 'doing', 'done', 'dropped']) {
    assert.match(html, new RegExp(`data-project-detail="${id}"`));
  }
  assert.match(html, /data-project-status-project="todo"/);
  assert.match(html, /<option value="to_do" selected>To-do<\/option>/);
  assert.match(html, /<option value="next_up" >Next up<\/option>/);
  assert.match(html, /<option value="doing" >Doing<\/option>/);
  assert.match(html, /<option value="done" >Done<\/option>/);
  assert.match(html, /<option value="dropped" >Dropped<\/option>/);
});
