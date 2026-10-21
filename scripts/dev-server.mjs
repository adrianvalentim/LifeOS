#!/usr/bin/env node
import { appendFileSync, readFileSync, statSync, unlinkSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrCacheReadingBookCover } from '../src/book-cover-cache.mjs';
import { claudeCodeAgent } from '../src/claude-code-agent.mjs';
import { CODEX_VOICE_CAPABILITY, codexAppServer } from '../src/codex-app-server.mjs';
import { CommandError, listCommands, runCommand, serverInfoPath } from '../src/commands/index.mjs';
import { DEFAULT_STORE_PATH, initializeDefaultStore } from '../src/lifeos-storage.mjs';
import { getState, purgeExpiredTaskTrash, readStore } from '../src/lifeos-data.mjs';
import { readHistory } from '../src/lifeos-history.mjs';
import { readWorkspace } from '../src/lifeos-workspace.mjs';
import { openSavedTaskLink } from '../src/task-web-links.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const dataDir = path.dirname(DEFAULT_STORE_PATH);
const storeName = path.basename(DEFAULT_STORE_PATH);
const preferredPort = Number(process.env.PORT || 3000);
const crashLogPath = `${DEFAULT_STORE_PATH}.server.log`;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const eventClients = new Set();
let dataChangeTimer = null;
let historyChangeTimer = null;
let workspaceChangeTimer = null;
let taskTrashCleanupTimer = null;
let presence = null;

// The app window and agents share one channel: UI commands broadcast here, and
// windows report what they show so agents can ask (ui.view).
const uiChannel = {
  send(event) {
    if (!eventClients.size) throw new CommandError('No LifeOS window is open to show this.', { status: 409, code: 'no_window' });
    broadcastEvent('ui', event);
    return { delivered: eventClients.size, ...event };
  },
  presence() {
    return presence ? { open: eventClients.size > 0, ...presence } : { open: eventClients.size > 0 };
  },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) assertLocalHost(req);

    if (url.pathname === '/api/events' && req.method === 'GET') {
      return openEventStream(req, res);
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, await clientState(url.searchParams.get('range') || 'week'));
    }
    if (url.pathname === '/api/commands' && req.method === 'GET') {
      return sendJson(res, {
        commands: listCommands(),
        mcp: { command: 'node', args: [path.join(root, 'scripts', 'lifeos-mcp.mjs')], cwd: root },
      });
    }
    const runMatch = url.pathname.match(/^\/api\/run\/([a-zA-Z.]+)$/);
    if (runMatch && req.method === 'POST') {
      assertJsonPost(req);
      const input = await readJson(req, 1024 * 1024);
      const source = req.headers.origin ? 'app' : String(req.headers['x-lifeos-source'] || 'http');
      const output = await runCommand(runMatch[1], input, {
        source,
        actor: req.headers['x-lifeos-actor'] || null,
        ui: uiChannel,
      });
      const body = { result: output.result, operationId: output.operationId || null, label: output.label || null };
      if (url.searchParams.get('state') === '1') {
        if (output.state) body.state = { ...output.state, workspace: await readWorkspace(), storeMtime: await storeMtime() };
        else if (output.result?.workspace) body.workspace = output.result.workspace;
      }
      return sendJson(res, body);
    }
    if (url.pathname === '/api/ui/presence' && req.method === 'POST') {
      assertJsonPost(req);
      const body = await readJson(req);
      presence = sanitizePresence(body);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 60)));
      return sendJson(res, { entries: await readHistory(DEFAULT_STORE_PATH, { limit }) });
    }
    const readingCoverMatch = url.pathname.match(/^\/api\/reading\/books\/([^/]+)\/cover$/);
    if (readingCoverMatch && req.method === 'GET') {
      return serveReadingBookCover(req, res, decodeURIComponent(readingCoverMatch[1]));
    }
    if (url.pathname === '/api/tasks/open-link' && req.method === 'POST') {
      assertJsonPost(req);
      if (!sameOrigin(req.headers.origin)) {
        res.writeHead(403);
        return res.end('Open links from LifeOS itself.');
      }
      const body = await readJson(req);
      requireString(body.taskId, 'taskId');
      requireString(body.url, 'url');
      return sendJson(res, await openSavedTaskLink({ taskId: body.taskId, url: body.url }));
    }

    if (url.pathname === '/api/codex/bootstrap' && req.method === 'GET') {
      const account = await codexAppServer.account();
      const threads = account.account?.type === 'chatgpt' ? await codexAppServer.listThreads() : [];
      return sendJson(res, {
        connection: { status: 'connected', executable: codexAppServer.executable },
        account,
        threads,
        voice: CODEX_VOICE_CAPABILITY,
        pendingRequests: [...codexAppServer.serverRequests.values()],
      });
    }
    if (url.pathname.startsWith('/api/codex/') && req.method === 'POST') assertJsonPost(req);
    if (url.pathname === '/api/codex/thread/start' && req.method === 'POST') {
      return sendJson(res, { thread: await codexAppServer.startThread() });
    }
    if (url.pathname === '/api/codex/thread/read' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.threadId, 'threadId');
      return sendJson(res, { thread: await codexAppServer.readThread(body.threadId) });
    }
    if (url.pathname === '/api/codex/turn/start' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.threadId, 'threadId');
      requireString(body.message, 'message');
      return sendJson(res, { turn: await codexAppServer.startTurn(body.threadId, body.message) });
    }
    if (url.pathname === '/api/codex/turn/interrupt' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.threadId, 'threadId');
      requireString(body.turnId, 'turnId');
      await codexAppServer.interruptTurn(body.threadId, body.turnId);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/codex/request/respond' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.id === undefined || body.id === null) throw new ClientError('id is required.');
      await codexAppServer.respondToServerRequest(body.id, body.result);
      return sendJson(res, { ok: true });
    }
    // Claude Code: the installed, signed-in `claude` CLI, same shapes as Codex.
    if (url.pathname === '/api/claude/bootstrap' && req.method === 'GET') {
      let executable;
      try {
        executable = claudeCodeAgent.resolveExecutable();
      } catch (error) {
        return sendJson(res, { connection: { status: 'error', detail: error.message }, account: null, threads: [], pendingRequests: [] });
      }
      const account = await claudeCodeAgent.account({ refresh: url.searchParams.get('refresh') === '1' });
      return sendJson(res, {
        connection: { status: 'connected', executable },
        account,
        threads: await claudeCodeAgent.listThreads(),
        pendingRequests: [...claudeCodeAgent.serverRequests.values()].map((entry) => entry.request),
      });
    }
    if (url.pathname.startsWith('/api/claude/') && req.method === 'POST') assertJsonPost(req);
    if (url.pathname === '/api/claude/thread/start' && req.method === 'POST') {
      return sendJson(res, { thread: await claudeCodeAgent.startThread() });
    }
    if (url.pathname === '/api/claude/thread/read' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.threadId, 'threadId');
      return sendJson(res, { thread: await claudeCodeAgent.readThread(body.threadId) });
    }
    if (url.pathname === '/api/claude/turn/start' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.threadId, 'threadId');
      requireString(body.message, 'message');
      return sendJson(res, { turn: await claudeCodeAgent.startTurn(body.threadId, body.message) });
    }
    if (url.pathname === '/api/claude/turn/interrupt' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.threadId, 'threadId');
      await claudeCodeAgent.interruptTurn(body.threadId);
      return sendJson(res, { ok: true });
    }
    if (url.pathname === '/api/claude/request/respond' && req.method === 'POST') {
      const body = await readJson(req);
      requireString(body.id, 'id');
      await claudeCodeAgent.respondToServerRequest(body.id, body.result);
      return sendJson(res, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, { error: 'Not found' }, 404);
    return serveStatic(url.pathname, res);
  } catch (error) {
    const status = error instanceof ClientError ? 400 : error instanceof CommandError ? error.status : error.status || 500;
    if (status >= 500) console.warn(`LifeOS request failed: ${error.stack || error.message}`);
    sendJson(res, { error: error.message, code: error.code || null }, status);
  }
});

codexAppServer.subscribe((event) => broadcastEvent('codex', event));
claudeCodeAgent.subscribe((event) => broadcastEvent('claude', event));

const initialization = await initializeDefaultStore();
if (initialization.created) {
  console.log(`LifeOS personal store initialized at ${initialization.storePath}`);
}
await cleanExpiredTaskTrash();
taskTrashCleanupTimer = setInterval(() => void cleanExpiredTaskTrash(), 60 * 60 * 1000);
taskTrashCleanupTimer.unref?.();
const dataWatcher = watch(dataDir, (_eventType, filename) => {
  const name = String(filename || '');
  if (name === storeName) {
    clearTimeout(dataChangeTimer);
    dataChangeTimer = setTimeout(async () => broadcastEvent('lifeos', { type: 'stateChanged', mtime: await storeMtime() }), 60);
  } else if (name === `${storeName}.history.jsonl`) {
    clearTimeout(historyChangeTimer);
    historyChangeTimer = setTimeout(() => broadcastEvent('history', { type: 'historyChanged' }), 80);
  } else if (name === `${storeName}.workspace.json`) {
    clearTimeout(workspaceChangeTimer);
    workspaceChangeTimer = setTimeout(async () => {
      try { broadcastEvent('workspace', { workspace: await readWorkspace() }); } catch { /* next change retries */ }
    }, 60);
  }
});
// Losing the watcher only stops live refresh; it must not stop the server.
dataWatcher.on('error', (error) => console.warn(`LifeOS stopped watching ${dataDir}: ${error.message}`));

listen(preferredPort);

function listen(port) {
  const onListening = async () => {
    server.off('error', onError);
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    // Lets the CLI, SDK and MCP server forward UI commands to this window.
    await writeFile(serverInfoPath(DEFAULT_STORE_PATH), `${JSON.stringify({
      pid: process.pid, port: actualPort, url: `http://127.0.0.1:${actualPort}`, startedAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 }).catch((error) => console.warn(`LifeOS could not record its address for agents: ${error.message}`));
    console.log(`LifeOS running at http://127.0.0.1:${actualPort}`);
  };
  const onError = (error) => {
    server.off('listening', onListening);
    if (error.code === 'EADDRINUSE' && port < preferredPort + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  };
  server.once('listening', onListening);
  server.once('error', onError);
  server.listen(port, '127.0.0.1');
}

async function clientState(range) {
  const [state, workspace] = await Promise.all([getState(undefined, { range }), readWorkspace()]);
  return { ...state, workspace, storeMtime: await storeMtime() };
}

// Lets a window skip the refetch triggered by its own write.
async function storeMtime() {
  try { return (await stat(DEFAULT_STORE_PATH)).mtimeMs; } catch { return 0; }
}

function sanitizePresence(body) {
  const text = (value, max = 300) => (typeof value === 'string' ? value.slice(0, max) : null);
  return {
    route: text(body.route),
    title: text(body.title, 120),
    list: text(body.list),
    selected: body.selected && typeof body.selected === 'object'
      ? { kind: text(body.selected.kind, 20), id: text(body.selected.id, 200), title: text(body.selected.title, 300) }
      : null,
    multiSelection: Array.isArray(body.multiSelection) ? body.multiSelection.slice(0, 200).map((id) => text(id, 200)) : [],
    at: new Date().toISOString(),
  };
}

function openEventStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);
  eventClients.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    eventClients.delete(res);
  });
}

function broadcastEvent(event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) client.write(message);
}

// Loopback is a boundary only if other origins cannot drive it: refuse foreign
// Host headers (DNS rebinding) and cross-site browser requests (CSRF).
function assertLocalHost(req) {
  const port = server.address()?.port;
  const host = String(req.headers.host || '');
  if (![`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost'].includes(host)) {
    throw Object.assign(new ClientError('LifeOS only answers on its loopback address.'), { status: 403 });
  }
  if (req.headers.origin && !sameOrigin(req.headers.origin)) {
    throw Object.assign(new ClientError('Requests from other sites are refused.'), { status: 403 });
  }
}

function assertJsonPost(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ClientError('Send commands as application/json.');
}

function sameOrigin(origin) {
  const port = server.address()?.port;
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin);
}

async function serveStatic(requestPath, res) {
  const cleanPath = decodeURIComponent(requestPath.split('?')[0]);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const target = path.resolve(publicDir, relativePath);
  const relative = path.relative(publicDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let filePath = target;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (path.extname(relativePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    filePath = path.join(publicDir, 'index.html');
  }

  const ext = path.extname(filePath);
  const content = ext === '.html'
    ? Buffer.from(await withBootContext(await readFile(filePath, 'utf8')))
    : await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  res.end(content);
}

// The build marker is derived from the browser sources actually on disk, so a
// stale page and a current one cannot report the same build. The theme comes
// from the workspace so the first paint already has the right colors.
async function withBootContext(html) {
  const build = await assetBuildStamp();
  let theme = { mode: 'system', accent: null };
  let density = 'comfortable';
  try {
    const workspace = await readWorkspace();
    theme = workspace.theme;
    density = workspace.density;
  } catch { /* defaults */ }
  const accent = theme.accent ? ` data-accent="${theme.accent}"` : '';
  return html
    .replace('<html lang="en">', `<html lang="en" data-theme-mode="${theme.mode}" data-density="${density}"${accent}>`)
    .replace('</head>', `  <meta name="lifeos-build" content="${build}">\n</head>`);
}

async function assetBuildStamp() {
  try {
    const files = await listSourceFiles(publicDir);
    const times = await Promise.all(files.map(async (file) => (await stat(file)).mtimeMs));
    const newest = new Date(Math.max(...times, 0));
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(newest.getMonth() + 1)}${pad(newest.getDate())}.${pad(newest.getHours())}${pad(newest.getMinutes())}`;
  } catch {
    return 'unknown';
  }
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'vendor' && entry.name !== 'fonts') files.push(...await listSourceFiles(full));
    else if (/\.(js|css|html)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function sendJson(res, payload, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function serveReadingBookCover(req, res, bookId) {
  const store = await readStore();
  const book = store.reading.books.find((candidate) => candidate.id === bookId);
  if (!book) return sendNotFound(res);

  let cover;
  try {
    cover = await getOrCacheReadingBookCover(book);
  } catch (error) {
    console.warn(`LifeOS could not cache the cover for ${book.title}: ${error.message}`);
    return sendNotFound(res);
  }
  if (!cover) return sendNotFound(res);
  if (req.headers['if-none-match'] === cover.etag) {
    res.writeHead(304, {
      etag: cover.etag,
      'cache-control': 'private, max-age=31536000, immutable',
    });
    return res.end();
  }
  res.writeHead(200, {
    'content-type': cover.mimeType,
    'content-length': cover.bytes.length,
    'cache-control': 'private, max-age=31536000, immutable',
    etag: cover.etag,
    'cross-origin-resource-policy': 'same-origin',
  });
  res.end(cover.bytes);
}

function sendNotFound(res) {
  res.writeHead(404, { 'cache-control': 'no-store' });
  res.end('Not found');
}

async function readJson(req, limitBytes = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new ClientError('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new ClientError('Request body must be valid JSON.');
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new ClientError(`${name} is required.`);
}

async function cleanExpiredTaskTrash() {
  try {
    const result = await purgeExpiredTaskTrash();
    if (result.purgedCount) {
      console.log(`LifeOS permanently deleted ${result.purgedCount} expired ${result.purgedCount === 1 ? 'task' : 'tasks'} from Trash.`);
      broadcastEvent('lifeos', { type: 'stateChanged' });
    }
  } catch (error) {
    console.warn(`LifeOS could not clean expired task Trash: ${error.message}`);
  }
}

class ClientError extends Error {}

async function shutdown() {
  dataWatcher.close();
  clearTimeout(dataChangeTimer);
  clearTimeout(historyChangeTimer);
  clearTimeout(workspaceChangeTimer);
  clearInterval(taskTrashCleanupTimer);
  for (const client of eventClients) client.end();
  // A refreshed server may already have replaced this record; remove only ours.
  try {
    const info = JSON.parse(await readFile(serverInfoPath(DEFAULT_STORE_PATH), 'utf8'));
    if (info.pid === process.pid) await unlink(serverInfoPath(DEFAULT_STORE_PATH));
  } catch { /* already gone */ }
  await codexAppServer.stop().catch(() => undefined);
  await claudeCodeAgent.stop().catch(() => undefined);
  server.close(() => process.exit(0));
}

// The desktop shell discards server output, so record why the server stopped
// before exiting; the shell then restarts it.
function stopOnFatal(kind, error) {
  const detail = error?.stack || String(error);
  console.error(`LifeOS server stopped (${kind}): ${detail}`);
  try {
    let size = 0;
    try { size = statSync(crashLogPath).size; } catch { /* first entry */ }
    const entry = `${new Date().toISOString()} ${kind} (pid ${process.pid}): ${detail}\n`;
    if (size > 256 * 1024) writeFileSync(crashLogPath, entry, { mode: 0o600 });
    else appendFileSync(crashLogPath, entry, { mode: 0o600 });
  } catch { /* nothing more can be recorded */ }
  try {
    const info = JSON.parse(readFileSync(serverInfoPath(DEFAULT_STORE_PATH), 'utf8'));
    if (info.pid === process.pid) unlinkSync(serverInfoPath(DEFAULT_STORE_PATH));
  } catch { /* already gone */ }
  process.exit(1);
}

process.on('uncaughtException', (error) => stopOnFatal('uncaughtException', error));
process.on('unhandledRejection', (error) => stopOnFatal('unhandledRejection', error));
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
