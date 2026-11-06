import { readFile } from 'node:fs/promises';

const TASK_SOURCES = new Set(['cloudflare-d1', 'cloudflare-do']);
export const taskAuthorityPath = storePath => `${storePath}.task-authority.json`;
export async function readTaskAuthority(storePath) {
  let raw;
  try { raw = await readFile(taskAuthorityPath(storePath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const record = JSON.parse(raw);
  if (!TASK_SOURCES.has(record.source) || !['pending', 'active'].includes(record.phase)
    || typeof record.taskDigest !== 'string' || new URL(record.origin).protocol !== 'https:') throw new Error('Task authority record is invalid; local task writes are blocked.');
  // cloudflare-d1: the first cloud store, reached through Wrangler's admin credentials.
  // cloudflare-do: the LifeOS account's Durable Object, reached over HTTPS with a Keychain device key.
  const connected = record.source === 'cloudflare-do'
    ? record.accountId && record.keychainService && new URL(record.origin).origin === record.origin
    : record.configFile && record.workspaceRoot && record.databaseId && record.accountId;
  if (record.mode === 'online' && !connected) throw new Error('Online task authority needs its approved private connection.');
  if (record.source === 'cloudflare-do' && (record.mode !== 'online' || record.phase !== 'active')) throw new Error('Task authority record is invalid; local task writes are blocked.');
  return record;
}

export async function assertLocalTaskWrite(storePath, candidateTasks) {
  const authority = await readTaskAuthority(storePath);
  if (!authority) return;
  if (authority.mode === 'online' && authority.phase === 'active') throw new Error('Cloud task storage requires a validated store transaction; direct snapshot writes are blocked.');
  const current = JSON.parse(await readFile(storePath, 'utf8'));
  if (JSON.stringify(current.tasks) !== JSON.stringify(candidateTasks)) {
    throw new Error('Task authority is now Cloudflare. Local tasks are an archive; use Mercury or the cloud task CLI.');
  }
}
