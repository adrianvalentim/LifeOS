import { stat } from 'node:fs/promises';
import { readTaskAuthority } from './task-authority.mjs';
import {
  DEFAULT_STORE_PATH, TASK_TRASH_RETENTION_DAYS, createTask, editTask,
  readStore, restoreTask, setTaskCompletion, trashTask,
} from './lifeos-data.mjs';

const normalize = (value) => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// A small task-only boundary. The store layer selects the local authority or
// the opt-in online adapter; callers do not maintain an independent replica.
// No initialization, migration write, automatic purge, or permanent delete.
export function createTaskService({ storePath = DEFAULT_STORE_PATH, enableWrites = false } = {}) {
  async function read() {
    const authority = await readTaskAuthority(storePath);
    if (authority && !(authority.mode === 'online' && authority.phase === 'active')) throw new Error('Task authority transfer is pending; this local MCP is unavailable.');
    await stat(storePath); // Refuse an absent store instead of seeding demo data.
    return readStore(storePath, { initialize: false });
  }
  function writable() {
    if (!enableWrites) throw new Error('Task writes are disabled on this server.');
  }
  function summary(task) {
    const { notes, ...rest } = task;
    return { ...rest, hasNotes: Boolean(notes) };
  }
  function retained(task) {
    return !task.trashedAt || Date.parse(task.trashedAt) + TASK_TRASH_RETENTION_DAYS * 86_400_000 > Date.now();
  }
  async function list({ scope = 'open', query, projectId, tag, dueFrom, dueThrough, limit = 50, offset = 0 } = {}) {
    const store = await read();
    if (projectId != null && !store.projects.some((p) => p.id === projectId)) throw new Error('Unknown project ID.');
    const tasks = store.tasks.items.filter((task) => {
      if (!retained(task)) return false;
      if (scope === 'trash' ? !task.trashedAt : task.trashedAt) return false;
      if (['open', 'completed'].includes(scope) && task.status !== scope) return false;
      if (projectId !== undefined && task.projectId !== projectId) return false;
      if (tag && !task.tags.some((t) => normalize(t) === normalize(tag))) return false;
      if (query && !normalize([task.id, task.title, task.notes, ...task.tags].join('\n')).includes(normalize(query))) return false;
      if (dueFrom && (!task.schedule.dueDate || task.schedule.dueDate < dueFrom)) return false;
      if (dueThrough && (!task.schedule.dueDate || task.schedule.dueDate > dueThrough)) return false;
      return true;
    }).sort((a, b) => (a.parentTaskId || '').localeCompare(b.parentTaskId || '') || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    return { tasks: tasks.slice(offset, offset + limit).map(summary), total: tasks.length,
      nextOffset: offset + limit < tasks.length ? offset + limit : null, timezone: store.meta.timezone };
  }
  async function get({ taskId }) {
    const store = await read();
    const task = store.tasks.items.find((t) => t.id === taskId && retained(t));
    if (!task) throw new Error('Task not found.');
    const descendants = new Set([taskId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of store.tasks.items) {
        if (descendants.has(candidate.parentTaskId) && !descendants.has(candidate.id)) {
          descendants.add(candidate.id); changed = true;
        }
      }
    }
    return { task, descendantCount: descendants.size - 1, timezone: store.meta.timezone };
  }
  async function mutate(action, input) {
    writable();
    if (await readTaskAuthority(storePath)) throw new Error('Task authority is now Cloudflare; use the cloud MCP endpoint.');
    await stat(storePath);
    const { state, ...result } = await action(input, storePath);
    return result; // Never return /api/state, projects, reading, sessions, or the rail.
  }
  return {
    list, get,
    create: (input) => mutate(createTask, input),
    edit: (input) => mutate(editTask, input),
    complete: (input) => mutate(setTaskCompletion, input),
    trash: (input) => mutate(trashTask, input),
    restore: (input) => mutate(restoreTask, input),
  };
}
