import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEMO_STORE_PATH,
  addReadingBook,
  buildState,
  dateOnly,
  deleteReadingBook,
  logTime,
  migrateStore,
  parseDurationToMinutes,
  readStore,
  reorderReadingBook,
  setReadingBookStatus,
  startSession,
  stopSession,
  updateReadingBookTags,
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

test('older stores migrate to schema version 4 with Reading tags', async () => {
  const store = await readStore(DEMO_STORE_PATH);
  delete store.reading;
  store.meta.schemaVersion = 2;
  const migrated = migrateStore(store);

  assert.equal(migrated.meta.schemaVersion, 4);
  assert.deepEqual(migrated.reading, { books: [] });
  assert.doesNotThrow(() => validateStore(migrated));

  const versionThree = await readStore(DEMO_STORE_PATH);
  versionThree.meta.schemaVersion = 3;
  for (const book of versionThree.reading.books) delete book.tags;
  const tagged = migrateStore(versionThree);
  assert.equal(tagged.meta.schemaVersion, 4);
  assert.ok(tagged.reading.books.every((book) => Array.isArray(book.tags) && book.tags.length === 0));
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

async function makeStoreCopy(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const storePath = path.join(directory, 'lifeos.json');
  await writeFile(storePath, await readFile(DEMO_STORE_PATH, 'utf8'), 'utf8');
  return { directory, storePath };
}
