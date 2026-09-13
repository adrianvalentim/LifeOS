import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureWebPage, DEMO_STORE_PATH, readStore, setTaskCompletion, setTaskPriority, setTaskProject, setTaskSchedule, trashTask, updateTask, writeStore } from '../src/lifeos-data.mjs';
import { extractWebLinks } from '../public/web-links.js';
import { capture, nativeRequest } from '../extensions/lifeos-capture/background.js';
import { installCaptureHost } from '../scripts/install-capture-host.mjs';
import { openSavedTaskLink } from '../src/task-web-links.mjs';

const NOW = '2026-09-13T01:30:00.000Z'; // September 12 in LifeOS's São Paulo timezone.
const PAGE = { title: 'A useful article — leitura', url: 'https://example.org/article?q=one%20two&edition=2#section', now: NOW };
const manifest = JSON.parse(await readFile(new URL('../extensions/lifeos-capture/manifest.json', import.meta.url), 'utf8'));
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + parseInt(value, 16)));
const origin = `chrome-extension://${extensionId}/`;

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lifeos capture's "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'lifeos.json');
  await copyFile(DEMO_STORE_PATH, storePath);
  return { directory, storePath };
}

test('capture atomically creates Web Articles and the requested task, preserving other data', async (t) => {
  const { storePath } = await fixture(t);
  const before = await readStore(storePath);
  const result = await captureWebPage(PAGE, storePath);
  const after = await readStore(storePath);
  assert.equal(result.created, true);
  assert.equal(result.project.name, 'Web Articles');
  assert.equal(result.task.projectId, result.project.id);
  assert.equal(result.task.title, PAGE.title);
  assert.equal(result.task.notes, PAGE.url);
  assert.equal(result.task.priority, 'low');
  assert.equal(result.task.schedule.dueDate, '2026-09-12');
  assert.deepEqual(result.task.tags, []);
  assert.equal(after.meta.schemaVersion, before.meta.schemaVersion);
  assert.deepEqual(after.timeEntries, before.timeEntries);
  assert.deepEqual(after.reading, before.reading);
  assert.deepEqual(after.projects.slice(0, -1), before.projects);
  assert.deepEqual(after.tasks.items.slice(0, -1), before.tasks.items);
  assert.deepEqual(await readStore(`${storePath}.bak`), before);
});

test('concurrent capture clicks create one task and one project', async (t) => {
  const { storePath } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => captureWebPage(PAGE, storePath)));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.task.id)).size, 1);
  assert.equal((await readStore(storePath)).projects.filter((p) => p.name === 'Web Articles').length, 1);
});

test('repeat capture preserves edited notes, title, project, priority, due date and completion', async (t) => {
  const { storePath } = await fixture(t);
  const { task } = await captureWebPage(PAGE, storePath);
  const taskId = task.id;
  await updateTask({ taskId, title: 'My title', notes: `Read slowly.\n${PAGE.url}\nMake notes.`, now: NOW }, storePath);
  await setTaskProject({ taskId, projectId: null, now: NOW }, storePath);
  await setTaskPriority({ taskId, priority: 'high', now: NOW }, storePath);
  await setTaskSchedule({ taskId, dueDate: '2026-10-01', now: NOW }, storePath);
  await setTaskCompletion({ taskId, completed: true, now: NOW }, storePath);
  const edited = (await readStore(storePath)).tasks.items.find((item) => item.id === taskId);
  const result = await captureWebPage({ ...PAGE, title: 'Site renamed its title' }, storePath);
  assert.equal(result.created, false);
  assert.deepEqual(result.task, edited);
});

test('a trashed capture can be saved again without touching the old task', async (t) => {
  const { storePath } = await fixture(t);
  const first = await captureWebPage(PAGE, storePath);
  await trashTask({ taskId: first.task.id, now: NOW }, storePath);
  const second = await captureWebPage(PAGE, storePath);
  assert.equal(second.created, true);
  assert.notEqual(second.task.id, first.task.id);
  assert.ok((await readStore(storePath)).tasks.items.find((item) => item.id === first.task.id).trashedAt);
});

test('capture rejects unsupported, credential-bearing, malformed and overlong URLs without writing', async (t) => {
  const { storePath } = await fixture(t);
  const before = await readFile(storePath, 'utf8');
  for (const url of ['brave://settings', 'file:///etc/hosts', 'javascript:alert(1)', 'data:text/html,test', 'not a url', 'https://user:secret@example.org', 'https://example.org/\nextra', 'https://example.org/' + 'x'.repeat(16_000)]) {
    await assert.rejects(captureWebPage({ ...PAGE, url }, storePath));
  }
  assert.equal(await readFile(storePath, 'utf8'), before);
});

test('capture reuses an exact named project and falls back to hostname for an empty title', async (t) => {
  const { storePath } = await fixture(t);
  const store = await readStore(storePath);
  store.projects[0].name = 'Web Articles';
  await writeStore(store, storePath);
  const result = await captureWebPage({ ...PAGE, title: '  ' }, storePath);
  assert.equal(result.project.id, store.projects[0].id);
  assert.equal(result.task.title, 'example.org');
  assert.equal((await readStore(storePath)).projects.length, store.projects.length);
});

test('ambiguous destination names fail before any task or project is written', async (t) => {
  const { storePath } = await fixture(t);
  const store = await readStore(storePath);
  store.projects[0].name = 'Web Articles';
  store.projects[1].name = 'Web Articles';
  await writeStore(store, storePath);
  const before = await readFile(storePath, 'utf8');
  await assert.rejects(captureWebPage(PAGE, storePath), /More than one project/);
  assert.equal(await readFile(storePath, 'utf8'), before);
});

function frame(message) {
  const body = Buffer.from(typeof message === 'string' ? message : JSON.stringify(message));
  const header = Buffer.alloc(4);
  if (os.endianness() === 'LE') header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

async function sendHost(directory, message, options = {}) {
  const program = options.launcher || process.execPath;
  const args = options.launcher ? [options.origin || origin] : ['scripts/capture-native-host.mjs', options.origin || origin];
  const child = spawn(program, args, { cwd: new URL('..', import.meta.url), env: { ...process.env, LIFEOS_DATA_DIR: directory, LIFEOS_BACKUP_DIR: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks = [];
  let stderr = '';
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const bytes = options.bytes || frame(message);
  child.stdin.write(bytes.subarray(0, 2));
  child.stdin.end(bytes.subarray(2));
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr))); });
  const output = Buffer.concat(chunks);
  const length = os.endianness() === 'LE' ? output.readUInt32LE(0) : output.readUInt32BE(0);
  assert.equal(output.length, length + 4, 'stdout contains exactly one native-message frame');
  return JSON.parse(output.subarray(4).toString('utf8'));
}

test('native host creates a task with the desktop server absent, and retry is idempotent', async (t) => {
  const { directory, storePath } = await fixture(t);
  const result = await sendHost(directory, { action: 'capture', ...PAGE });
  assert.equal(result.ok, true);
  assert.equal(result.task.title, PAGE.title);
  assert.equal(result.project, 'Web Articles');
  assert.equal(result.created, true);
  assert.equal((await readStore(storePath)).tasks.items.at(-1).notes, PAGE.url);
  assert.equal((await sendHost(directory, { action: 'capture', ...PAGE })).created, false);
});

test('native host rejects unknown callers, malformed JSON, oversized and partial frames', async (t) => {
  const { directory, storePath } = await fixture(t);
  const before = await readFile(storePath, 'utf8');
  const results = [
    await sendHost(directory, { action: 'capture', ...PAGE }, { origin: 'chrome-extension://untrusted/' }),
    await sendHost(directory, '{'),
    await sendHost(directory, { action: 'delete', ...PAGE }),
    await sendHost(directory, null, { bytes: Buffer.from([255, 255, 255, 127]) }),
    await sendHost(directory, null, { bytes: frame(PAGE).subarray(0, 9) }),
  ];
  assert.ok(results.every((result) => result.ok === false));
  assert.equal(await readFile(storePath, 'utf8'), before);
});

test('macOS installer pins one extension origin and handles spaces and quotes in paths', { skip: process.platform !== 'darwin' }, async (t) => {
  const { directory } = await fixture(t);
  const result = await installCaptureHost({ home: directory, dataDirectory: directory });
  assert.equal(result.hostPath, path.join(directory, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.lifeos.capture.json'));
  const host = JSON.parse(await readFile(result.hostPath, 'utf8'));
  assert.deepEqual(host.allowed_origins, [origin]);
  assert.equal(result.extensionId, extensionId);
  const launcher = await readFile(result.launcher, 'utf8');
  assert.ok(launcher.includes(path.join(directory, 'Library', 'Application Support', 'LifeOS', 'browser-capture').replaceAll("'", "'\\''")));
  assert.ok(!launcher.includes(new URL('..', import.meta.url).pathname), 'the installed helper must not depend on the development checkout');
  assert.deepEqual(JSON.parse(await readFile(path.join(result.extensionDirectory, 'manifest.json'), 'utf8')), manifest);
  assert.deepEqual(await sendHost(directory, { action: 'ping' }, { launcher: result.launcher }), { ok: true, app: 'LifeOS', version: 1 });
  assert.equal((await sendHost(directory, { action: 'capture', ...PAGE }, { launcher: result.launcher })).ok, true);
});

test('extension uses only click-scoped page access and native messaging, with all assets present', async () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'nativeMessaging']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  for (const asset of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) {
    assert.ok((await readFile(new URL(`../extensions/lifeos-capture/${asset}`, import.meta.url))).length);
  }
});

test('worker rejects non-web tabs and captures without popup or tab manipulation', async () => {
  assert.equal((await capture({ id: 1, url: 'brave://newtab' }, {})).ok, false);
  const api = {
    runtime: { sendNativeMessage(_host, _message, callback) { callback({ ok: true, created: true, task: { title: 'Test' } }); } },
  };
  assert.equal((await capture({ id: 1, ...PAGE }, api)).ok, true);
});

test('worker reports missing helper without pretending to save', async () => {
  const runtime = { lastError: { message: 'Native host not found' }, sendNativeMessage(_host, _message, callback) { callback(); } };
  const result = await nativeRequest({ action: 'capture' }, runtime);
  assert.equal(result.ok, false);
  assert.match(result.error, /helper is installed/);
});

test('notes expose only HTTP(S) links and deduplicate exact links', () => {
  assert.deepEqual(extractWebLinks(`javascript:alert(1) file:///etc/hosts https://user:pass@example.org\n${PAGE.url}\n${PAGE.url}`), [{ url: PAGE.url, label: 'example.org' }]);
});

test('a broken backup configuration does not turn a successful native capture into failure', async (t) => {
  const { directory, storePath } = await fixture(t);
  await writeFile(path.join(directory, 'storage.json'), '{invalid');
  const result = await sendHost(directory, { action: 'capture', ...PAGE });
  assert.equal(result.ok, true);
  assert.match(result.warning, /Saved locally/);
  assert.equal((await readStore(storePath)).tasks.items.at(-1).notes, PAGE.url);
});

test('a stalled backup cannot delay the native save confirmation past its backup deadline', { skip: process.platform === 'win32', timeout: 10_000 }, async (t) => {
  const { directory, storePath } = await fixture(t);
  // A FIFO with no writer deterministically blocks backup configuration I/O.
  // The real one-shot native process must still acknowledge and exit.
  execFileSync('mkfifo', [path.join(directory, 'storage.json')]);
  const started = performance.now();
  const result = await sendHost(directory, { action: 'capture', ...PAGE });
  assert.equal(result.ok, true);
  assert.match(result.warning, /Saved locally/);
  assert.ok(performance.now() - started < 5_000);
  assert.equal((await readStore(storePath)).tasks.items.at(-1).notes, PAGE.url);
  const status = JSON.parse(await readFile(path.join(directory, 'backup-status.json'), 'utf8'));
  assert.equal(status.ok, false);
  assert.match(status.error, /took too long/);
});

test('desktop link opener accepts only a saved task URL and passes it without a shell', async (t) => {
  const { storePath } = await fixture(t);
  const { task } = await captureWebPage(PAGE, storePath);
  const calls = [];
  const options = { storePath, platform: 'darwin', run: async (...args) => { calls.push(args); } };
  await openSavedTaskLink({ taskId: task.id, url: PAGE.url }, options);
  assert.deepEqual(calls, [['/usr/bin/open', [PAGE.url], { timeout: 10_000 }]]);
  await assert.rejects(openSavedTaskLink({ taskId: task.id, url: 'https://different.example' }, options), /no longer saved/);
  await assert.rejects(openSavedTaskLink({ taskId: task.id, url: 'file:///etc/hosts' }, options), /no longer saved/);
  await trashTask({ taskId: task.id, now: NOW }, storePath);
  await assert.rejects(openSavedTaskLink({ taskId: task.id, url: PAGE.url }, options), /no longer saved/);
  assert.equal(calls.length, 1);
});
