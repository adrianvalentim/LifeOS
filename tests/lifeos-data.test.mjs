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
  logTime,
  migrateStore,
  parseDurationToMinutes,
  readStore,
  reorderReadingBook,
  setProjectStatus,
  setReadingBookStatus,
  setTaskCompletion,
  setTaskProject,
  startSession,
  stopSession,
  updateReadingBookFinishedDate,
  updateReadingBookTags,
  updateTask,
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
  assert.equal(state.projects.find((project) => project.id === 'vulcano').weekHours, 14.2);
  assert.ok(state.rhythmHeatmap.values.flat().some((value) => value > 0));
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

test('older stores migrate to schema version 8 with Reading, project categories, tasks, and task notes', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  delete store.reading;
  delete store.tasks;
  store.meta.schemaVersion = 2;
  const migrated = migrateStore(store);

  assert.equal(migrated.meta.schemaVersion, 8);
  assert.deepEqual(migrated.reading, { books: [] });
  assert.deepEqual(migrated.tasks, { items: [] });
  assert.doesNotThrow(() => validateStore(migrated));

  const versionThree = await readStore(DEMO_STORE_PATH);
  versionThree.meta.schemaVersion = 3;
  for (const book of versionThree.reading.books) delete book.tags;
  const tagged = migrateStore(versionThree);
  assert.equal(tagged.meta.schemaVersion, 8);
  assert.ok(tagged.reading.books.every((book) => Array.isArray(book.tags) && book.tags.length === 0));

  const versionFour = await readStore(DEMO_STORE_PATH);
  versionFour.meta.schemaVersion = 4;
  for (const project of versionFour.projects) project.status = 'active';
  versionFour.projects.at(-1).status = 'inactive';
  const projectStatuses = migrateStore(versionFour);
  assert.equal(projectStatuses.meta.schemaVersion, 8);
  assert.ok(projectStatuses.projects.slice(0, -1).every((project) => project.status === 'next_up'));
  assert.equal(projectStatuses.projects.at(-1).status, 'dropped');

  const versionFive = await readStore(DEMO_STORE_PATH);
  versionFive.meta.schemaVersion = 5;
  delete versionFive.categories;
  for (const project of versionFive.projects) delete project.categoryIds;
  for (const entry of versionFive.timeEntries) delete entry.categoryIds;
  const categorized = migrateStore(versionFive);
  assert.equal(categorized.meta.schemaVersion, 8);
  assert.deepEqual(categorized.categories, {});
  assert.ok(categorized.projects.every((project) => Array.isArray(project.categoryIds)));
  assert.ok(categorized.timeEntries.every((entry) => Array.isArray(entry.categoryIds)));

  const versionSix = await readStore(DEMO_STORE_PATH);
  versionSix.meta.schemaVersion = 6;
  delete versionSix.tasks;
  const tasked = migrateStore(versionSix);
  assert.equal(tasked.meta.schemaVersion, 8);
  assert.deepEqual(tasked.tasks, { items: [] });

  const versionSeven = await readStore(DEMO_STORE_PATH);
  versionSeven.meta.schemaVersion = 7;
  for (const task of versionSeven.tasks.items) delete task.notes;
  const noted = migrateStore(versionSeven);
  assert.equal(noted.meta.schemaVersion, 8);
  assert.ok(noted.tasks.items.every((task) => task.notes === ''));
});

test('projects move across the five-status workflow and completed work leaves active recommendations', async () => {
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

test('task details persist multiline notes and deleting a task removes only its subtree', async () => {
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

  const deleted = await deleteTask({ taskId: child.task.id, now: FIXED_NOW }, tmp.storePath);
  assert.equal(deleted.deletedCount, 2);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === child.task.id), false);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === grandchild.task.id), false);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === root.task.id), true);
  assert.equal(deleted.state.tasks.items.some((task) => task.id === sibling.task.id), true);
  assert.equal(deleted.state.tasks.items.find((task) => task.id === root.task.id).subtreeTotal, 2);
  await assert.rejects(deleteTask({ taskId: child.task.id }, tmp.storePath), /Task not found/);
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
