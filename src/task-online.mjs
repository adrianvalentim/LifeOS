// One cloud task authority, with a local projection and recoverable local
// transactions. Projects, reading and time records never leave this machine.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateTaskDocument } from './cloud-task-service.mjs';
import { createWranglerTaskConnection } from './cloud-task-repository.mjs';

const repositories = new AsyncLocalStorage();
// Allows an embedded/fixture caller to supply the same repository contract,
// without writing credentials or changing process-wide production state.
export const withTaskRepository = (storePath, repository, callback) => repositories.run({ storePath: path.resolve(storePath), repository }, callback);
export async function taskRepositoryFor(storePath, authority) {
  const supplied = repositories.getStore();
  if (supplied?.storePath === path.resolve(storePath)) return supplied.repository;
  return (await createWranglerTaskConnection({ configFile: authority.configFile, workspaceRoot: authority.workspaceRoot,
    expectedOrigin: authority.origin, expectedDatabaseId: authority.databaseId, expectedAccountId: authority.accountId })).repository;
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pendingPath = storePath => `${storePath}.task-pending.json`;
async function atomicPrivateJson(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value)+'\n', { mode: 0o600, flag: 'wx' }); await rename(temporary, target); }
  finally { await unlink(temporary).catch(() => undefined); }
}
async function pending(storePath) {
  try { return JSON.parse(await readFile(pendingPath(storePath), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const offline = () => new Error('Cloud tasks are offline. Cached tasks remain readable; reconnect before editing tasks.');

export function createOnlineTaskCoordinator({ storePath, repository, readLocal, writeLocal, validateLocal }) {
  function validRow(row) {
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Cloud task store is not initialized.');
    validateTaskDocument(row.document);
    if (row.document.phase !== 'active') throw new Error('Cloud task store is not active.');
    return row;
  }
  function project(store, document) {
    const copy = structuredClone(store);
    copy.tasks.items = structuredClone(document.items);
    // The local clock/settings remain local. Remote task scheduling uses its
    // documented timezone; changing local settings updates it on a later save.
    validateLocal(copy);
    return copy;
  }
  async function persist(store) {
    const current = await readLocal();
    if (!equal(current, store)) await writeLocal(store);
    return store;
  }
  async function recover(row) {
    const journal = await pending(storePath);
    if (!journal) return row;
    if (journal.version !== 1 || !Number.isSafeInteger(journal.baseRevision)
      || typeof journal.commitId !== 'string' || journal.storeHash !== hash(journal.store)) throw new Error('Pending task transaction is invalid; inspect it before editing.');
    validateLocal(journal.store); validateTaskDocument(journal.document);
    if (!equal(journal.store.tasks.items, journal.document.items) || journal.document.lastDesktopCommit !== journal.commitId) throw new Error('Pending task transaction does not match its local records.');
    const local = await readLocal();
    // All supported writers hold the same lock. Detect any out-of-band change
    // rather than replacing unrelated personal records during recovery.
    if (hash(local) !== journal.beforeHash && hash(local) !== journal.storeHash) throw new Error('Local records changed during an interrupted cloud save; reconcile the private journal first.');
    if (row.document.lastDesktopCommit !== journal.commitId && row.revision === journal.baseRevision) {
      const revision = await repository.compareAndSwap(journal.baseRevision, journal.document);
      if (revision !== null) row = { revision, document: journal.document };
      else row = validRow(await repository.read());
    }
    if (row.document.lastDesktopCommit !== journal.commitId) {
      await unlink(pendingPath(storePath));
      throw new Error('An interrupted task save conflicted with a cloud edit and was not applied. Read again before retrying.');
    }
    await persist(project(journal.store, row.document));
    await unlink(pendingPath(storePath));
    return row;
  }
  async function read() {
    let row;
    try { row = await repository.read(); }
    catch { return { store: await readLocal(), online: false, pending: Boolean(await pending(storePath)) }; }
    row = await recover(validRow(row));
    return { store: await persist(project(await readLocal(), row.document)), online: true, revision: row.revision };
  }
  async function mutate(mutator) {
    let row;
    try { row = await repository.read(); }
    catch {
      if (await pending(storePath)) throw new Error('A cloud save is awaiting recovery. Reconnect before changing local records.');
      const before = await readLocal(), store = structuredClone(before), result = await mutator(store);
      validateLocal(store);
      if (!equal(before.tasks, store.tasks)) throw offline();
      return { result, store: await persist(store), online: false };
    }
    row = await recover(validRow(row));
    const before = await readLocal(), base = project(before, row.document), store = structuredClone(base);
    const result = await mutator(store);
    validateLocal(store);
    for (const task of base.tasks.items) {
      const next = store.tasks.items.find(t => t.id === task.id);
      const cached = before.tasks.items.find(t => t.id === task.id);
      if (cached && !equal(task, next) && !equal(cached, task)) throw new Error('A task changed since its local snapshot. Refresh tasks before retrying this edit.');
    }
    const document = validateTaskDocument({ ...row.document, timezone: store.meta.timezone,
      projectIds: store.projects.map(p => p.id), items: structuredClone(store.tasks.items) });
    if (row.document.items.some(t => !document.items.some(next => next.id === t.id))) throw new Error('Cloud tasks use recoverable Trash. Permanent task removal is unavailable.');
    if (equal(document, row.document)) return { result, store: await persist(store), online: true, revision: row.revision };
    const commitId = randomUUID(); document.lastDesktopCommit = commitId;
    await atomicPrivateJson(pendingPath(storePath), { version: 1, commitId, baseRevision: row.revision,
      beforeHash: hash(before), storeHash: hash(store), store, document });
    let revision;
    try { revision = await repository.compareAndSwap(row.revision, document); }
    catch { throw new Error('Cloud task save could not be confirmed. Its private journal is preserved; reconnect to recover before retrying.'); }
    if (revision === null) {
      await unlink(pendingPath(storePath));
      throw new Error('Tasks changed in the cloud during this save. Read again before retrying; no local changes were applied.');
    }
    await persist(store); // Journal survives a crash or failed local disk write.
    await unlink(pendingPath(storePath));
    return { result, store, online: true, revision };
  }
  return { read, mutate };
}
