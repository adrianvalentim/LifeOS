import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEMO_STORE_PATH,
  addProjectCategory,
  addReadingBook,
  buildCategoryStats,
  buildState,
  createTask,
  dateOnly,
  deleteProject,
  deleteReadingBook,
  deleteTask,
  duplicateTask,
  logTime,
  migrateStore,
  parseDurationToMinutes,
  purgeExpiredTaskTrash,
  readStore,
  reorderReadingBook,
  reorderTask,
  restoreTask,
  rhythmHeatmap,
  setProjectStatus,
  setReadingBookStatus,
  setTaskCompletion,
  setTaskPriority,
  setTaskProject,
  setTaskSchedule,
  startSession,
  stopSession,
  trashTask,
  updateReadingBookFinishedDate,
  updateReadingBookTags,
  updateTask,
  updateTaskTags,
  validateStore,
} from '../src/lifeos-data.mjs';

const FIXED_NOW = '2026-08-22T15:00:00-03:00';

test('duration parser accepts hour and minute language', () => {
  assert.equal(parseDurationToMinutes('log 90 min on portia'), 90);
  assert.equal(parseDurationToMinutes('spent 1.5h on vulcano'), 90);
  assert.equal(parseDurationToMinutes('worked 1h 20m on script'), 80);
});

test('demo dashboard values are calculated from entries', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  const state = buildState(store, { now: FIXED_NOW, range: 'week' });

  assert.equal(state.summary.activeCount, 9);
  assert.equal(state.summary.criticalCount, 2);
  assert.equal(state.summary.todayMinutes, 181);
  assert.equal(state.summary.currentWeekHours, 39.3);
  assert.equal(state.summary.deepRatio, 0.85);
  assert.equal(state.analytics.productionConsumption.productionPct, 64);
  assert.equal(state.recommendation.projectId, 'portia');
  const vulcano = state.projects.find((project) => project.id === 'vulcano');
  assert.equal(vulcano.weekHours, 14.2);
  assert.equal(vulcano.streak, 5);
  assert.deepEqual(vulcano.weekHistory, [8.2, 9.1, 11.3, 10.8, 12.4, 13, 11.9, 14.2]);
  assert.deepEqual(vulcano.taskSummary, { total: 3, open: 2, completed: 1, progress: 0.33 });
  assert.ok(state.rhythmHeatmap.values.flat().some((value) => value > 0));
});

test('rhythm heatmap distributes entries across hour boundaries and clips at midnight', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  store.timeEntries = [
    {
      id: 'heatmap-across-hours',
      projectId: null,
      categoryIds: [],
      date: '2026-08-22',
      time: '10:45',
      durationMinutes: 90,
      activityType: 'deep_work',
    },
    {
      id: 'heatmap-midnight-clip',
      projectId: null,
      categoryIds: [],
      date: '2026-08-21',
      time: '23:30',
      durationMinutes: 90,
      activityType: 'deep_work',
    },
  ];

  const heatmap = rhythmHeatmap(store, '2026-08-22');
  const today = heatmap.values.at(-1);
  const yesterday = heatmap.values.at(-2);
  assert.equal(today[10], 0.25);
  assert.equal(today[11], 1);
  assert.equal(today[12], 0.25);
  assert.equal(yesterday[23], 0.5);
});

test('changing one entry changes dashboard totals and composition', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  const before = buildState(store, { now: FIXED_NOW, range: 'week' });
  store.timeEntries.push({
    id: 'test-real-entry',
    projectId: 'portia',
    categoryIds: [],
    date: '2026-08-22',
    time: '16:00',
    durationMinutes: 60,
    activityType: 'admin',
    description: 'Test entry',
    rawInput: 'Test entry',
    captureSource: 'test',
    createdAt: '2026-08-22T16:00:00-03:00',
  });
  const after = buildState(store, { now: '2026-08-22T17:00:00-03:00', range: 'week' });

  assert.equal(after.summary.todayMinutes, before.summary.todayMinutes + 60);
  assert.equal(after.summary.totalRangeHours, before.summary.totalRangeHours + 1);
  assert.ok(after.summary.deepRatio < before.summary.deepRatio);
  assert.equal(after.analytics.composition.admin, before.analytics.composition.admin + 1);
});

test('ranges are selected from the same source entries', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  const week = buildState(store, { now: FIXED_NOW, range: 'week' });
  const month = buildState(store, { now: FIXED_NOW, range: 'month' });
  const year = buildState(store, { now: FIXED_NOW, range: 'year' });

  assert.equal(week.summary.rangeLabel, 'Week 34');
  assert.equal(month.summary.rangeLabel, 'August');
  assert.equal(year.summary.rangeLabel, '2026');
  assert.ok(month.summary.totalRangeHours > week.summary.totalRangeHours);
  assert.ok(year.summary.totalRangeHours > month.summary.totalRangeHours);
});

test('an explicit unknown project is rejected instead of becoming general work', async () => {
  const tmp = await makeStoreCopy('lifeos-unknown-project-');
  await assert.rejects(
    logTime({ project: 'Not A Project', durationMinutes: 30, description: 'Test', now: FIXED_NOW }, tmp.storePath),
    /Project not found/,
  );
});

test('writes preserve a backup and release the store lock', async () => {
  const tmp = await makeStoreCopy('lifeos-write-');
  const before = JSON.parse(await readFile(tmp.storePath, 'utf8'));
  const result = await logTime({
    project: 'Portia',
    durationMinutes: 30,
    activityType: 'creative',
    description: 'Test draft',
    rawInput: 'log 30m on Portia Test draft',
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(result.entry.projectId, 'portia');
  assert.equal(result.state.todayEntries.length, 5);
  assert.deepEqual(JSON.parse(await readFile(`${tmp.storePath}.bak`, 'utf8')), before);
  await assert.rejects(access(`${tmp.storePath}.lock`), /ENOENT/);
});

test('timer start and stop creates one elapsed time entry', async () => {
  const tmp = await makeStoreCopy('lifeos-timer-');
  const started = await startSession({
    project: 'Vulcano',
    activityType: 'creative',
    description: 'Color pass',
    startedAt: '2026-08-22T13:00:00-03:00',
    now: '2026-08-22T13:00:00-03:00',
  }, tmp.storePath);
  assert.equal(started.state.activeSession.projectId, 'vulcano');

  const stopped = await stopSession({ stoppedAt: '2026-08-22T14:30:00-03:00' }, tmp.storePath);
  assert.equal(stopped.entry.durationMinutes, 90);
  assert.equal(stopped.entry.captureSource, 'lifeos_timer');
  assert.equal(stopped.state.activeSession, null);
});

test('calendar dates honor the configured timezone', () => {
  assert.equal(dateOnly('2026-08-23T01:00:00Z', 'America/Sao_Paulo'), '2026-08-22');
  assert.equal(dateOnly('2026-08-23T03:00:00Z', 'America/Sao_Paulo'), '2026-08-23');
});

test('older stores migrate to schema version 10 with Reading, project categories, task metadata, and six project statuses', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  delete store.reading;
  delete store.tasks;
  store.meta.schemaVersion = 2;
  const migrated = migrateStore(store);

  assert.equal(migrated.meta.schemaVersion, 10);
  assert.deepEqual(migrated.reading, { books: [] });
  assert.deepEqual(migrated.tasks, { items: [] });
  assert.doesNotThrow(() => validateStore(migrated));

  const versionThree = await readStore(DEMO_STORE_PATH);
  versionThree.meta.schemaVersion = 3;
  for (const book of versionThree.reading.books) delete book.tags;
  const tagged = migrateStore(versionThree);
  assert.equal(tagged.meta.schemaVersion, 10);
  assert.ok(tagged.reading.books.every((book) => Array.isArray(book.tags) && book.tags.length === 0));

  const versionFour = await readStore(DEMO_STORE_PATH);
  versionFour.meta.schemaVersion = 4;
  for (const project of versionFour.projects) project.status = 'active';
  versionFour.projects.at(-1).status = 'inactive';
  const projectStatuses = migrateStore(versionFour);
  assert.equal(projectStatuses.meta.schemaVersion, 10);
  assert.ok(projectStatuses.projects.slice(0, -1).every((project) => project.status === 'next_up'));
  assert.equal(projectStatuses.projects.at(-1).status, 'dropped');

  const versionFive = await readStore(DEMO_STORE_PATH);
  versionFive.meta.schemaVersion = 5;
  delete versionFive.categories;
  for (const project of versionFive.projects) delete project.categoryIds;
  for (const entry of versionFive.timeEntries) delete entry.categoryIds;
  const categorized = migrateStore(versionFive);
  assert.equal(categorized.meta.schemaVersion, 10);
  assert.deepEqual(categorized.categories, {});
  assert.ok(categorized.projects.every((project) => Array.isArray(project.categoryIds)));
  assert.ok(categorized.timeEntries.every((entry) => Array.isArray(entry.categoryIds)));

  const versionSix = await readStore(DEMO_STORE_PATH);
  versionSix.meta.schemaVersion = 6;
  delete versionSix.tasks;
  const tasked = migrateStore(versionSix);
  assert.equal(tasked.meta.schemaVersion, 10);
  assert.deepEqual(tasked.tasks, { items: [] });

  const versionSeven = await readStore(DEMO_STORE_PATH);
  versionSeven.meta.schemaVersion = 7;
  for (const task of versionSeven.tasks.items) delete task.notes;
  const noted = migrateStore(versionSeven);
  assert.equal(noted.meta.schemaVersion, 10);
  assert.ok(noted.tasks.items.every((task) => task.notes === ''));

  const versionEight = await readStore(DEMO_STORE_PATH);
  versionEight.meta.schemaVersion = 8;
  for (const task of versionEight.tasks.items) {
    delete task.priority;
    delete task.tags;
  }
  const prioritized = migrateStore(versionEight);
  assert.equal(prioritized.meta.schemaVersion, 10);
  assert.ok(prioritized.tasks.items.every((task) => task.priority === 'none'));
  assert.ok(prioritized.tasks.items.every((task) => Array.isArray(task.tags) && task.tags.length === 0));
  assert.doesNotThrow(() => validateStore(prioritized));

  const versionNine = await readStore(DEMO_STORE_PATH);
  versionNine.meta.schemaVersion = 9;
  for (const task of versionNine.tasks.items) delete task.trashedAt;
  const recoverable = migrateStore(versionNine);
  assert.equal(recoverable.meta.schemaVersion, 10);
  assert.ok(recoverable.tasks.items.every((task) => task.trashedAt === null));
  assert.doesNotThrow(() => validateStore(recoverable));
});

test('projects move across the six-status workflow and completed or paused work leaves active recommendations', async () => {
  const tmp = await makeStoreCopy('lifeos-project-status-');
  const moved = await setProjectStatus({
    projectId: 'portia',
    status: 'done',
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(moved.project.status, 'done');
  assert.equal(moved.state.summary.activeCount, 8);
  assert.notEqual(moved.state.recommendation.projectId, 'portia');
  assert.equal(moved.project.statusChangedAt, new Date(FIXED_NOW).toISOString());

  const paused = await setProjectStatus({
    projectId: 'vulcano',
    status: 'paused',
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.equal(paused.project.status, 'paused');
  assert.equal(paused.state.summary.activeCount, 7);
  assert.ok(paused.state.recommendations.every((item) => item.projectId !== 'vulcano'));

  await assert.rejects(setProjectStatus({ projectId: 'portia', status: 'someday' }, tmp.storePath), /Unknown project status/);
  const invalid = await readStore(tmp.storePath);
  invalid.projects[0].status = 'someday';
  assert.throws(() => validateStore(invalid), /unknown status/);
});

test('project categories group shared time and project deletion preserves direct history', async () => {
  const tmp = await makeStoreCopy('lifeos-project-category-');
  const original = await readStore(tmp.storePath);
  const expectedMinutes = original.timeEntries
    .filter((entry) => ['portia', 'vulcano', 'infinitamente'].includes(entry.projectId))
    .reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const originalWeek = buildState(original, { now: FIXED_NOW, range: 'week' });

  await addProjectCategory({ projectId: 'portia', category: 'Infinitamente', now: FIXED_NOW }, tmp.storePath);
  await addProjectCategory({ projectId: 'vulcano', category: 'infinitamente', now: FIXED_NOW }, tmp.storePath);
  const deleted = await deleteProject({
    projectId: 'infinitamente',
    preserveCategory: 'Infinitamente',
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(deleted.preservedEntryCount, 9);
  assert.equal(deleted.state.projects.some((project) => project.id === 'infinitamente'), false);
  assert.deepEqual(deleted.state.projects.find((project) => project.id === 'portia').categoryLabels, ['Infinitamente']);
  assert.deepEqual(deleted.state.projects.find((project) => project.id === 'vulcano').categoryLabels, ['Infinitamente']);
  assert.equal(deleted.state.summary.totalRangeHours, originalWeek.summary.totalRangeHours);
  assert.equal(deleted.state.analytics.actualByDomain.content, originalWeek.analytics.actualByDomain.content);

  const after = await readStore(tmp.storePath);
  const stats = buildCategoryStats(after, 'Infinitamente', { now: FIXED_NOW, range: 'year' });
  assert.equal(stats.totalMinutes, expectedMinutes);
  assert.deepEqual(stats.projects.map((project) => project.id).sort(), ['portia', 'vulcano']);
  assert.ok(after.timeEntries
    .filter((entry) => entry.categoryIds.includes('infinitamente'))
    .every((entry) => entry.projectId === null && entry.domain === 'content'));

  const invalid = structuredClone(after);
  invalid.projects[0].categoryIds = ['missing-category'];
  assert.throws(() => validateStore(invalid), /categoryIds/);
});

test('project UI deletion automatically preserves uncategorized time history', async () => {
  const tmp = await makeStoreCopy('lifeos-project-ui-delete-');
  const original = await readStore(tmp.storePath);
  const project = original.projects.find((candidate) => candidate.id === 'substack');
  const referencedEntryCount = original.timeEntries.filter((entry) => entry.projectId === project.id).length;
  const originalState = buildState(original, { now: FIXED_NOW });

  await assert.rejects(
    deleteProject({ projectId: project.id, now: FIXED_NOW }, tmp.storePath),
    /still has time history/,
  );
  await startSession({
    projectId: project.id,
    activityType: 'communication',
    description: 'Draft a project update',
    startedAt: '2026-08-22T14:00:00-03:00',
    now: FIXED_NOW,
  }, tmp.storePath);

  const deleted = await deleteProject({
    projectId: project.id,
    preserveHistory: true,
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(deleted.preservedEntryCount, referencedEntryCount);
  assert.equal(deleted.preservedActiveSession, true);
  assert.equal(deleted.preservedCategory.label, project.name);
  assert.equal(deleted.state.projects.some((candidate) => candidate.id === project.id), false);
  assert.equal(deleted.state.summary.totalRangeHours, originalState.summary.totalRangeHours);

  const after = await readStore(tmp.storePath);
  const preservedEntries = after.timeEntries.filter((entry) => entry.categoryIds.includes(deleted.preservedCategory.id));
  assert.equal(preservedEntries.length, referencedEntryCount);
  assert.ok(preservedEntries.every((entry) => entry.projectId === null && entry.domain === project.domain));
  assert.equal(after.activeSession.projectId, null);
  assert.equal(after.activeSession.domain, project.domain);
  assert.ok(after.activeSession.categoryIds.includes(deleted.preservedCategory.id));

  const stopped = await stopSession({
    durationMinutes: 30,
    stoppedAt: '2026-08-22T15:00:00-03:00',
  }, tmp.storePath);
  assert.equal(stopped.entry.projectId, null);
  assert.equal(stopped.entry.domain, project.domain);
  assert.ok(stopped.entry.categoryIds.includes(deleted.preservedCategory.id));
});

test('tasks can stand alone or inherit a project through nested subtasks with derived progress', async () => {
  const tmp = await makeStoreCopy('lifeos-tasks-');
  const before = buildState(await readStore(tmp.storePath), { now: FIXED_NOW });
  const inbox = await createTask({
    title: 'Independent errand',
    dueDate: '2026-08-25',
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.equal(inbox.task.projectId, null);
  assert.deepEqual(inbox.task.schedule, {
    dueDate: '2026-08-25',
    startTime: null,
    durationMinutes: null,
    recurrence: null,
  });

  const root = await createTask({
    title: 'Plan the final scene',
    projectId: 'portia',
    dueDate: '2026-08-24',
    startTime: '09:30',
    durationMinutes: 90,
    now: FIXED_NOW,
  }, tmp.storePath);
  const child = await createTask({
    title: 'List the remaining beats',
    parentTaskId: root.task.id,
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.equal(child.task.projectId, 'portia');
  assert.equal(child.task.parentTaskId, root.task.id);

  const completed = await setTaskCompletion({ taskId: child.task.id, completed: true, now: FIXED_NOW }, tmp.storePath);
  const hydratedRoot = completed.state.tasks.items.find((task) => task.id === root.task.id);
  assert.equal(hydratedRoot.subtreeTotal, 2);
  assert.equal(hydratedRoot.subtreeCompleted, 1);
  assert.equal(hydratedRoot.progress, 0.5);
  assert.equal(completed.state.tasks.summary.inbox.total, before.tasks.summary.inbox.total + 1);
  assert.equal(
    completed.state.projects.find((project) => project.id === 'portia').taskSummary.total,
    before.projects.find((project) => project.id === 'portia').taskSummary.total + 2,
  );
});

test('completing a parent cascades to open subtasks and adding new work reopens its ancestors', async () => {
  const tmp = await makeStoreCopy('lifeos-task-cascade-');
  const root = await createTask({ title: 'Prepare release', projectId: 'vulcano', now: FIXED_NOW }, tmp.storePath);
  const child = await createTask({ title: 'Export master', parentTaskId: root.task.id, now: FIXED_NOW }, tmp.storePath);
  const grandchild = await createTask({ title: 'Verify audio', parentTaskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  const completed = await setTaskCompletion({ taskId: root.task.id, completed: true, now: FIXED_NOW }, tmp.storePath);
  assert.equal(completed.affectedCount, 3);
  assert.ok(completed.state.tasks.items
    .filter((task) => [root.task.id, child.task.id, grandchild.task.id].includes(task.id))
    .every((task) => task.status === 'completed'));

  const newWork = await createTask({ title: 'Share review link', parentTaskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(newWork.state.tasks.items.find((task) => task.id === root.task.id).status, 'open');
  assert.equal(newWork.state.tasks.items.find((task) => task.id === child.task.id).status, 'open');
  assert.equal(newWork.state.tasks.items.find((task) => task.id === grandchild.task.id).status, 'completed');
});

test('task details persist multiline notes while Trash preserves, restores, and permanently deletes a subtree', async () => {
  const tmp = await makeStoreCopy('lifeos-task-details-');
  const root = await createTask({ title: 'Prepare release', projectId: 'vulcano', now: FIXED_NOW }, tmp.storePath);
  const child = await createTask({ title: 'Export master', parentTaskId: root.task.id, now: FIXED_NOW }, tmp.storePath);
  const grandchild = await createTask({ title: 'Verify audio', parentTaskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  const sibling = await createTask({ title: 'Write release note', parentTaskId: root.task.id, now: FIXED_NOW }, tmp.storePath);

  const updated = await updateTask({
    taskId: child.task.id,
    title: 'Export final master',
    notes: 'Use the approved grade.\r\n\r\nConfirm the stereo mix.',
    now: '2026-08-22T16:00:00-03:00',
  }, tmp.storePath);
  assert.equal(updated.task.title, 'Export final master');
  assert.equal(updated.task.notes, 'Use the approved grade.\n\nConfirm the stereo mix.');
  assert.equal(updated.task.updatedAt, '2026-08-22T19:00:00.000Z');

  const trashed = await trashTask({ taskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(trashed.trashedCount, 2);
  assert.ok(trashed.state.tasks.items
    .filter((task) => [child.task.id, grandchild.task.id].includes(task.id))
    .every((task) => task.trashedAt === new Date(FIXED_NOW).toISOString()));
  assert.equal(trashed.state.tasks.summary.trashed, 2);
  assert.equal(trashed.state.tasks.items.find((task) => task.id === root.task.id).subtreeTotal, 2);
  assert.equal(trashed.state.tasks.items.find((task) => task.id === root.task.id).allSubtreeTotal, 4);

  const completedAroundTrash = await setTaskCompletion({
    taskId: root.task.id,
    completed: true,
    now: '2026-08-22T19:30:00.000Z',
  }, tmp.storePath);
  assert.equal(completedAroundTrash.state.tasks.items.find((task) => task.id === child.task.id).status, 'open');
  assert.equal(completedAroundTrash.state.tasks.items.find((task) => task.id === grandchild.task.id).status, 'open');

  const restored = await restoreTask({ taskId: child.task.id, now: '2026-08-23T15:00:00-03:00' }, tmp.storePath);
  assert.equal(restored.restoredCount, 2);
  assert.ok(restored.state.tasks.items
    .filter((task) => [child.task.id, grandchild.task.id].includes(task.id))
    .every((task) => task.trashedAt === null));
  assert.equal(restored.state.tasks.items.find((task) => task.id === root.task.id).status, 'open');

  await trashTask({ taskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  const duplicated = await duplicateTask({ taskId: root.task.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(duplicated.copiedCount, 2);
  const deleted = await deleteTask({ taskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(deleted.deletedCount, 2);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === child.task.id), false);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === grandchild.task.id), false);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === root.task.id), true);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === sibling.task.id), true);
  await assert.rejects(deleteTask({ taskId: child.task.id }, tmp.storePath), /Task not found/);
});

test('Trash rejects active-only mutations and permanently prunes items after 30 days', async () => {
  const tmp = await makeStoreCopy('lifeos-task-trash-retention-');
  const expired = await createTask({ title: 'Expired trash', now: '2026-07-01T12:00:00Z' }, tmp.storePath);
  const recent = await createTask({ title: 'Recent trash', now: '2026-07-20T12:00:00Z' }, tmp.storePath);
  await trashTask({ taskId: expired.task.id, now: '2026-07-01T12:00:00Z' }, tmp.storePath);
  await trashTask({ taskId: recent.task.id, now: '2026-07-20T12:00:00Z' }, tmp.storePath);

  await assert.rejects(
    setTaskCompletion({ taskId: expired.task.id, completed: true }, tmp.storePath),
    /Restore it first/,
  );
  await assert.rejects(
    trashTask({ taskId: recent.task.id }, tmp.storePath),
    /already in Trash/,
  );
  await assert.rejects(deleteTask({ taskId: 'demo-task-inbox-passport' }, tmp.storePath), /must be in Trash/);

  const purged = await purgeExpiredTaskTrash({ now: '2026-07-31T12:00:00Z' }, tmp.storePath);
  assert.equal(purged.purgedCount, 1);
  assert.equal(purged.state.tasks.items.some((task) => task.id === expired.task.id), false);
  assert.equal(purged.state.tasks.items.some((task) => task.id === recent.task.id), true);
  assert.equal(purged.state.tasks.summary.trashed, 1);

  const invalid = await readStore(tmp.storePath);
  invalid.tasks.items[0].trashedAt = 'not-a-date';
  assert.throws(() => validateStore(invalid), /trashedAt/);
});

test('tasks carry a validated priority and normalized tag set', async () => {
  const tmp = await makeStoreCopy('lifeos-task-labels-');
  const created = await createTask({
    title: 'Send the festival submission',
    priority: 'high',
    tags: ['Admin', 'admin', '  deadlines  ', ''],
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(created.task.priority, 'high');
  assert.deepEqual(created.task.tags, ['Admin', 'deadlines']);

  const lowered = await setTaskPriority({ taskId: created.task.id, priority: 'low', now: FIXED_NOW }, tmp.storePath);
  assert.equal(lowered.task.priority, 'low');
  await assert.rejects(
    setTaskPriority({ taskId: created.task.id, priority: 'urgent' }, tmp.storePath),
    /Task priority must be one of/,
  );

  const retagged = await updateTaskTags({
    taskId: created.task.id,
    tags: ['Deadlines', 'festival'],
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.deepEqual(retagged.task.tags, ['Deadlines', 'festival']);
  await assert.rejects(updateTaskTags({ taskId: created.task.id, tags: 'festival' }, tmp.storePath), /must be an array/);

  const untouched = await readStore(tmp.storePath);
  untouched.tasks.items.find((task) => task.id === created.task.id).priority = 'someday';
  assert.throws(() => validateStore(untouched), /unknown priority/);
});

test('a task due date can be set and cleared without disturbing the rest of its schedule', async () => {
  const tmp = await makeStoreCopy('lifeos-task-schedule-');
  const created = await createTask({
    title: 'Book the mixing room',
    dueDate: '2026-08-25',
    startTime: '14:00',
    durationMinutes: 90,
    now: FIXED_NOW,
  }, tmp.storePath);

  const moved = await setTaskSchedule({ taskId: created.task.id, dueDate: '2026-08-27', now: FIXED_NOW }, tmp.storePath);
  assert.deepEqual(moved.task.schedule, {
    dueDate: '2026-08-27',
    startTime: '14:00',
    durationMinutes: 90,
    recurrence: null,
  });

  const cleared = await setTaskSchedule({
    taskId: created.task.id,
    dueDate: null,
    startTime: null,
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.equal(cleared.task.schedule.dueDate, null);
  assert.equal(cleared.task.schedule.startTime, null);
});

test('reordering places a task among its siblings, re-parents subtrees, and refuses cycles', async () => {
  const tmp = await makeStoreCopy('lifeos-task-reorder-');
  const first = await createTask({ title: 'First', projectId: 'portia', now: FIXED_NOW }, tmp.storePath);
  const second = await createTask({ title: 'Second', projectId: 'portia', now: FIXED_NOW }, tmp.storePath);
  const third = await createTask({ title: 'Third', projectId: 'portia', now: FIXED_NOW }, tmp.storePath);
  const childOfThird = await createTask({ title: 'Third child', parentTaskId: third.task.id, now: FIXED_NOW }, tmp.storePath);

  const moved = await reorderTask({
    taskId: third.task.id,
    parentTaskId: null,
    beforeTaskId: first.task.id,
    now: FIXED_NOW,
  }, tmp.storePath);
  const rootOrder = moved.state.tasks.items
    .filter((task) => task.parentTaskId == null && task.projectId === 'portia')
    .map((task) => task.title)
    .filter((title) => ['First', 'Second', 'Third'].includes(title));
  assert.deepEqual(rootOrder, ['Third', 'First', 'Second']);

  const nested = await reorderTask({
    taskId: second.task.id,
    parentTaskId: first.task.id,
    beforeTaskId: null,
    now: FIXED_NOW,
  }, tmp.storePath);
  const nestedTask = nested.state.tasks.items.find((task) => task.id === second.task.id);
  assert.equal(nestedTask.parentTaskId, first.task.id);
  assert.equal(nestedTask.depth, 1);

  const inbox = await reorderTask({ taskId: first.task.id, parentTaskId: null, now: FIXED_NOW }, tmp.storePath);
  assert.equal(inbox.state.tasks.items.find((task) => task.id === second.task.id).projectId, 'portia');

  await assert.rejects(
    reorderTask({ taskId: third.task.id, parentTaskId: childOfThird.task.id }, tmp.storePath),
    /cannot be nested under one of its own subtasks/,
  );
  await assert.rejects(
    reorderTask({ taskId: third.task.id, parentTaskId: third.task.id }, tmp.storePath),
    /cannot be nested under itself/,
  );
  await assert.rejects(
    reorderTask({ taskId: third.task.id, beforeTaskId: 'missing-task' }, tmp.storePath),
    /Task position target not found/,
  );
});

test('re-parenting a task carries its whole subtree into the new list', async () => {
  const tmp = await makeStoreCopy('lifeos-task-reparent-');
  const before = buildState(await readStore(tmp.storePath), { now: FIXED_NOW });
  const inboxRoot = await createTask({ title: 'Loose thread', now: FIXED_NOW }, tmp.storePath);
  const inboxChild = await createTask({ title: 'Loose detail', parentTaskId: inboxRoot.task.id, now: FIXED_NOW }, tmp.storePath);
  const projectRoot = await createTask({ title: 'Release plan', projectId: 'vulcano', now: FIXED_NOW }, tmp.storePath);

  const adopted = await reorderTask({
    taskId: inboxRoot.task.id,
    parentTaskId: projectRoot.task.id,
    beforeTaskId: null,
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(adopted.state.tasks.items.find((task) => task.id === inboxRoot.task.id).projectId, 'vulcano');
  assert.equal(adopted.state.tasks.items.find((task) => task.id === inboxChild.task.id).projectId, 'vulcano');
  assert.equal(
    adopted.state.tasks.summary.inbox.total,
    before.tasks.summary.inbox.total,
  );
});

test('duplicating a task copies its subtree with new ids directly beneath the original', async () => {
  const tmp = await makeStoreCopy('lifeos-task-duplicate-');
  const root = await createTask({
    title: 'Weekly review',
    projectId: 'portia',
    priority: 'medium',
    tags: ['ritual'],
    notes: 'Read last week first.',
    now: FIXED_NOW,
  }, tmp.storePath);
  await createTask({ title: 'Skim the log', parentTaskId: root.task.id, now: FIXED_NOW }, tmp.storePath);
  const trailing = await createTask({ title: 'Something after', projectId: 'portia', now: FIXED_NOW }, tmp.storePath);

  const copied = await duplicateTask({ taskId: root.task.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(copied.copiedCount, 2);
  assert.notEqual(copied.task.id, root.task.id);
  assert.equal(copied.task.title, 'Weekly review');
  assert.equal(copied.task.priority, 'medium');
  assert.deepEqual(copied.task.tags, ['ritual']);
  assert.equal(copied.task.notes, 'Read last week first.');

  const copiedTree = copied.state.tasks.items.find((task) => task.id === copied.task.id);
  assert.equal(copiedTree.subtreeTotal, 2);
  const order = copied.state.tasks.items
    .filter((task) => task.parentTaskId == null && task.projectId === 'portia')
    .map((task) => task.id);
  assert.equal(order.indexOf(copied.task.id), order.indexOf(root.task.id) + 1);
  assert.ok(order.indexOf(trailing.task.id) > order.indexOf(copied.task.id));
});

test('top-level project assignment cascades through a task tree and project deletion preserves tasks in Inbox', async () => {
  const tmp = await makeStoreCopy('lifeos-task-project-');
  const root = await createTask({ title: 'Project-linked root', projectId: 'portia', now: FIXED_NOW }, tmp.storePath);
  const child = await createTask({ title: 'Project-linked child', parentTaskId: root.task.id, now: FIXED_NOW }, tmp.storePath);
  const detached = await setTaskProject({ taskId: root.task.id, projectId: null, now: FIXED_NOW }, tmp.storePath);
  assert.equal(detached.affectedCount, 2);
  assert.ok(detached.state.tasks.items
    .filter((task) => [root.task.id, child.task.id].includes(task.id))
    .every((task) => task.projectId == null));
  await assert.rejects(setTaskProject({ taskId: child.task.id, projectId: 'vulcano' }, tmp.storePath), /top-level/);

  const beforeDelete = await readStore(tmp.storePath);
  const substackTaskCount = beforeDelete.tasks.items.filter((task) => task.projectId === 'substack').length;
  const deleted = await deleteProject({
    projectId: 'substack',
    preserveCategory: 'Substack',
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.equal(deleted.detachedTaskCount, substackTaskCount);
  assert.ok(deleted.state.tasks.items
    .filter((task) => task.title === 'Rewrite the essay opening')
    .every((task) => task.projectId == null));
});

test('task scheduling and hierarchy validation reject malformed future-calendar state', async () => {
  const tmp = await makeStoreCopy('lifeos-task-validation-');
  await assert.rejects(createTask({ title: 'Invalid time', startTime: '09:00' }, tmp.storePath), /requires a due date/);
  await assert.rejects(createTask({ title: 'Invalid recurrence', recurrence: { frequency: 'daily' } }, tmp.storePath), /future release/);

  const invalid = await readStore(tmp.storePath);
  invalid.tasks.items[0].parentTaskId = invalid.tasks.items[1].id;
  invalid.tasks.items[1].parentTaskId = invalid.tasks.items[0].id;
  invalid.tasks.items[1].projectId = invalid.tasks.items[0].projectId;
  assert.throws(() => validateStore(invalid), /cycle/);
});

test('reading books are added once and move across the shared status model', async () => {
  const tmp = await makeStoreCopy('lifeos-reading-');
  const added = await addReadingBook({
    status: 'to_read',
    now: FIXED_NOW,
    book: {
      title: 'A Test Book',
      authors: ['Ada Reader'],
      isbn13: '9780000000002',
      source: { provider: 'open_library', workId: 'OL123W', url: 'https://openlibrary.org/works/OL123W' },
    },
  }, tmp.storePath);

  assert.equal(added.book.status, 'to_read');
  assert.equal(added.state.reading.summary.byStatus.to_read, 4);
  const moved = await setReadingBookStatus({ bookId: added.book.id, status: 'next_up', now: '2026-08-22T16:00:00-03:00' }, tmp.storePath);
  assert.equal(moved.book.status, 'next_up');
  assert.equal(moved.state.reading.summary.byStatus.next_up, 3);
  assert.equal(moved.state.reading.summary.byStatus.to_read, 3);

  await assert.rejects(addReadingBook({ status: 'reading', book: added.book }, tmp.storePath), /already in Reading/);
});

test('reading queue order can be changed without changing status', async () => {
  const tmp = await makeStoreCopy('lifeos-reading-order-');
  const before = await readStore(tmp.storePath);
  const nextUp = before.reading.books.filter((book) => book.status === 'next_up').sort((a, b) => a.sortOrder - b.sortOrder);
  await reorderReadingBook({ bookId: nextUp[1].id, direction: 'up', now: FIXED_NOW }, tmp.storePath);
  const after = await readStore(tmp.storePath);
  const reordered = after.reading.books.filter((book) => book.status === 'next_up').sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(reordered.map((book) => book.id), [nextUp[1].id, nextUp[0].id]);
  assert.ok(reordered.every((book) => book.status === 'next_up'));
});

test('reading books can be positioned at a drag target within or across statuses', async () => {
  const tmp = await makeStoreCopy('lifeos-reading-position-');
  const before = await readStore(tmp.storePath);
  const nextUp = before.reading.books.filter((book) => book.status === 'next_up').sort((a, b) => a.sortOrder - b.sortOrder);
  const readingBook = before.reading.books.find((book) => book.status === 'reading');

  await reorderReadingBook({
    bookId: nextUp[1].id,
    status: 'next_up',
    beforeBookId: nextUp[0].id,
    now: FIXED_NOW,
  }, tmp.storePath);
  await reorderReadingBook({
    bookId: readingBook.id,
    status: 'next_up',
    beforeBookId: nextUp[1].id,
    now: FIXED_NOW,
  }, tmp.storePath);

  const after = await readStore(tmp.storePath);
  const positioned = after.reading.books.filter((book) => book.status === 'next_up').sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(positioned.slice(0, 3).map((book) => book.id), [readingBook.id, nextUp[1].id, nextUp[0].id]);
  assert.equal(after.reading.books.find((book) => book.id === readingBook.id).status, 'next_up');
});

test('reading validation rejects unknown statuses', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  store.reading.books[0].status = 'someday';
  assert.throws(() => validateStore(store), /unknown status/);
});

test('reading tags are normalized and permanently deleted books leave every view', async () => {
  const tmp = await makeStoreCopy('lifeos-reading-tags-delete-');
  const before = await readStore(tmp.storePath);
  const target = before.reading.books.find((book) => book.id === 'demo-book-kindred');
  const tagged = await updateReadingBookTags({
    bookId: target.id,
    tags: [' Favorite ', 'favorite', 'Time Travel', '', 'time   travel'],
    now: FIXED_NOW,
  }, tmp.storePath);
  assert.deepEqual(tagged.book.tags, ['Favorite', 'Time Travel']);

  const deleted = await deleteReadingBook({ bookId: target.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(deleted.book.title, 'Kindred');
  assert.equal(deleted.state.reading.summary.total, before.reading.books.length - 1);
  assert.equal(deleted.state.reading.books.some((book) => book.id === target.id), false);
  await assert.rejects(deleteReadingBook({ bookId: target.id }, tmp.storePath), /not found/);
});

test('finished books accept an editable, validated date read', async () => {
  const tmp = await makeStoreCopy('lifeos-reading-finished-date-');
  const updated = await updateReadingBookFinishedDate({
    bookId: 'demo-book-odyssey',
    date: '2025-03-14',
    now: FIXED_NOW,
  }, tmp.storePath);

  assert.equal(updated.book.finishedAt, '2025-03-14T12:00:00.000Z');
  assert.equal(updated.state.reading.books.find((book) => book.id === 'demo-book-odyssey').finishedAt, '2025-03-14T12:00:00.000Z');
  await assert.rejects(updateReadingBookFinishedDate({
    bookId: 'demo-book-odyssey',
    date: '2026-08-23',
    now: FIXED_NOW,
  }, tmp.storePath), /future/);
  await assert.rejects(updateReadingBookFinishedDate({
    bookId: 'demo-book-left-hand-darkness',
    date: '2025-03-14',
    now: FIXED_NOW,
  }, tmp.storePath), /finished book/);
});

async function makeStoreCopy(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const storePath = path.join(directory, 'lifeos.json');
  await writeFile(storePath, await readFile(DEMO_STORE_PATH, 'utf8'), 'utf8');
  return { directory, storePath };
}
