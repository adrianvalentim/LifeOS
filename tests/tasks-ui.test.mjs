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
    task('child', 'Resolve the midpoint', 'portia', 'root', 'completed', 1, [], 1, 1, {
      dueDate: TODAY,
    }),
    task('inbox', 'Renew passport', null, null, 'open', 0, [], 1, 0, {
      priority: 'low',
      tags: ['errands'],
      dueDate: '2026-08-19',
    }),
    task('trashed', 'Discarded draft', 'portia', null, 'open', 0, [], 0, 0, {
      trashedAt: '2026-08-21T12:00:00.000Z',
    }),
  ];
  return {
    items,
    summary: {
      total: 3,
      open: 2,
      completed: 1,
      trashed: 1,
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
  assert.match(html, /data-task-node="root"/);
  assert.doesNotMatch(html, /data-task-node="child"/);
  assert.doesNotMatch(html, /data-task-node="trashed"/);
  assert.match(html, /data-task-completion="root"/);
  assert.match(html, /aria-label="Complete Draft Act III and its subtasks"/);
  assert.match(html, /data-task-menu="root"/);
  assert.match(html, /aria-label="Actions for Draft Act III"/);
  assert.match(html, /1\/2/);
  assert.match(html, /data-task-filter="completed"/);
  assert.match(html, /data-task-filter="trash"/);
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
  assert.match(todayHtml, /<details class="task-completed-disclosure">/);
  assert.match(todayHtml, /data-task-node="child"/);
  assert.doesNotMatch(todayHtml, /<details class="task-completed-disclosure" open>/);
});

test('Completed and Trash are separate lifecycle scopes with recovery controls', () => {
  const completedUi = createTasksUiState();
  completedUi.filter = 'completed';
  const completed = renderTasks(fixture(), projects, domains, completedUi, { today: TODAY });
  assert.match(completed, /<h1>Completed<\/h1>/);
  assert.match(completed, /data-task-node="child"/);
  assert.doesNotMatch(completed, /data-task-node="root"/);
  assert.doesNotMatch(completed, /data-task-create/);

  const trashUi = createTasksUiState();
  trashUi.filter = 'trash';
  const trash = renderTasks(fixture(), projects, domains, trashUi, { today: TODAY });
  assert.match(trash, /<h1>Trash<\/h1>/);
  assert.match(trash, /30 days/);
  assert.match(trash, /data-task-node="trashed"/);
  assert.doesNotMatch(trash, /data-task-completion="trashed"/);
  assert.doesNotMatch(trash, /data-task-create/);
});

test('tag scope stays active-only even when a completed subtask shares the tag', () => {
  const tasks = fixture();
  tasks.items[1].tags = ['writing'];
  const ui = createTasksUiState();
  ui.filter = 'tag:writing';
  const html = renderTasks(tasks, projects, domains, ui, { today: TODAY });

  assert.match(html, /<h1>#writing<\/h1>/);
  assert.match(html, /data-task-node="root"/);
  assert.doesNotMatch(html, /data-task-node="child"/);
  assert.doesNotMatch(html, /data-task-node="inbox"/);
  assert.match(html, /<h2 id="task-list-heading">1 open<\/h2>/);
  assert.match(html, /class="task-item .*priority-high"/);
  assert.match(html, /data-task-tag-filter="writing"/);
  // A flat scope still hands out drags so the task can be reassigned; it just cannot be
  // reordered, because the rows are not in their manual sibling order here.
  assert.match(html, /data-task-drag-id="root"/);
  assert.doesNotMatch(html, /data-task-reorderable/);
});

test('view options drive grouping, sorting, and what a drag is allowed to do', () => {
  const ui = createTasksUiState();
  ui.groupBy = 'priority';
  ui.viewOptionsOpen = true;
  const grouped = renderTasks(fixture(), projects, domains, ui, { today: TODAY });

  assert.match(grouped, /data-task-group="priority:high"/);
  assert.match(grouped, /High priority/);
  assert.match(grouped, /<option value="priority" selected>Priority<\/option>/);
  assert.equal(canReorder(ui), false);
  assert.match(grouped, /data-task-drag-id="root"/);
  assert.doesNotMatch(grouped, /data-task-reorderable/);
  assert.match(grouped, /Switch to custom order without grouping to also reorder/);

  const plain = createTasksUiState();
  assert.equal(canReorder(plain), true);
  const ungrouped = renderTasks(fixture(), projects, domains, plain, { today: TODAY });
  assert.match(ungrouped, /data-task-drag-id="root"/);
  assert.match(ungrouped, /data-task-reorderable="true"/);

  assert.doesNotMatch(grouped, /data-task-show-completed/);
});

test('every scope and group a drop can express is marked with the change it makes', () => {
  const ui = createTasksUiState();
  ui.groupBy = 'priority';
  const html = renderTasks(fixture(), projects, domains, ui, { today: TODAY });

  assert.match(html, /data-task-drop-filter="today" data-task-drop-label="Due today"/);
  assert.match(html, /data-task-drop-filter="next7" data-task-drop-label="Due Aug 29"/);
  assert.match(html, /data-task-drop-filter="inbox" data-task-drop-label="Inbox"/);
  assert.match(html, /data-task-drop-filter="project:portia" data-task-drop-label="Portia"/);
  assert.match(html, /data-task-drop-filter="tag:writing" data-task-drop-label="#writing"/);
  assert.match(html, /data-task-drop-filter="completed" data-task-drop-label="Complete"/);
  assert.match(html, /data-task-drop-filter="trash" data-task-drop-label="Trash"/);
  // Every task is already in "All tasks", so it is the one scope a drop cannot express.
  assert.doesNotMatch(html, /data-task-filter="all" data-task-drop-filter/);

  // A priority with nothing in it is still a destination, so its lane stays in the
  // document and is revealed only while a task is in hand.
  assert.match(html, /data-task-group="priority:high" data-task-drop-group="priority" data-task-drop-value="high"/);
  assert.match(html, /data-task-group="priority:medium"[^>]*data-task-group-latent="true"/);
  assert.match(html, /data-task-group="priority:none"[^>]*data-task-drop-value="none"/);
});

test('due-date grouping offers a drop only on the lanes that name a single date', () => {
  const ui = createTasksUiState();
  ui.groupBy = 'due';
  const html = renderTasks(fixture(), projects, domains, ui, { today: TODAY });

  assert.match(html, /data-task-group="due:today" data-task-drop-group="due" data-task-drop-value="2026-08-22"/);
  assert.match(html, /data-task-group="due:tomorrow"[^>]*data-task-drop-value="2026-08-23"/);
  assert.match(html, /data-task-group="due:week"[^>]*data-task-drop-value="2026-08-29"/);
  assert.match(html, /data-task-group="due:none"[^>]*data-task-drop-value=""/);
  // "Overdue" spans many dates, so releasing on it could not mean one thing.
  assert.match(html, /data-task-group="due:overdue"(?![^>]*data-task-drop-group)/);
});

test('completed and trashed scopes stay out of reach of a drag', () => {
  const completedUi = createTasksUiState();
  completedUi.filter = 'completed';
  assert.doesNotMatch(renderTasks(fixture(), projects, domains, completedUi, { today: TODAY }), /data-task-drag-id=/);

  const trashUi = createTasksUiState();
  trashUi.filter = 'trash';
  assert.doesNotMatch(renderTasks(fixture(), projects, domains, trashUi, { today: TODAY }), /data-task-drag-id=/);
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
  assert.match(detail, /Move to Trash/);

  ui.deleteTaskId = 'root';
  const confirmation = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(confirmation, /role="alertdialog"/);
  assert.match(confirmation, /This also moves 1 subtask beneath it\./);
  assert.match(confirmation, /data-task-trash-confirm="root"/);
});

test('the context menu offers dates, priorities, moves, tags, duplication, and Trash', () => {
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
  assert.match(menu, /Move to Trash/);

  ui.menu.submenu = 'project';
  const moveMenu = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(moveMenu, /data-task-project-set="root" data-task-project-id=""/);
  assert.match(moveMenu, /data-task-project-set="root" data-task-project-id="research"/);

  ui.menu.submenu = 'tag';
  const tagMenu = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(tagMenu, /data-task-tag-toggle="root" data-task-tag="writing"/);
  assert.match(tagMenu, /data-task-tag-create="root"/);
});

test('a trashed task detail offers restore and guarded permanent deletion', () => {
  const tasks = fixture();
  const ui = createTasksUiState();
  ui.selectedTaskId = 'trashed';
  ui.detailDraft = { title: 'Discarded draft', notes: '' };
  let overlay = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(overlay, /task-detail-status trashed">Trash/);
  assert.match(overlay, /data-task-restore="trashed"/);
  assert.match(overlay, /Delete forever/);
  assert.doesNotMatch(overlay, /data-task-tag-create="trashed"/);

  ui.deleteTaskId = 'trashed';
  overlay = renderTaskOverlays(tasks, projects, ui, { today: TODAY });
  assert.match(overlay, /Permanent deletion/);
  assert.match(overlay, /data-task-delete-confirm="trashed"/);
  assert.match(overlay, /This cannot be undone\./);
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
    progress: subtreeTotal ? subtreeCompleted / subtreeTotal : 0,
    schedule: {
      dueDate: extra.dueDate || null,
      startTime: null,
      durationMinutes: null,
      recurrence: null,
    },
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    completedAt: status === 'completed' ? '2026-08-02T12:00:00.000Z' : null,
    trashedAt: extra.trashedAt || null,
    allSubtreeTotal: extra.allSubtreeTotal || subtreeTotal || 1,
    trashSubtreeTotal: extra.trashedAt ? (extra.trashSubtreeTotal || 1) : 0,
  };
}
