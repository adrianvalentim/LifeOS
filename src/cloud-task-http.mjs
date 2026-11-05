// Desktop transport to the LifeOS Worker's device API: plain HTTPS calls with
// a device key held in the macOS Keychain. It implements the same repository
// contract as the Wrangler transport (read / compareAndSwap), without starting
// a CLI process for every query. The Worker stores only the key's SHA-256.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const DEVICE_KEY_SERVICE = 'lifeos-cloud-device';
const KEY_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const SAFE_ERROR = /^(Task |A task |Cloud tasks |Device |Request too large|Send )/;
const cachedKeys = new Map();

export const generateDeviceKey = () => randomBytes(32).toString('base64url');
export const deviceKeyHash = key => createHash('sha256').update(key).digest('hex');

function keychainArgs(service, account) {
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(service) || !/^[A-Za-z0-9._-]{1,100}$/.test(account)) throw new Error('Device key names are invalid.');
  return ['-s', service, '-a', account];
}

export async function readDeviceKey({ service = DEVICE_KEY_SERVICE, account }) {
  const cacheKey = `${service}\n${account}`;
  if (cachedKeys.has(cacheKey)) return cachedKeys.get(cacheKey);
  let stdout;
  try { ({ stdout } = await run('/usr/bin/security', ['find-generic-password', ...keychainArgs(service, account), '-w'], { timeout: 5000 })); }
  catch { throw new Error('Device key is missing from the Keychain. Pair this Mac with the LifeOS cloud again.'); }
  const key = stdout.trim();
  if (!KEY_PATTERN.test(key)) throw new Error('Device key in the Keychain is invalid. Pair this Mac with the LifeOS cloud again.');
  cachedKeys.set(cacheKey, key);
  return key;
}

// Writes through `security -i` on stdin, so the key never appears in a
// process's command line.
export async function storeDeviceKey(key, { service = DEVICE_KEY_SERVICE, account }) {
  if (!KEY_PATTERN.test(key)) throw new Error('Device key is invalid.');
  keychainArgs(service, account);
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('exit', code => (code === 0 && !errors.trim() ? resolve() : reject(new Error('The Keychain refused the device key.'))));
    child.stdin.end(`add-generic-password -U -s ${service} -a ${account} -l "LifeOS cloud device key" -w ${key}\n`);
  });
  cachedKeys.delete(`${service}\n${account}`);
}

export function createHttpTaskRepository({ origin, key, fetchImpl = globalThis.fetch, timeoutMs = 4000 }) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.origin !== origin) throw new Error('The LifeOS cloud origin must be a canonical HTTPS origin.');
  async function call(path, body) {
    const response = await fetchImpl(new URL(path, base).href, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${await key()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* reported below */ }
    if (!response.ok || !payload) {
      const error = new Error(SAFE_ERROR.test(payload?.error || '') ? payload.error : `LifeOS cloud request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }
  return {
    async read() { return (await call('/device/v1/tasks')).row; },
    async compareAndSwap(revision, document) { return (await call('/device/v1/tasks/swap', { revision, document })).revision ?? null; },
    async importTasks(revision, document, expectedRevision = null) { return (await call('/device/v1/tasks/import', { revision, document, expectedRevision })).revision; },
    async status() { return call('/device/v1/status'); },
  };
}
