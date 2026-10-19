import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { acquireStoreLock, readStore, ROOT_DIR } from './lifeos-data.mjs';
import { taskDocumentFromStore } from './cloud-task-service.mjs';
import { readTaskAuthority, taskAuthorityPath } from './task-authority.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function requirePrivateArtifacts(directory) {
  if (!path.isAbsolute(directory)) throw new Error('An absolute private artifact directory is required.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolved = await realpath(directory);
  if (resolved === ROOT_DIR || resolved.startsWith(`${ROOT_DIR}${path.sep}`)) throw new Error('Private artifacts must be outside Git.');
  if ((await stat(resolved)).mode & 0o077) throw new Error('Private artifact directory must be mode 0700.');
  return resolved;
}
export async function prepareTaskCutover({ storePath, artifactDir, origin }) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('A canonical HTTPS task origin is required.');
  const directory = await requirePrivateArtifacts(artifactDir);
  const release = await acquireStoreLock(storePath);
  try {
    if (await readTaskAuthority(storePath)) throw new Error('Task cutover is already prepared; inspect its authority record.');
    const raw = await readFile(storePath);
    const store = await readStore(storePath, { initialize: false });
    const document = taskDocumentFromStore(store);
    const backupPath = path.join(directory, 'lifeos-pre-cutover.json');
    await writeFile(backupPath, raw, { mode: 0o600, flag: 'wx' });
    if (digest(await readFile(backupPath)) !== digest(raw)) throw new Error('Backup verification failed.');
    const manifest = { version: 1, storePath: await realpath(storePath), origin,
      preparedAt: new Date().toISOString(), backupPath, backupSha256: digest(raw),
      taskDigest: digest(JSON.stringify(store.tasks)), documentDigest: digest(JSON.stringify(document)), taskCount: document.items.length,
      documentPath: path.join(directory, 'private-tasks.json') };
    await writeFile(manifest.documentPath, JSON.stringify(document), { mode: 0o600, flag: 'wx' });
    await writeFile(path.join(directory, 'cutover.json'), JSON.stringify(manifest, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
    return manifest;
  } finally { await release(); }
}
export async function verifyCutoverManifest(manifest) {
  if (manifest.version !== 1 || digest(await readFile(manifest.backupPath)) !== manifest.backupSha256
    || digest(await readFile(manifest.documentPath)) !== manifest.documentDigest) throw new Error('Task backup or import artifact changed.');
  const store = await readStore(manifest.storePath, { initialize: false });
  if (digest(JSON.stringify(store.tasks)) !== manifest.taskDigest) throw new Error('Local tasks changed after backup. Prepare a fresh cutover; do not overwrite those edits.');
  return JSON.parse(await readFile(manifest.documentPath, 'utf8'));
}
export async function fenceTaskCutover(manifest, connection = {}) {
  const release = await acquireStoreLock(manifest.storePath);
  try {
    await verifyCutoverManifest(manifest);
    const existing = await readTaskAuthority(manifest.storePath);
    if (existing) {
      if (existing.taskDigest !== manifest.taskDigest || existing.origin !== manifest.origin || existing.configFile !== connection.configFile
        || existing.databaseId !== connection.databaseId) throw new Error('A different task cutover exists.');
      return existing;
    }
    if (connection.mode !== 'online' || !path.isAbsolute(connection.configFile || '') || !path.isAbsolute(connection.workspaceRoot || '')
      || !connection.databaseId || !connection.accountId) throw new Error('Online task cutover requires the approved private desktop connection.');
    const authority = { ...connection, source: 'cloudflare-d1', phase: 'pending', origin: manifest.origin,
      taskDigest: manifest.taskDigest, backupPath: manifest.backupPath, fencedAt: new Date().toISOString() };
    await writeFile(taskAuthorityPath(manifest.storePath), JSON.stringify(authority, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
    return authority;
  } finally { await release(); }
}
export async function markTaskCutoverActive(manifest, revision) {
  const release = await acquireStoreLock(manifest.storePath);
  try {
    await verifyCutoverManifest(manifest);
    const record = await readTaskAuthority(manifest.storePath);
    if (!record || record.mode !== 'online' || record.taskDigest !== manifest.taskDigest || record.origin !== manifest.origin) throw new Error('Matching online local task fence is required.');
    const target = taskAuthorityPath(manifest.storePath), temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...record, phase: 'active', revision, activatedAt: new Date().toISOString() }, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally { await release(); }
}
