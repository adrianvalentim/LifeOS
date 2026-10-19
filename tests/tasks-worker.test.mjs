import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import test from 'node:test';

const ORIGIN = 'https://lifeos-demo.example';
const RESOURCE = `${ORIGIN}/mcp`;
const OWNER = '12345'; // Fictional owner; never reads the personal store.
const CLIENT_ID = 'https://mcp-client.example/client.json';
const REDIRECT = 'https://mcp-client.example/callback';
const verifier = 'fixture-mcp-pkce-verifier-012345678901234567890123456789';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const bundled = build({ entryPoints: ['workers/tasks-demo/worker.mjs'], bundle: true, write: false,
  format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:workers'], target: 'es2022', logLevel: 'silent' });
const privateBundle = build({ entryPoints: ['workers/tasks/worker.mjs'], bundle: true, write: false,
  format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:workers'], target: 'es2022', logLevel: 'silent' });

async function fixture(t, { owner = OWNER, login = true, upstreamScopes = '', privateStore = false } = {}) {
  const script = (await (privateStore ? privateBundle : bundled)).outputFiles[0].text;
  const outbound = [];
  const miniflare = new Miniflare(convertV4MiniflareOptions({ modules: true, script, host: '127.0.0.1', port: 0,
    compatibilityDate: '2026-10-09', compatibilityFlags: ['global_fetch_strictly_public'],
    kvNamespaces: ['OAUTH_KV'], ...(privateStore ? { d1Databases: ['TASKS_DB'] } : {}), bindings: { MCP_ORIGIN: ORIGIN, OWNER_GITHUB_ID: OWNER,
      ...(login ? { GITHUB_CLIENT_ID: 'synthetic-client', GITHUB_CLIENT_SECRET: 'synthetic-secret' } : {}) },
    outboundService: async (request) => {
      outbound.push(request.url);
      if (request.url === CLIENT_ID) return WorkerResponse.json({ client_id: CLIENT_ID, client_name: '<Test client>',
        redirect_uris: [REDIRECT], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' });
      if (request.url === 'https://github.com/login/oauth/access_token') {
        const form = new URLSearchParams(await request.text());
        assert.equal(form.get('client_secret'), 'synthetic-secret');
        assert.equal(form.get('redirect_uri'), `${ORIGIN}/callback`);
        assert.match(form.get('code_verifier'), /^[\da-f-]{72}$/);
        return WorkerResponse.json({ access_token: 'synthetic-upstream-token', token_type: 'bearer', scope: upstreamScopes });
      }
      if (request.url === 'https://api.github.com/user') {
        assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-upstream-token');
        return WorkerResponse.json({ id: Number(owner) });
      }
      throw new Error(`Unexpected outbound request: ${new URL(request.url).origin}`);
    },
  }));
  t.after(() => miniflare.dispose());
  await miniflare.ready;
  if (privateStore) {
    const db = await miniflare.getD1Database('TASKS_DB');
    await db.prepare(await readFile('workers/tasks/schema.sql', 'utf8')).run();
    await db.prepare('INSERT INTO lifeos_tasks (id, revision, document) VALUES (1, 1, ?)')
      .bind(JSON.stringify({ schemaVersion: 1, phase: 'active', timezone: 'Etc/UTC', projectIds: [], items: [] })).run();
  }
  const request = async (path, init) => miniflare.dispatchFetch(new URL(path, ORIGIN).href, { ...init, redirect: 'manual' });
  return { miniflare, request, outbound, script };
}

const cookie = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

async function consent(request, { scope = 'tasks:read', resource = RESOURCE } = {}) {
  const params = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT,
    scope, resource, state: 'synthetic-client-state', code_challenge: challenge, code_challenge_method: 'S256' });
  const page = await request(`/authorize?${params}`);
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  return { page, html, handle, cookies: cookie(page) };
}

async function authorize(request, { scope = 'tasks:read' } = {}) {
  const start = await consent(request, { scope });
  assert.equal(start.page.status, 200, start.html);
  assert.ok(start.handle);
  const form = new URLSearchParams({ handle: start.handle, decision: 'approve' });
  for (const value of scope.split(' ')) form.append('scope', value);
  const approved = await request('/authorize', { method: 'POST', headers: { Cookie: start.cookies, Origin: ORIGIN }, body: form });
  assert.equal(approved.status, 302, await approved.clone().text());
  const upstream = new URL(approved.headers.get('location'));
  assert.equal(upstream.origin, 'https://github.com');
  assert.equal(upstream.searchParams.get('scope'), '');
  assert.equal(upstream.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(upstream.searchParams.get('redirect_uri'), `${ORIGIN}/callback`);
  const callback = await request(`/callback?${new URLSearchParams({ state: upstream.searchParams.get('state'), code: 'synthetic-code' })}`,
    { headers: { Cookie: cookie(approved) } });
  assert.equal(callback.status, 302, await callback.clone().text());
  return { callback, upstream };
}

async function token(request, { scope = 'tasks:read', refresh = false } = {}) {
  const { callback } = await authorize(request, { scope });
  const location = new URL(callback.headers.get('location'));
  assert.equal(location.origin, new URL(REDIRECT).origin);
  assert.equal(location.searchParams.get('state'), 'synthetic-client-state');
  assert.ok(!location.searchParams.has('error'), location.searchParams.get('error'));
  const response = await request('/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code',
    code: location.searchParams.get('code'), client_id: CLIENT_ID, redirect_uri: REDIRECT, code_verifier: verifier, resource: RESOURCE }) });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.scope, scope);
  assert.equal(body.expires_in, 3600);
  assert.equal(Boolean(body.refresh_token), refresh);
  return body.access_token;
}

test('Worker fails closed, advertises HTTPS OAuth, rejects oversized/cross-origin/other app requests', async (t) => {
  const { request, miniflare, script } = await fixture(t, { login: false });
  for (const headers of [{}, { Authorization: 'Bearer invented' }, { 'X-User-Id': `github:${OWNER}`, 'X-Scope': 'tasks:read' }]) {
    const response = await request('/mcp', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /oauth-protected-resource/);
  }
  const resource = await (await request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(resource.resource, RESOURCE);
  assert.deepEqual(resource.scopes_supported, ['tasks:read']);
  const metadata = await (await request('/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.authorization_endpoint, `${ORIGIN}/authorize`);
  assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.ok(!metadata.registration_endpoint);
  assert.equal((await request('/oauth/register', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await request('/authorize')).status, 503);
  for (const path of ['/api/state', '/api/tasks/delete', '/mcp/anything', '/public/index.html']) assert.equal((await request(path)).status, 404);
  assert.equal((await request('/mcp?token=bad', { method: 'POST' })).status, 400);
  assert.equal((await request('/mcp', { method: 'POST', headers: { Origin: 'https://hostile.example' } })).status, 403);
  assert.equal((await request('/oauth/register', { method: 'POST', body: 'x'.repeat(70_000) })).status, 413);
  assert.equal((await miniflare.dispatchFetch('https://hostile.example/mcp', { method: 'POST' })).status, 403);
  assert.doesNotMatch(script, /Application Support\/LifeOS|\/api\/state|DEFAULT_STORE_PATH|readStore|node:fs|lifeos\.json/);
});

test('private Worker exposes no task data publicly, supports owner-scoped D1 lifecycle, and denies read-only writes', async t => {
  const { request, miniflare } = await fixture(t, { privateStore: true });
  const health = await (await request('/')).json();
  assert.ok(!('taskCount' in health)); assert.equal(health.access, 'authenticated');
  const metadata = await (await request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.deepEqual(metadata.scopes_supported, ['tasks:read', 'tasks:write']);
  for (const headers of [{}, { Authorization: 'Bearer invalid' }, { 'X-User-Id': `github-${OWNER}` }]) {
    const response = await request('/mcp', { method: 'POST', headers, body: '{}' });
    assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /Private fixture marker|Disposable fixture/);
  }
  async function client(accessToken) {
    const c = new Client({ name: 'private-fixture-client', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      fetch: (url, init) => miniflare.dispatchFetch(String(url), init),
    }));
    t.after(() => c.close()); return c;
  }
  const readonly = await client(await token(request, { refresh: true }));
  const denied = await readonly.callTool({ name: 'create_task', arguments: { title: 'denied' } });
  assert.equal(denied.isError, true); assert.match(denied._meta['mcp/www_authenticate'][0], /oauth-protected-resource\/mcp/);
  const c = await client(await token(request, { scope: 'tasks:read tasks:write', refresh: true }));
  assert.deepEqual((await c.listTools()).tools.map(t => t.name).sort(), ['complete_task', 'create_task', 'edit_task', 'get_task', 'list_tasks', 'restore_task', 'search_tasks', 'trash_task']);
  async function call(name, args) { const response = await c.callTool({ name, arguments: args }); assert.ok(!response.isError, response.content?.[0]?.text); return response.structuredContent; }
  const created = await call('create_task', { title: 'Disposable fixture', notes: 'Private fixture marker\nSecond line', tags: ['One', 'one'] });
  const child = await call('create_task', { title: 'Fixture child', parentTaskId: created.task.id });
  await call('edit_task', { taskId: created.task.id, notes: 'Changed\nfixture notes', ifUpdatedAt: created.task.updatedAt });
  const stale = await c.callTool({ name: 'edit_task', arguments: { taskId: created.task.id, title: 'stale', ifUpdatedAt: created.task.updatedAt } });
  assert.equal(stale.isError, true);
  assert.equal((await call('complete_task', { taskId: created.task.id })).affectedCount, 2);
  assert.equal((await call('trash_task', { taskId: created.task.id })).trashedCount, 2);
  assert.equal((await call('list_tasks', { scope: 'trash' })).total, 2);
  assert.equal((await call('restore_task', { taskId: child.task.id })).restoredCount, 2);
  assert.equal((await call('get_task', { taskId: created.task.id })).task.notes, 'Changed\nfixture notes');
  const db = await miniflare.getD1Database('TASKS_DB');
  const stored = JSON.parse((await db.prepare('SELECT document FROM lifeos_tasks WHERE id=1').first()).document);
  assert.equal(stored.items.length, 2); assert.equal(stored.items[0].id, created.task.id);
  assert.ok(!stored.projects && !stored.reading);
  assert.equal(await (await request('/')).text().then(v => v.includes('Changed')), false);
});

test('Worker owner OAuth + PKCE serves only synthetic read tools through official MCP client', async (t) => {
  const { request, miniflare } = await fixture(t);
  const accessToken = await token(request);
  const client = new Client({ name: 'worker-fixture', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetch: (url, init) => miniflare.dispatchFetch(String(url), { ...init, redirect: 'manual' }),
  }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['get_task', 'list_tasks', 'search_tasks']);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && tool._meta.securitySchemes[0].scopes[0] === 'tasks:read'));
  const list = (await client.callTool({ name: 'list_tasks', arguments: {} })).structuredContent;
  assert.equal(list.dataset, 'synthetic-demo'); assert.equal(list.total, 2);
  assert.ok(list.tasks.every((task) => task.id.startsWith('demo-') && !Object.hasOwn(task, 'notes')));
  const detail = (await client.callTool({ name: 'get_task', arguments: { taskId: 'demo-mcp-check' } })).structuredContent;
  assert.equal(detail.descendantCount, 1); assert.match(detail.task.notes, /\n/);
  const search = (await client.callTool({ name: 'search_tasks', arguments: { query: 'Prepare' } })).structuredContent;
  assert.equal(search.tasks[0].id, 'demo-mcp-finished');
  const due = (await client.callTool({ name: 'list_tasks', arguments: { dueThrough: '2026-10-10' } })).structuredContent;
  assert.equal(due.total, 1);
  const missing = await client.callTool({ name: 'get_task', arguments: { taskId: 'personal-task-does-not-exist' } });
  assert.equal(missing.isError, true);
  const noWrite = await client.callTool({ name: 'trash_task', arguments: { taskId: 'demo-mcp-check' } }).catch((error) => error);
  assert.ok(noWrite instanceof Error || noWrite.isError);
});

test('Worker denies another GitHub owner and refuses broader upstream grants', async (t) => {
  for (const options of [{ owner: '54321' }, { upstreamScopes: 'repo' }]) {
    const { request } = await fixture(t, options);
    const { callback } = await authorize(request);
    const location = new URL(callback.headers.get('location'));
    assert.equal(location.searchParams.get('error'), 'access_denied');
    assert.ok(!location.searchParams.has('code'));
  }
});

test('Worker consent escapes client content and rejects CSRF, stale handles, write scopes and wrong audiences', async (t) => {
  const { request } = await fixture(t);
  const start = await consent(request);
  assert.equal(start.page.status, 200, start.html);
  assert.ok(start.html.includes('&#60;Test client&#62;'));
  assert.equal(start.page.headers.get('x-frame-options'), 'DENY');
  assert.match(start.page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(start.page.headers.get('set-cookie'), /Secure.*HttpOnly|HttpOnly.*Secure/);
  const body = new URLSearchParams({ handle: start.handle, decision: 'approve', scope: 'tasks:read' });
  assert.equal((await request('/authorize', { method: 'POST', headers: { Origin: ORIGIN }, body })).status, 400);
  assert.equal((await request('/authorize', { method: 'POST', headers: { Cookie: start.cookies, Origin: 'https://hostile.example' }, body })).status, 403);
  const denied = await request('/authorize', { method: 'POST', headers: { Cookie: start.cookies, Origin: ORIGIN },
    body: new URLSearchParams({ handle: start.handle, decision: 'deny' }) });
  assert.equal(denied.status, 302);
  assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'), 'access_denied');
  assert.equal((await request('/authorize', { method: 'POST', headers: { Cookie: start.cookies, Origin: ORIGIN }, body })).status, 400);
  assert.equal((await consent(request, { scope: 'tasks:write' })).page.status, 400);
  const wrongResource = (await consent(request, { resource: 'https://other.example/mcp' })).page;
  assert.ok([400, 302].includes(wrongResource.status));
  if (wrongResource.status === 302) assert.equal(new URL(wrongResource.headers.get('location')).searchParams.get('error'), 'invalid_target');
  assert.equal((await request('/callback?state=stolen&code=synthetic-code')).status, 400);
});
