import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReorder,
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

const TODAY = '2026-08-22';

function fixture() {
  const items = [
    task('root', 'Draft Act III', 'portia', null, 'open', 0, ['child'], 2, 1, {
      priority: 'high',
      tags: ['writing'],
      dueDate: TODAY,
    }),
    task('child', 'Resolve the midpoint', 'portia', 'root', 'completed', 1, [], 1, 1),
    task('inbox', 'Renew passport', null, null, 'open', 0, [], 1, 0, {
      priority: 'low',
      tags: ['errands'],
      dueDate: '2026-08-19',
    }),
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
  const html = renderTasks(fixture(), projects, domains, createTasksUiState(), { today: TODAY });

  assert.match(html, /class="tasks-workspace is-compact"/);
  assert.match(html, /data-task-filter="all"/);
  assert.match(html, /data-task-filter="inbox"/);
  assert.match(html, /data-task-filter="project:portia"/);
  assert.match(html, /data-task-node="root"[\s\S]*data-task-node="child"/);
  assert.match(html, /data-task-completion="root"/);
  assert.match(html, /aria-label="Complete Draft Act III and its subtasks"/);
  assert.match(html, /data-task-menu="root"/);
  assert.match(html, /aria-label="Actions for Draft Act III"/);
  assert.match(html, /1\/2/);
  assert.match(html, /data-task-subtask-open="child"/);
});

test('the sidebar adds Today and Next 7 days smart lists plus tag scopes with live counts', () => {
  const html = renderTasks(fixture(), projects, domains, createTasksUiState(), { today: TODAY });

  assert.match(html, /data-task-filter="today"[\s\S]*?<span>Today<\/span>\s*<b>2<\/b>/);
  assert.match(html, /data-task-filter="next7"[\s\S]*?<span>Next 7 days<\/span>\s*<b>2<\/b>/);
  assert.match(html, /data-task-filter="tag:writing"/);
  assert.match(html, /data-task-filter="tag:errands"/);

  const ui = createTasksUiState();
  ui.filter = 'today';
  const todayHtml = renderTasks(fixture(), projects, domains, ui, { today: TODAY });
  assert.match(todayHtml, /<h1>Today<\/h1>/);
  assert.match(todayHtml, /data-task-node="root"/);
  assert.match(todayHtml, /data-task-node="inbox"/);
  assert.match(todayHtml, /3d late/);
  assert.doesNotMatch(todayHtml, /data-task-node="child"/);
});

test('tag scope lists every tagged task flat, including a tagged subtask under an untagged root', () => {
  const tasks = fixture();
  tasks.items[1].tags = ['writing'];
  const ui = createTasksUiState();
  ui.filter = 'tag:writing';
  const html = renderTasks(tasks, projects, domains, ui, { today: TODAY });

  assert.match(html, /<h1>#writing<\/h1>/);
  assert.match(html, /data-task-node="root"/);
  assert.match(html, /data-task-node="child"/);
  assert.doesNotMatch(html, /data-task-node="inbox"/);
  assert.match(html, /<h2 id="task-list-heading">1 open<\/h2>/);
  assert.match(html, /class="task-item .*priority-high"/);
  assert.match(html, /data-task-tag-filter="writing"/);
  assert.doesNotMatch(html, /data-task-drag-id=/);
});

test('view options drive grouping, sorting, completed visibility, and whether dragging is offered', () => {
  const ui = createTasksUiState();
  ui.groupBy = 'priority';
  ui.viewOptionsOpen = true;
  const grouped = renderTasks(fixture(), projects, domains, ui, { today: TODAY });

  assert.match(grouped, /data-task-group="priority:high"/);
  assert.match(grouped, /High priority/);
  assert.match(grouped, /<option value="priority" selected>Priority<\/option>/);
  assert.equal(canReorder(ui), false);
  assert.doesNotMatch(grouped, /data-task-drag-id="root"/);
  assert.match(grouped, /Switch to custom order without grouping/);

  const plain = createTasksUiState();
  assert.equal(canReorder(plain), true);
  assert.match(renderTasks(fixture(), projects, domains, plain, { today: TODAY }), /data-task-drag-id="root"/);

  const hidden = createTasksUiState();
  hidden.showCompleted = false;
  const html = renderTasks(fixture(), projects, domains, hidden, { today: TODAY });
  assert.doesNotMatch(html, /data-task-node="child"/);
  assert.match(html, /data-task-node="root"/);
});

test('due-date grouping separates overdue work from the rest of the horizon', () => {
  const ui = createTasksUiState();
  ui.groupBy = 'due';
  const html = renderTasks(fixture(), projects, domains, ui, { today: TODAY });

  assert.match(html, /data-task-group="due:overdue"[\s\S]*data-task-node="inbox"/);
  assert.match(html, /data-task-group="due:today"[\s\S]*data-task-node="root"/);
  assert.ok(html.indexOf('due:overdue') < html.indexOf('due:today'));
});

test('project details expose task creation, completion, nesting, and a route to the full Tasks section', () => {
  const ui = createTasksUiState();
  ui.addingSubtaskToId = 'root';
  const html = renderProjectTaskPanel(fixture(), projects[0], domains, ui, { today: TODAY });

  assert.match(html, /data-project-task-create="portia"/);
  assert.match(html, /data-task-manage-project="portia"/);
  assert.match(html, /data-task-completion="root"/);
  assert.match(html, /data-task-subtask-create="root"/);
  assert.match(html, /1 open · 1 complete/);
  assert.doesNotMatch(html, /data-task-drag-id="root"/);
});

test('clickable tasks open an editable detail with list, due, priority, tag, and note controls', () => {
  const tasks = fixture();
  tasks.items[0].notes = 'Carry the midpoint decision into the confrontation.';
  const list = renderTasks(tasks, projects, domains, createTasksUiState(), { today: TODAY });
  assert.match(list, /data-task-detail="root"/);
  assert.match(list, /data-task-detail-button="root"/);
  assert.match(list, /class="task-note-indicator"/);

  const ui = createTasksUiState();
  ui.selectedTaskId = 'root';
  ui.detailDraft = { title: 'Draft Act III', notes: tasks.items[0].notes };
  const detail = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /data-task-update="root"/);
  assert.match(detail, /name="notes"/);
  assert.match(detail, /Carry the midpoint decision into the confrontation\./);
  assert.match(detail, /data-task-project="root"/);
  assert.match(detail, /<option value="portia" selected>Portia<\/option>/);
  assert.match(detail, /data-task-due="root"/);
  assert.match(detail, /data-task-priority="root"/);
  assert.match(detail, /<option value="high" selected>High<\/option>/);
  assert.match(detail, /data-task-tag-remove="writing"/);
  assert.match(detail, /data-task-tag-create="root"/);
  assert.match(detail, /data-task-delete-request="root"/);

  ui.deleteTaskId = 'root';
  const confirmation = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(confirmation, /role="alertdialog"/);
  assert.match(confirmation, /This also removes 1 subtask beneath it\./);
  assert.match(confirmation, /data-task-delete-confirm="root"/);
});

test('the context menu offers dates, priorities, moves, tags, duplication, and deletion', () => {
  const tasks = fixture();
  const ui = createTasksUiState();
  ui.menu = { taskId: 'root', x: 220, y: 180, submenu: null };
  const menu = renderTaskOverlays(tasks, projects, ui, { today: TODAY });

  assert.match(menu, /role="menu"/);
  assert.match(menu, /--task-menu-x:220px;--task-menu-y:180px/);
  assert.match(menu, /data-task-due-set="root" data-task-due-date="2026-08-23"/);
  assert.match(menu, /data-task-due-set="root" data-task-due-date="2026-08-29"/);
  assert.match(menu, /data-task-priority-set="root" data-task-priority="high"/);
  assert.match(menu, /data-task-menu-subtask="root"/);
  assert.match(menu, /data-task-duplicate="root"/);
  assert.doesNotMatch(menu, /data-task-move-step/);
  assert.match(menu, /data-task-delete-request="root"/);

  ui.menu.submenu = 'project';
  const moveMenu = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(moveMenu, /data-task-project-set="root" data-task-project-id=""/);
  assert.match(moveMenu, /data-task-project-set="root" data-task-project-id="research"/);

  ui.menu.submenu = 'tag';
  const tagMenu = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(tagMenu, /data-task-tag-toggle="root" data-task-tag="writing"/);
  assert.match(tagMenu, /data-task-tag-create="root"/);
});

test('a subtask keeps its parent list instead of offering an independent move', () => {
  const tasks = fixture();
  const ui = createTasksUiState();
  ui.menu = { taskId: 'child', x: 10, y: 10, submenu: 'project' };
  const menu = renderTaskOverlays(tasks, projects, ui, { today: TODAY });

  assert.match(menu, /A subtask always follows its parent task's list\./);
  assert.doesNotMatch(menu, /data-task-project-set="child"/);
});

function task(id, title, projectId, parentTaskId, status, depth, childIds, subtreeTotal, subtreeCompleted, extra = {}) {
  return {
    id,
    title,
    notes: '',
    projectId,
    parentTaskId,
    status,
    priority: extra.priority || 'none',
    tags: extra.tags || [],
    sortOrder: 1,
    depth,
    childIds,
    directSubtaskCount: childIds.length,
    subtreeTotal,
    subtreeCompleted,
    progress: subtreeCompleted / subtreeTotal,
    schedule: {
      dueDate: extra.dueDate || null,
      startTime: null,
      durationMinutes: null,
      recurrence: null,
    },
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    completedAt: status === 'completed' ? '2026-08-02T12:00:00.000Z' : null,
  };
}
