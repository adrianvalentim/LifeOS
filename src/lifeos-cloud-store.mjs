// LifeOS's cloud store: one SQLite-backed Durable Object for the owner, behind
// the LifeOS Worker. It keeps the shared task document with the same read /
// compare-and-swap contract the desktop and MCP service already use. A Durable
// Object handles one request at a time, so a swap needs no lock or retry loop,
// and the store has Cloudflare's 30-day point-in-time recovery.
//
// The Mac reaches it over HTTPS with a device key (`/device/v1/...`); ChatGPT
// and other MCP clients reach the same object through the owner OAuth boundary.
import { DurableObject } from 'cloudflare:workers';
import { validateTaskDocument } from './cloud-task-service.mjs';

const OWNER_STORE = 'owner';
const MAX_DEVICE_BODY_BYTES = 2 * 1024 * 1024;
const DEVICE_KEY = /^Bearer ([A-Za-z0-9_-]{43,128})$/;
const SAFE_ERROR = /^(Task |A task |Cloud tasks |Device )/;

export class LifeOSStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS task_document (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      document TEXT NOT NULL
    )`);
  }

  readTasks() {
    const row = this.sql.exec('SELECT revision, document FROM task_document WHERE id = 1').toArray()[0];
    return row ? { revision: row.revision, document: JSON.parse(row.document) } : null;
  }

  // Replaces the document only if nobody saved since `revision` was read.
  compareAndSwapTasks(revision, document) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Task revision is invalid.');
    validateTaskDocument(document);
    if (document.phase !== 'active') throw new Error('Task document must stay active.');
    const [row] = this.sql.exec('UPDATE task_document SET document = ?, revision = revision + 1 WHERE id = 1 AND revision = ? RETURNING revision',
      JSON.stringify(document), revision).toArray();
    return row?.revision ?? null;
  }

  // Seeds the store when it moves here. Without `expectedRevision` it only
  // fills an empty store (repeating the same import is harmless); with one, it
  // replaces exactly that revision, so a retried move never overwrites newer work.
  importTasks(revision, document, expectedRevision = null) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Task revision is invalid.');
    validateTaskDocument(document);
    if (document.phase !== 'active') throw new Error('Task document must be active to import.');
    const existing = this.readTasks();
    const serialized = JSON.stringify(document);
    if (!existing) {
      if (expectedRevision !== null) throw new Error('Cloud tasks changed before this import. Read again before retrying.');
      this.sql.exec('INSERT INTO task_document (id, revision, document) VALUES (1, ?, ?)', revision, serialized);
      return revision;
    }
    if (expectedRevision === null) {
      if (existing.revision === revision && JSON.stringify(existing.document) === serialized) return revision;
      throw new Error('Cloud tasks already exist here. Import again with their current revision to replace them.');
    }
    if (existing.revision !== expectedRevision) throw new Error('Cloud tasks changed before this import. Read again before retrying.');
    if (revision <= existing.revision) throw new Error('Task revision must move forward when replacing cloud tasks.');
    this.sql.exec('UPDATE task_document SET document = ?, revision = ? WHERE id = 1', serialized, revision);
    return revision;
  }

  taskStatus() {
    const row = this.readTasks();
    return { initialized: Boolean(row), tasks: row?.document.items.length ?? null, phase: row?.document.phase ?? null, revision: row?.revision ?? null };
  }
}

function ownerStore(env) {
  return env.LIFEOS_STORE.get(env.LIFEOS_STORE.idFromName(OWNER_STORE));
}

// The repository contract shared with D1 and the desktop transport.
export function durableTaskRepository(env) {
  const store = ownerStore(env);
  return {
    read: () => store.readTasks(),
    compareAndSwap: (revision, document) => store.compareAndSwapTasks(revision, document),
  };
}

const json = (value, status = 200, headers = {}) => Response.json(value, { status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

function hexBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

// The Worker keeps only the key's SHA-256, so its secrets never reveal the key.
async function deviceAuthorized(header, expectedHex) {
  const key = DEVICE_KEY.exec(header || '')?.[1];
  if (!key) return false;
  const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  const expected = hexBytes(expectedHex);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_DEVICE_BODY_BYTES) return { tooLarge: true };
  if (!request.body) return { value: null };
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_DEVICE_BODY_BYTES) { await reader.cancel(); return { tooLarge: true }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { invalid: true }; }
}

// Device API for the owner's Mac. Browsers cannot call it (no CORS, and any
// Origin header is refused); every route needs the device key.
export async function handleDeviceRequest(request, env) {
  if (request.headers.has('origin')) return json({ error: 'Browsers cannot use the device API.' }, 403);
  if (!/^[0-9a-f]{64}$/.test(env.DEVICE_KEY_SHA256 || '')) return json({ error: 'Device access is not configured.' }, 503);
  if (!await deviceAuthorized(request.headers.get('authorization'), env.DEVICE_KEY_SHA256)) {
    return json({ error: 'Device key required.' }, 401, { 'WWW-Authenticate': 'Bearer realm="lifeos-device"' });
  }
  const url = new URL(request.url);
  if (url.search) return json({ error: 'Query parameters are not supported.' }, 400);
  const route = `${request.method} ${url.pathname}`;
  const store = ownerStore(env);
  try {
    if (route === 'GET /device/v1/tasks') return json({ row: await store.readTasks() });
    if (route === 'GET /device/v1/status') return json(await store.taskStatus());
    if (route === 'POST /device/v1/tasks/swap' || route === 'POST /device/v1/tasks/import') {
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
      const body = await readBody(request);
      if (body.tooLarge) return json({ error: 'Request too large.' }, 413);
      if (body.invalid || !body.value || typeof body.value !== 'object') return json({ error: 'Send a JSON object.' }, 400);
      const { revision, document, expectedRevision = null } = body.value;
      if (route.endsWith('/swap')) return json({ revision: await store.compareAndSwapTasks(revision, document) });
      return json({ revision: await store.importTasks(revision, document, expectedRevision) });
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    const message = String(error?.message || '');
    if (SAFE_ERROR.test(message)) return json({ error: message }, /already exist|changed before/.test(message) ? 409 : 400);
    return json({ error: 'LifeOS cloud store request failed.' }, 500);
  }
}

// Routes device calls to the store and everything else (OAuth, MCP, health)
// to the owner OAuth boundary. Both answer only on the configured origin.
export function createLifeOSWorker({ mcp }) {
  return {
    async fetch(request, env, ctx) {
      let origin;
      try { origin = new URL(env.MCP_ORIGIN).origin; } catch { return json({ error: 'Canonical HTTPS deployment is not configured.' }, 503); }
      const url = new URL(request.url);
      if (url.pathname === '/device' || url.pathname.startsWith('/device/')) {
        if (url.origin !== origin || !origin.startsWith('https://')) return json({ error: 'Invalid Host.' }, 403);
        return handleDeviceRequest(request, env);
      }
      return mcp.fetch(request, env, ctx);
    },
  };
}
