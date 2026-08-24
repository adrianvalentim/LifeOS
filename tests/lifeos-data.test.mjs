import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_STORE_PATH,
  buildState,
  dateOnly,
  logTime,
  parseDurationToMinutes,
  readStore,
  startSession,
  stopSession,
} from '../src/lifeos-data.mjs';

const FIXED_NOW = '2026-08-22T15:00:00-03:00';

test('duration parser accepts hour and minute language', () => {
  assert.equal(parseDurationToMinutes('log 90 min on portia'), 90);
  assert.equal(parseDurationToMinutes('spent 1.5h on vulcano'), 90);
  assert.equal(parseDurationToMinutes('worked 1h 20m on script'), 80);
});

test('demo dashboard values are calculated from entries', async () => {
  const store = await readStore();
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
  const store = await readStore();
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
  const store = await readStore();
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

async function makeStoreCopy(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const storePath = path.join(directory, 'lifeos.json');
  await writeFile(storePath, await readFile(DEFAULT_STORE_PATH, 'utf8'), 'utf8');
  return { directory, storePath };
}
