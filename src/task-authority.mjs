import { readFile } from 'node:fs/promises';

export const taskAuthorityPath = storePath => `${storePath}.task-authority.json`;
export async function readTaskAuthority(storePath) {
  let raw;
  try { raw = await readFile(taskAuthorityPath(storePath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const record = JSON.parse(raw);
  if (record.source !== 'cloudflare-d1' || !['pending', 'active'].includes(record.phase)
    || typeof record.taskDigest !== 'string' || new URL(record.origin).protocol !== 'https:') throw new Error('Task authority record is invalid; local task writes are blocked.');
  if (record.mode === 'online' && (!record.configFile || !record.workspaceRoot || !record.databaseId || !record.accountId)) throw new Error('Online task authority needs its approved private connection.');
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
