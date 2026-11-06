// Moves the shared task document, once, from the first cloud store (D1 on the
// main Cloudflare account) to the LifeOS account's Durable Object. It runs
// under the store lock, so no local writer interleaves:
//
// 1. back up the local store and authority record (private, verified);
// 2. fence D1 by swapping its document to `staged`: the old Worker (ChatGPT)
//    and the Wrangler path stop reading and writing it;
// 3. import the same document into the Durable Object at the fenced revision,
//    read it back and compare;
// 4. atomically point the local authority at the Durable Object.
//
// Any failure after the fence re-opens D1, so tasks always have one writable
// home. Nothing is deleted: the D1 row stays fenced for rollback.
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { acquireStoreLock } from './lifeos-data.mjs';
import { validateTaskDocument } from './cloud-task-service.mjs';
import { readTaskAuthority, taskAuthorityPath } from './task-authority.mjs';
import { digest, requirePrivateArtifacts } from './task-cutover.mjs';

const same = (a, b) => digest(JSON.stringify(a)) === digest(JSON.stringify(b));

async function writePrivate(file, contents) {
  await writeFile(file, contents, { mode: 0o600, flag: 'wx' });
  if (digest(await readFile(file)) !== digest(contents)) throw new Error('Task move backup verification failed.');
}

async function atomicPrivateJson(target, value) {
  const temporary = `${target}.${process.pid}.move.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => undefined); }
}

export async function moveTasksToDurableStore({ storePath, artifactDir, from, to, target, now = new Date() }) {
  if (!target?.origin || new URL(target.origin).origin !== target.origin || !target.origin.startsWith('https://')
    || !target.accountId || !target.keychainService) throw new Error('Task move needs the approved LifeOS cloud destination.');
  const directory = await requirePrivateArtifacts(artifactDir);
  const release = await acquireStoreLock(storePath);
  let fenced = null;
  try {
    const authority = await readTaskAuthority(storePath);
    if (authority?.source === 'cloudflare-do') throw new Error('Tasks already live in the LifeOS cloud store.');
    if (!authority || authority.mode !== 'online' || authority.phase !== 'active' || authority.source !== 'cloudflare-d1') {
      throw new Error('Tasks can move only from the active D1 cloud store.');
    }
    if (await stat(`${storePath}.task-pending.json`).catch(() => null)) {
      throw new Error('A cloud task save is awaiting recovery. Open LifeOS online to finish it before moving tasks.');
    }

    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(directory, `lifeos-before-move-${stamp}.json`);
    await writePrivate(backupPath, await readFile(storePath));
    await writePrivate(path.join(directory, `task-authority-before-move-${stamp}.json`), await readFile(taskAuthorityPath(storePath)));

    const row = await from.read();
    if (!row) throw new Error('Cloud tasks (D1) are not initialized. Nothing moved.');
    validateTaskDocument(row.document);
    if (row.document.phase !== 'active') throw new Error('Cloud tasks (D1) are not active. Nothing moved; inspect them first.');
    await writePrivate(path.join(directory, `d1-tasks-${stamp}.json`), JSON.stringify(row));

    const staged = { ...structuredClone(row.document), phase: 'staged' };
    const fencedRevision = await from.compareAndSwap(row.revision, staged);
    if (fencedRevision == null) throw new Error('Cloud tasks changed during the move. Nothing moved; try again.');
    fenced = { revision: fencedRevision, document: staged };

    const document = structuredClone(row.document);
    const existing = await to.read();
    if (!existing) await to.importTasks(fencedRevision, document);
    else if (existing.revision === fencedRevision && same(existing.document, document)) { /* an identical earlier import */ }
    else if (existing.revision < fencedRevision) await to.importTasks(fencedRevision, document, existing.revision);
    else throw new Error('Cloud tasks in the LifeOS store are newer than D1. Nothing moved; inspect both before retrying.');

    const copied = await to.read();
    if (!copied || copied.revision !== fencedRevision || !same(copied.document, document)) {
      throw new Error('Cloud tasks could not be verified after copying them to the LifeOS store.');
    }

    await atomicPrivateJson(taskAuthorityPath(storePath), {
      mode: 'online', source: 'cloudflare-do', phase: 'active',
      origin: target.origin, accountId: target.accountId, keychainService: target.keychainService,
      taskDigest: digest(JSON.stringify(document.items)), revision: fencedRevision,
      movedAt: now.toISOString(), backupPath,
      previous: { source: authority.source, origin: authority.origin, accountId: authority.accountId, databaseId: authority.databaseId,
        configFile: authority.configFile, workspaceRoot: authority.workspaceRoot, fencedRevision },
    });
    fenced = null;
    return { tasks: document.items.length, revision: fencedRevision, backupPath };
  } catch (error) {
    if (fenced) {
      const reopened = await from.compareAndSwap(fenced.revision, { ...fenced.document, phase: 'active' }).catch(() => null);
      error.message += reopened
        ? ' The D1 store was reopened, so tasks stay where they were.'
        : ` The D1 store could not be reopened and stays fenced at revision ${fenced.revision}; inspect it before retrying.`;
    }
    throw error;
  } finally {
    await release();
  }
}
