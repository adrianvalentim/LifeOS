import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverGoogleDriveRoots,
  resolveDataDirectory,
  writeBackupSnapshot,
} from '../src/lifeos-storage.mjs';
import { DEMO_STORE_PATH, readStore } from '../src/lifeos-data.mjs';

test('personal data directories follow each platform and allow an explicit override', () => {
  assert.equal(
    resolveDataDirectory({ platform: 'darwin', home: '/Users/tester', env: {} }),
    '/Users/tester/Library/Application Support/LifeOS',
  );
  assert.equal(
    resolveDataDirectory({ platform: 'linux', home: '/home/tester', env: { XDG_DATA_HOME: '/data' } }),
    '/data/lifeos',
  );
  assert.equal(
    resolveDataDirectory({ platform: 'win32', home: 'C:\\Users\\tester', env: { APPDATA: 'C:\\Profiles\\tester' } }),
    path.win32.join('C:\\Profiles\\tester', 'LifeOS'),
  );
  assert.equal(
    resolveDataDirectory({ platform: 'darwin', home: '/Users/tester', env: { LIFEOS_DATA_DIR: '/private/lifeos' } }),
    '/private/lifeos',
  );
});

test('Google Drive discovery lists only usable My Drive roots', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'lifeos-drive-discovery-'));
  const cloudStorage = path.join(home, 'Library', 'CloudStorage');
  const first = path.join(cloudStorage, 'GoogleDrive-first@example.com', 'My Drive');
  const second = path.join(cloudStorage, 'GoogleDrive-second@example.com', 'My Drive');
  await Promise.all([
    mkdir(first, { recursive: true }),
    mkdir(second, { recursive: true }),
    mkdir(path.join(cloudStorage, 'Dropbox'), { recursive: true }),
    mkdir(path.join(cloudStorage, 'GoogleDrive-incomplete@example.com'), { recursive: true }),
  ]);

  assert.deepEqual(await discoverGoogleDriveRoots({ platform: 'darwin', home }), [first, second]);
});

test('cloud snapshots keep latest, daily, and monthly validated copies', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeos-snapshots-'));
  const store = await readStore(DEMO_STORE_PATH);
  const result = await writeBackupSnapshot(store, {
    backupDirectory: directory,
    attemptedAt: '2026-08-24T01:30:00.000Z',
  });

  assert.equal(result.snapshotDate, '2026-08-23');
  for (const filePath of [result.latestPath, result.dailyPath, result.monthlyPath]) {
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), store);
  }
});
