// The change journal behind Undo and the Activity feed. Every supported write
// made through a command records the exact records it changed (before and
// after) beside the active store. Reverting checks that each record is still
// exactly as the operation left it, so an undo can never overwrite later work.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';

export const operationContext = new AsyncLocalStorage();
export const historyPath = (storePath) => `${storePath}.history.jsonl`;

const MAX_ENTRIES = 400;
const KEEP_ENTRIES = 250;
const COALESCE_MS = 120_000;

// Records keyed by id inside arrays. Order is derived from fields (sortOrder,
// date), never from array position, so a revert may append restored records.
const COLLECTIONS = {
  projects: { get: (s) => s.projects, set: (s, v) => { s.projects = v; } },
  tasks: { get: (s) => s.tasks?.items, set: (s, v) => { s.tasks.items = v; } },
  books: { get: (s) => s.reading?.books, set: (s, v) => { s.reading.books = v; } },
  ideas: { get: (s) => s.creation?.ideas, set: (s, v) => { s.creation.ideas = v; } },
  entries: { get: (s) => s.timeEntries, set: (s, v) => { s.timeEntries = v; } },
  milestones: { get: (s) => s.milestones, set: (s, v) => { s.milestones = v; } },
};
const MAPS = ['domains', 'categories'];
const SINGLETONS = ['settings', 'activeSession', 'challenge', 'meta'];

export function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
const same = (a, b) => stableStringify(a) === stableStringify(b);

export function diffStores(before, after) {
  const patch = {};
  for (const [name, access] of Object.entries(COLLECTIONS)) {
    const previous = access.get(before) || [];
    const next = access.get(after) || [];
    const previousById = new Map(previous.map((record) => [record.id, record]));
    const nextById = new Map(next.map((record) => [record.id, record]));
    const changes = { added: [], removed: [], changed: [] };
    for (const record of next) {
      const old = previousById.get(record.id);
      if (!old) changes.added.push(structuredClone(record));
      else if (!same(old, record)) changes.changed.push({ before: structuredClone(old), after: structuredClone(record) });
    }
    for (const record of previous) {
      if (!nextById.has(record.id)) changes.removed.push(structuredClone(record));
    }
    if (changes.added.length || changes.removed.length || changes.changed.length) patch[name] = changes;
  }
  for (const name of MAPS) {
    const previous = before[name] || {};
    const next = after[name] || {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const changes = {};
    for (const key of keys) {
      if (!same(previous[key], next[key])) changes[key] = { before: previous[key] ?? null, after: next[key] ?? null };
    }
    if (Object.keys(changes).length) patch[name] = changes;
  }
  for (const name of SINGLETONS) {
    const previous = before[name] ?? null;
    const next = after[name] ?? null;
    if (!same(previous, next)) patch[name] = { before: structuredClone(previous), after: structuredClone(next) };
  }
  return Object.keys(patch).length ? patch : null;
}

export class HistoryConflictError extends Error {}

// Applies the inverse of a recorded patch to `store`, in place. When cloud tasks
// are active, removal is unavailable, so an undone task creation moves the new
// task to recoverable Trash instead.
export function revertPatch(store, patch, { now = new Date(), onlineTasks = false } = {}) {
  const conflict = (what) => {
    throw new HistoryConflictError(`${what} changed after this action, so it cannot be undone without overwriting newer work.`);
  };
  const timestamp = now.toISOString();
  for (const [name, access] of Object.entries(COLLECTIONS)) {
    const changes = patch[name];
    if (!changes) continue;
    let records = [...(access.get(store) || [])];
    const index = () => new Map(records.map((record, position) => [record.id, position]));
    let positions = index();
    for (const { before, after } of changes.changed || []) {
      const position = positions.get(after.id);
      if (position === undefined || !same(records[position], after)) conflict(labelFor(name, after));
      records[position] = structuredClone(before);
    }
    for (const added of changes.added || []) {
      const position = positions.get(added.id);
      if (position === undefined) continue; // Already gone; nothing to undo.
      if (!same(records[position], added)) conflict(labelFor(name, added));
      if (name === 'tasks' && onlineTasks) {
        records[position] = { ...records[position], trashedAt: timestamp, updatedAt: timestamp };
      } else {
        records.splice(position, 1);
        positions = index();
      }
    }
    for (const removed of changes.removed || []) {
      if (positions.has(removed.id)) conflict(labelFor(name, removed));
      records.push(structuredClone(removed));
      positions = index();
    }
    access.set(store, records);
  }
  for (const name of MAPS) {
    const changes = patch[name];
    if (!changes) continue;
    store[name] ||= {};
    for (const [key, { before, after }] of Object.entries(changes)) {
      if (!same(store[name][key] ?? null, after)) conflict(`${name === 'domains' ? 'Domain' : 'Category'} ${key}`);
      if (before === null) delete store[name][key];
      else store[name][key] = structuredClone(before);
    }
  }
  for (const name of SINGLETONS) {
    const change = patch[name];
    if (!change) continue;
    if (!same(store[name] ?? null, change.after)) conflict(name === 'activeSession' ? 'The running timer' : `The ${name}`);
    if (name === 'meta') {
      // Keep the current schema marker; restore the user-facing fields.
      store.meta = { ...structuredClone(change.before), schemaVersion: store.meta?.schemaVersion };
    } else store[name] = structuredClone(change.before);
  }
  return store;
}

function labelFor(name, record) {
  const title = record?.title || record?.name || record?.text || record?.description || record?.id;
  const kind = { projects: 'Project', tasks: 'Task', books: 'Book', ideas: 'Idea', entries: 'Time entry', milestones: 'Milestone' }[name];
  return `${kind} “${String(title).slice(0, 60)}”`;
}

export function summarizePatch(patch) {
  if (!patch) return {};
  const counts = {};
  for (const name of Object.keys(COLLECTIONS)) {
    const changes = patch[name];
    if (!changes) continue;
    counts[name] = (changes.added?.length || 0) + (changes.removed?.length || 0) + (changes.changed?.length || 0);
  }
  for (const name of [...MAPS, ...SINGLETONS, 'workspace']) if (patch[name]) counts[name] = 1;
  return counts;
}

// Entity references a patch touched, so the Activity feed can link to them.
export function patchTargets(patch) {
  const targets = [];
  if (!patch) return targets;
  const kinds = { projects: 'project', tasks: 'task', books: 'book', ideas: 'idea', entries: 'entry', milestones: 'milestone' };
  for (const [name, kind] of Object.entries(kinds)) {
    const changes = patch[name];
    if (!changes) continue;
    for (const record of [...(changes.added || []), ...(changes.changed || []).map((change) => change.after), ...(changes.removed || [])]) {
      targets.push({ kind, id: record.id, label: record.title || record.name || record.text || record.description || record.id });
      if (targets.length >= 12) return targets;
    }
  }
  return targets;
}

export async function readHistory(storePath, { limit = 50, includePatch = false } = {}) {
  const entries = await readEntries(storePath);
  const undone = new Map();
  for (const entry of entries) if (entry.kind === 'undo') undone.set(entry.of, entry.by);
  return entries
    .filter((entry) => entry.kind !== 'undo')
    .map((entry) => ({
      ...entry,
      ...(includePatch ? {} : { patch: undefined, counts: summarizePatch(entry.patch), targets: patchTargets(entry.patch) }),
      undoneBy: undone.get(entry.id) || null,
    }))
    .reverse()
    .slice(0, limit);
}

export async function readHistoryEntry(storePath, id) {
  const entries = await readEntries(storePath);
  const entry = entries.find((candidate) => candidate.kind !== 'undo' && candidate.id === id);
  if (!entry) return null;
  const marker = entries.find((candidate) => candidate.kind === 'undo' && candidate.of === id);
  return { ...entry, undoneBy: marker?.by || null };
}

// Caller holds the store lock, so the journal order matches the write order.
export async function appendHistory(storePath, entry) {
  const file = historyPath(storePath);
  const record = { kind: 'op', id: `op_${randomUUID()}`, at: new Date().toISOString(), ...entry };
  if (record.coalesceKey) {
    const entries = await readEntries(storePath);
    const last = entries.at(-1);
    if (last?.kind === 'op' && last.coalesceKey === record.coalesceKey && last.source === record.source
      && Date.now() - new Date(last.at).getTime() < COALESCE_MS) {
      const merged = mergePatches(last.patch, record.patch);
      entries[entries.length - 1] = { ...last, at: record.at, label: record.label, patch: merged };
      await rewrite(file, entries);
      return entries.at(-1);
    }
  }
  await appendFile(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  const entries = await readEntries(storePath);
  if (entries.length > MAX_ENTRIES) await rewrite(file, compact(entries));
  return record;
}

export async function markUndone(storePath, id, by) {
  await appendFile(historyPath(storePath), `${JSON.stringify({ kind: 'undo', of: id, by, at: new Date().toISOString() })}\n`, { encoding: 'utf8', mode: 0o600 });
}

function mergePatches(first, second) {
  // Keep the earliest `before` and the latest `after` for each record.
  const merged = structuredClone(first);
  for (const name of Object.keys(COLLECTIONS)) {
    const next = second[name];
    if (!next) continue;
    merged[name] ||= { added: [], removed: [], changed: [] };
    for (const { after } of next.changed || []) {
      const added = merged[name].added.find((record) => record.id === after.id);
      const changed = merged[name].changed.find((change) => change.after.id === after.id);
      if (added) Object.assign(added, structuredClone(after));
      else if (changed) changed.after = structuredClone(after);
      else merged[name].changed.push(structuredClone(next.changed.find((change) => change.after.id === after.id)));
    }
    merged[name].added.push(...(next.added || []).map((record) => structuredClone(record)));
    merged[name].removed.push(...(next.removed || []).map((record) => structuredClone(record)));
  }
  for (const name of [...MAPS, ...SINGLETONS]) {
    if (!second[name]) continue;
    if (!merged[name]) merged[name] = structuredClone(second[name]);
    else if (MAPS.includes(name)) {
      for (const [key, change] of Object.entries(second[name])) {
        merged[name][key] = { before: merged[name][key]?.before ?? change.before, after: change.after };
      }
    } else merged[name].after = structuredClone(second[name].after);
  }
  return merged;
}

function compact(entries) {
  const ops = entries.filter((entry) => entry.kind === 'op').slice(-KEEP_ENTRIES);
  const kept = new Set(ops.map((entry) => entry.id));
  return entries.filter((entry) => (entry.kind === 'op' ? kept.has(entry.id) : kept.has(entry.of)));
}

async function readEntries(storePath) {
  let raw = '';
  try { raw = await readFile(historyPath(storePath), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* A torn final line is ignored. */ }
  }
  return entries;
}

async function rewrite(file, entries) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
