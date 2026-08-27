import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTasksUiState,
  renderProjectTaskPanel,
  renderTaskOverlays,
  renderTasks,
} from '../public/tasks.js';

const projects = [
  {
    id: 'portia',
    name: 'Portia',
    domain: 'filmmaking',
    taskSummary: { total: 2, open: 1, completed: 1, progress: 0.5 },
  },
  {
    id: 'research',
    name: 'Research Lab',
    domain: 'research',
    taskSummary: { total: 0, open: 0, completed: 0, progress: 0 },
  },
];

const domains = {
  filmmaking: { label: 'Filmmaking', color: '#b4502c' },
  research: { label: 'Research', color: '#3a6b85' },
};

function fixture() {
  const items = [
    task('root', 'Draft Act III', 'portia', null, 'open', 0, ['child'], 2, 1),
    task('child', 'Resolve the midpoint', 'portia', 'root', 'completed', 1, [], 1, 1),
    task('inbox', 'Renew passport', null, null, 'open', 0, [], 1, 0),
  ];
  return {
    items,
    summary: {
      total: 3,
      open: 2,
      completed: 1,
      progress: 1 / 3,
      inbox: { total: 1, open: 1, completed: 0, progress: 0 },
      byProject: {
        portia: { total: 2, open: 1, completed: 1, progress: 0.5 },
        research: { total: 0, open: 0, completed: 0, progress: 0 },
      },
    },
  };
}

test('Tasks renders first-class scopes, nested subtasks, progress, and accessible non-gesture controls', () => {
  const html = renderTasks(fixture(), projects, domains, createTasksUiState(), { today: '2026-08-22' });

  assert.match(html, /class="tasks-workspace"/);
  assert.match(html, /data-task-filter="all"/);
  assert.match(html, /data-task-filter="inbox"/);
  assert.match(html, /data-task-filter="project:portia"/);
  assert.match(html, /data-task-node="root"[\s\S]*data-task-node="child"/);
  assert.match(html, /data-task-completion="root"/);
  assert.match(html, /aria-label="Complete Draft Act III and its subtasks"/);
  assert.match(html, /data-task-project="root"/);
  assert.match(html, /1\/2 complete/);
  assert.match(html, /data-task-subtask-open="child"/);
});

test('project scope filters root tasks while keeping project association visible', () => {
  const ui = createTasksUiState();
  ui.filter = 'project:portia';
  const html = renderTasks(fixture(), projects, domains, ui, { today: '2026-08-22' });

  assert.match(html, /<h1>Portia<\/h1>/);
  assert.match(html, /data-task-node="root"/);
  assert.match(html, /data-task-node="child"/);
  assert.doesNotMatch(html, /data-task-node="inbox"/);
  assert.match(html, /<option value="portia" selected>Portia<\/option>/);
});

test('project details expose task creation, completion, nesting, and a route to the full Tasks section', () => {
  const ui = createTasksUiState();
  ui.addingSubtaskToId = 'root';
  const html = renderProjectTaskPanel(fixture(), projects[0], domains, ui, { today: '2026-08-22' });

  assert.match(html, /data-project-task-create="portia"/);
  assert.match(html, /data-task-manage-project="portia"/);
  assert.match(html, /data-task-completion="root"/);
  assert.match(html, /data-task-subtask-create="root"/);
  assert.match(html, /1 open · 1 complete/);
});

test('clickable tasks open an editable notes detail with safe subtree deletion', () => {
  const tasks = fixture();
  tasks.items[0].notes = 'Carry the midpoint decision into the confrontation.';
  const list = renderTasks(tasks, projects, domains, createTasksUiState(), { today: '2026-08-22' });
  assert.match(list, /data-task-detail="root"/);
  assert.match(list, /data-task-detail-button="root"/);
  assert.match(list, /class="task-note-indicator">Notes/);

  const ui = createTasksUiState();
  ui.selectedTaskId = 'root';
  ui.detailDraft = { title: 'Draft Act III', notes: tasks.items[0].notes };
  const detail = renderTaskOverlays(tasks, projects, ui, { today: '2026-08-22' });
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /data-task-update="root"/);
  assert.match(detail, /name="notes"/);
  assert.match(detail, /Carry the midpoint decision into the confrontation\./);
  assert.match(detail, /data-task-delete-request="root"/);

  ui.deleteTaskId = 'root';
  const confirmation = renderTaskOverlays(tasks, projects, ui, { today: '2026-08-22' });
  assert.match(confirmation, /role="alertdialog"/);
  assert.match(confirmation, /This also removes 1 subtask beneath it\./);
  assert.match(confirmation, /data-task-delete-confirm="root"/);
});

function task(id, title, projectId, parentTaskId, status, depth, childIds, subtreeTotal, subtreeCompleted) {
  return {
    id,
    title,
    notes: '',
    projectId,
    parentTaskId,
    status,
    sortOrder: 1,
    depth,
    childIds,
    directSubtaskCount: childIds.length,
    subtreeTotal,
    subtreeCompleted,
    progress: subtreeCompleted / subtreeTotal,
    schedule: { dueDate: null, startTime: null, durationMinutes: null, recurrence: null },
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    completedAt: status === 'completed' ? '2026-08-02T12:00:00.000Z' : null,
  };
}
