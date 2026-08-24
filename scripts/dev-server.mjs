#!/usr/bin/env node
import { watch } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_VOICE_CAPABILITY, codexAppServer } from '../src/codex-app-server.mjs';
import { getState, logTime, startSession, stopSession } from '../src/lifeos-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const preferredPort = Number(process.env.PORT || 3000);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const eventClients = new Set();
let dataChangeTimer = null;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/events' && req.method === 'GET') {
      return openEventStream(req, res);
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return sendJson(res, await getState(undefined, { range: url.searchParams.get('range') || 'week' }));
    }
    if (url.pathname === '/api/log' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, (await logTime(body)).state);
    }
    if (url.pathname === '/api/session/start' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, (await startSession(body)).state);
    }
    if (url.pathname === '/api/session/stop' && req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, (await stopSession(body)).state);
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
    return serveStatic(url.pathname, res);
  } catch (error) {
    const status = error instanceof ClientError ? 400 : 500;
    sendJson(res, { error: error.message }, status);
  }
});

codexAppServer.subscribe((event) => broadcastEvent('codex', event));

const dataWatcher = watch(dataDir, (_eventType, filename) => {
  if (String(filename || '') !== 'lifeos.json') return;
  clearTimeout(dataChangeTimer);
  dataChangeTimer = setTimeout(() => broadcastEvent('lifeos', { type: 'stateChanged' }), 60);
});

listen(preferredPort);

function listen(port) {
  const onListening = () => {
    server.off('error', onError);
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
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
  const content = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(content);
}

function sendJson(res, payload, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
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

class ClientError extends Error {}

async function shutdown() {
  dataWatcher.close();
  clearTimeout(dataChangeTimer);
  for (const client of eventClients) client.end();
  await codexAppServer.stop().catch(() => undefined);
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
