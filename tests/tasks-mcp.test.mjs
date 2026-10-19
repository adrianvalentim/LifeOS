import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { DEMO_STORE_PATH, readStore } from '../src/lifeos-data.mjs';
import { createTaskService } from '../src/task-service.mjs';
import { createLocalTokenAuthentication, createOAuthAuthentication, readMcpAuthentication } from '../src/tasks-mcp-auth.mjs';
import { createTasksHttpServer } from '../src/tasks-mcp-http.mjs';

const TOKEN = 'fixture-only-not-a-real-credential-123456789';
const READ_TOOLS = ['get_task', 'list_tasks', 'search_tasks'];
const WRITE_TOOLS = ['complete_task', 'create_task', 'edit_task', 'restore_task', 'trash_task'];
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeos-mcp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await readStore(DEMO_STORE_PATH);
  store.tasks.items = [];
  const storePath = path.join(directory, 'lifeos.json');
  await writeFile(storePath, JSON.stringify(store), { mode: 0o600 });
  return { directory, storePath };
}

async function http(t, { enableWrites = false, authentication, service } = {}) {
  const { storePath, directory } = await fixture(t);
  const app = createTasksHttpServer({
    service: service || createTaskService({ storePath, enableWrites }), enableWrites,
    authentication: authentication || createLocalTokenAuthentication(TOKEN),
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => app.close());
  const url = new URL(`http://127.0.0.1:${app.server.address().port}/mcp`);
  return { app, url, storePath, directory };
}

async function client(t, url, token = TOKEN) {
  const c = new Client({ name: 'lifeos-test', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  t.after(() => c.close());
  return c;
}

async function call(c, name, args = {}) {
  const result = await c.callTool({ name, arguments: args });
  assert.ok(!result.isError, result.content?.[0]?.text);
  return result.structuredContent || JSON.parse(result.content[0].text);
}

test('MCP authenticates, bounds requests, and exposes only read tools by default', async (t) => {
  const { url, storePath, directory } = await http(t);
  const before = hash(await readFile(storePath));
  for (const auth of [undefined, 'Bearer wrong', `Bearer ${TOKEN} extra`]) {
    const response = await fetch(url, { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: '{}' });
    assert.equal(response.status, 401);
  }
  assert.equal((await fetch(new URL('/api/state', url))).status, 404);
  assert.equal((await fetch(new URL('/api/tasks/delete', url), { method: 'POST' })).status, 404);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, Host: 'evil.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(invalidHost, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(70_000) })).status, 413);
  const c = await client(t, url);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), READ_TOOLS);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint));
  assert.equal((await call(c, 'list_tasks')).total, 0);
  assert.equal(hash(await readFile(storePath)), before);
  assert.deepEqual(await readdir(directory), ['lifeos.json']);
});

test('MCP task lifecycle preserves hierarchy, IDs, content, tags, schedule, and recoverable Trash', async (t) => {
  const { url, storePath } = await http(t, { enableWrites: true });
  const c = await client(t, url);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...READ_TOOLS, ...WRITE_TOOLS].sort());
  assert.ok(!tools.some((tool) => /delete|purge|project|reading/.test(tool.name)));
  assert.equal(tools.find((tool) => tool.name === 'trash_task').annotations.destructiveHint, true);
  const { task: root } = await call(c, 'create_task', { title: 'Fixture árvore', notes: 'first line\nsecond line', projectId: 'portia', priority: 'high', tags: [' Focus ', 'focus'], dueDate: '2026-10-20', startTime: '09:30', durationMinutes: 45 });
  const { task: child } = await call(c, 'create_task', { title: 'Fixture child', parentTaskId: root.id });
  assert.equal(child.projectId, 'portia');
  assert.deepEqual(root.tags, ['Focus']);
  const search = await call(c, 'search_tasks', { query: 'arvore' });
  assert.equal(search.total, 1);
  assert.ok(!Object.hasOwn(search.tasks[0], 'notes'));
  assert.equal((await call(c, 'search_tasks', { query: 'second line' })).tasks[0].id, root.id);
  assert.equal((await call(c, 'get_task', { taskId: root.id })).descendantCount, 1);
  const page = await call(c, 'list_tasks', { limit: 1 });
  assert.equal(page.total, 2); assert.equal(page.nextOffset, 1);
  assert.equal((await call(c, 'list_tasks', { limit: 1, offset: 1 })).nextOffset, null);
  assert.equal((await call(c, 'list_tasks', { projectId: null })).total, 0);
  assert.equal((await call(c, 'list_tasks', { tag: 'FOCUS', dueFrom: '2026-10-01', dueThrough: '2026-10-31' })).total, 1);
  const completed = await call(c, 'complete_task', { taskId: root.id });
  assert.equal(completed.affectedCount, 2);
  assert.equal((await call(c, 'list_tasks')).total, 0);
  assert.equal((await call(c, 'list_tasks', { scope: 'completed' })).total, 2);
  const { task: child2 } = await call(c, 'create_task', { title: 'Fixture open work', parentTaskId: root.id });
  assert.equal((await call(c, 'get_task', { taskId: root.id })).task.status, 'open');
  assert.equal((await call(c, 'get_task', { taskId: child.id })).task.status, 'completed');
  const trashed = await call(c, 'trash_task', { taskId: root.id });
  assert.equal(trashed.trashedCount, 3);
  assert.equal((await call(c, 'list_tasks', { scope: 'all' })).total, 0);
  assert.equal((await call(c, 'list_tasks', { scope: 'trash' })).total, 3);
  const restored = await call(c, 'restore_task', { taskId: child2.id });
  assert.equal(restored.restoredCount, 2); // child + required ancestor, not its sibling
  const got = await call(c, 'get_task', { taskId: root.id });
  assert.equal(got.task.notes, root.notes);
  assert.equal(got.task.id, root.id);
  assert.equal(got.task.sortOrder, root.sortOrder);
  assert.deepEqual(got.task.schedule, root.schedule);
  await call(c, 'restore_task', { taskId: child.id });
  assert.equal((await readStore(storePath)).tasks.items.length, 3);
});

test('multi-field edit is atomic, rejects stale changes, and preserves concurrent writes', async (t) => {
  const { storePath } = await fixture(t);
  const service = createTaskService({ storePath, enableWrites: true });
  const { task } = await service.create({ title: 'Fixture atomic edit', now: '2026-10-01T12:00:00Z' });
  const before = hash(await readFile(storePath));
  await assert.rejects(service.edit({ taskId: task.id, title: 'Must not persist', startTime: '12:00' }), /start time requires/);
  assert.equal(hash(await readFile(storePath)), before);
  await service.edit({ taskId: task.id, title: 'Fixture edited', notes: 'one\ntwo', priority: 'low', tags: ['Tag', 'tag'], ifUpdatedAt: task.updatedAt });
  await assert.rejects(service.edit({ taskId: task.id, notes: 'stale', ifUpdatedAt: task.updatedAt }), /changed since/);
  await Promise.all([
    service.edit({ taskId: task.id, notes: 'concurrent notes' }),
    service.create({ title: 'Fixture concurrent task' }),
  ]);
  const store = await readStore(storePath);
  assert.equal(store.tasks.items.length, 2);
  const edited = store.tasks.items.find((t) => t.id === task.id);
  assert.equal(edited.title, 'Fixture edited');
  assert.equal(edited.notes, 'concurrent notes');
  assert.deepEqual(edited.tags, ['Tag']);
  assert.equal(edited.priority, 'low');
});

test('MCP rejects unknown arguments, invalid dates, exact-ID mistakes, and disabled writes', async (t) => {
  const { url, storePath } = await http(t, { enableWrites: true });
  const c = await client(t, url);
  const before = hash(await readFile(storePath));
  for (const [name, args] of [
    ['create_task', { title: 'Fixture', dueDate: '2026-02-30' }],
    ['create_task', { title: 'Fixture', now: '2026-10-01T00:00:00Z' }],
    ['create_task', { title: 'Fixture', projectId: 'unknown' }],
    ['get_task', { taskId: 'unknown' }],
    ['edit_task', { taskId: 'unknown', notes: 'Fixture' }],
    ['list_tasks', { limit: 1000 }],
  ]) assert.equal((await c.callTool({ name, arguments: args })).isError, true);
  assert.equal(hash(await readFile(storePath)), before);
  const disabled = createTaskService({ storePath });
  await assert.rejects(disabled.create({ title: 'Fixture' }), /writes are disabled/);
});

test('absent store is never initialized and expired Trash is hidden without pruning', async (t) => {
  const { directory, storePath } = await fixture(t);
  const absent = createTaskService({ storePath: path.join(directory, 'missing.json') });
  await assert.rejects(absent.list(), /ENOENT/);
  assert.equal((await readdir(directory)).length, 1);
  const store = await readStore(storePath);
  store.tasks.items = [{ id: 'expired-fixture', title: 'Fixture expired', notes: '', projectId: null, parentTaskId: null, status: 'open', priority: 'none', tags: [], sortOrder: 1,
    schedule: { dueDate: null, startTime: null, durationMinutes: null, recurrence: null }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', completedAt: null, trashedAt: '2026-01-01T00:00:00Z' }];
  await writeFile(storePath, JSON.stringify(store));
  const before = hash(await readFile(storePath));
  assert.equal((await createTaskService({ storePath }).list({ scope: 'trash' })).total, 0);
  assert.equal(hash(await readFile(storePath)), before);
  assert.equal((await readStore(storePath)).tasks.items.length, 1);
});

test('OAuth verifies signature, issuer, resource audience, expiration, owner, and per-tool scopes', async (t) => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const config = { resource: 'https://tasks.example/mcp', issuer: 'https://auth.example/', jwksUrl: 'https://auth.example/jwks', ownerSubject: 'fixture-owner' };
  const keySet = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  const authentication = createOAuthAuthentication(config, { keySet });
  async function token(overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: config.issuer, aud: config.resource, sub: config.ownerSubject, iat: now, exp: now + 300, scope: 'tasks:read', ...overrides }).setProtectedHeader({ alg: 'ES256' }).sign(privateKey);
  }
  for (const overrides of [{ iss: 'https://evil.example/' }, { aud: 'https://other.example/mcp' }, { sub: 'other-owner' }, { exp: 1 }, { exp: undefined }, { nbf: Math.floor(Date.now() / 1000) + 600 }, { scope: 'tasks:write' }]) {
    assert.equal(await authentication.authenticate(`Bearer ${await token(overrides)}`), null);
  }
  const forgedKey = await generateKeyPair('ES256');
  const forged = await new SignJWT({ iss: config.issuer, aud: config.resource, sub: config.ownerSubject, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000), scope: 'tasks:read' }).setProtectedHeader({ alg: 'ES256' }).sign(forgedKey.privateKey);
  assert.equal(await authentication.authenticate(`Bearer ${forged}`), null);
  const { url, storePath } = await http(t, { enableWrites: true, authentication });
  const response = await fetch(url, { method: 'POST', body: '{}' });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /resource_metadata="https:\/\/tasks.example\//);
  const metadata = await (await fetch(new URL('/.well-known/oauth-protected-resource/mcp', url))).json();
  assert.equal(metadata.resource, config.resource);
  const reader = await client(t, url, await token());
  const tools = (await reader.listTools()).tools;
  assert.ok(tools.every((tool) => tool._meta.securitySchemes[0].type === 'oauth2'));
  assert.equal((await call(reader, 'list_tasks')).total, 0);
  const denied = await reader.callTool({ name: 'create_task', arguments: { title: 'Denied fixture' } });
  assert.equal(denied.isError, true);
  assert.match(denied._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  assert.equal((await readStore(storePath)).tasks.items.length, 0);
  const writer = await client(t, url, await token({ scope: 'tasks:read tasks:write' }));
  assert.equal((await call(writer, 'create_task', { title: 'Allowed fixture' })).task.title, 'Allowed fixture');
});

test('authentication configuration fails closed and does not create credentials', async () => {
  assert.throws(() => createTasksHttpServer({}), /authentication is required/);
  assert.throws(() => createLocalTokenAuthentication('short'), /at least 32/);
  assert.throws(() => createOAuthAuthentication({ resource: 'http://tasks.example/mcp' }), /HTTPS/);
  await assert.rejects(readMcpAuthentication(path.resolve('mcp-auth.json')), /outside the workspace/);
});

test('server launcher reads an isolated store, advertises read tools, and shuts down cleanly', { timeout: 10_000 }, async (t) => {
  const { directory, storePath } = await fixture(t);
  const configPath = path.join(directory, 'fixture-auth.json');
  await writeFile(configPath, JSON.stringify({ mode: 'local-token', token: TOKEN }), { mode: 0o600 });
  const before = hash(await readFile(storePath));
  const child = spawn(process.execPath, ['scripts/tasks-mcp-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, LIFEOS_DATA_DIR: directory, LIFEOS_MCP_AUTH_FILE: configPath,
      LIFEOS_MCP_ENABLE_WRITES: '', LIFEOS_MCP_PORT: '0', LIFEOS_BACKUP_DIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code)); });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(output);
      if (match) resolve(new URL(match[0]));
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Fixture MCP launcher exited before readiness.')));
  });
  const c = await client(t, url);
  assert.deepEqual((await c.listTools()).tools.map((tool) => tool.name).sort(), READ_TOOLS);
  assert.equal((await call(c, 'list_tasks')).total, 0);
  await c.close();
  child.kill('SIGTERM');
  assert.equal(await ended, 0);
  assert.equal(hash(await readFile(storePath)), before);
  assert.deepEqual((await readdir(directory)).sort(), ['fixture-auth.json', 'lifeos.json']);
});

test('private authentication files are permission-checked and repository symlinks rejected', async (t) => {
  const { directory } = await fixture(t);
  const configPath = path.join(directory, 'fixture-auth.json');
  await writeFile(configPath, JSON.stringify({ mode: 'local-token', token: TOKEN }), { mode: 0o600 });
  assert.equal((await readMcpAuthentication(configPath)).mode, 'local-token');
  if (process.platform !== 'win32') {
    await chmod(configPath, 0o644);
    await assert.rejects(readMcpAuthentication(configPath), /private file/);
  }
  const link = path.join(directory, 'workspace-link.json');
  await symlink(path.resolve('package.json'), link);
  await assert.rejects(readMcpAuthentication(link), /outside the workspace/);
});
