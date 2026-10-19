// Portable task-only model. No filesystem, project content, reading or app state.
const normalize = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const searchText = (value) => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const priorities = ['none', 'low', 'medium', 'high'];
const title = (value) => {
  const result = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!result) throw new Error('A task title is required.');
  return result;
};
const notes = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').slice(0, 20_000);
function priority(value, required = false) {
  if (value == null || value === '') {
    if (required) throw new Error('Task priority is required.');
    return 'none';
  }
  const result = String(value).trim().toLowerCase();
  if (!priorities.includes(result)) throw new Error('Task priority is invalid.');
  return result;
}
function tags(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40))
    .filter(v => { const key = normalize(v); if (!v || !key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 12);
}
function schedule(input) {
  const source = input.schedule && typeof input.schedule === 'object' ? input.schedule : input;
  const dueDate = source.dueDate == null || source.dueDate === '' ? null : String(source.dueDate).trim();
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || new Date(`${dueDate}T12:00:00Z`).toISOString().slice(0, 10) !== dueDate)) throw new Error('Task due date is invalid.');
  const startTime = source.startTime == null || source.startTime === '' ? null : String(source.startTime).trim();
  if (startTime && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !dueDate)) throw new Error('A task start time requires a valid due date and HH:MM time.');
  const durationMinutes = source.durationMinutes == null || source.durationMinutes === '' ? null : Number(source.durationMinutes);
  if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080)) throw new Error('Task duration must be from 1 to 10080 minutes.');
  if (source.recurrence != null) throw new Error('Recurring tasks are reserved for a future release.');
  return { dueDate, startTime, durationMinutes, recurrence: null };
}
function descendants(items, taskId) {
  const found = [], ids = new Set([taskId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const task of items) if (ids.has(task.parentTaskId) && !ids.has(task.id)) { ids.add(task.id); found.push(task); changed = true; }
  }
  return found;
}
function ancestors(items, task) {
  const result = [];
  for (let parent = items.find(t => t.id === task.parentTaskId); parent; parent = items.find(t => t.id === parent.parentTaskId)) result.push(parent);
  return result;
}
function reopen(task, timestamp) {
  if (task.status === 'completed') Object.assign(task, { status: 'open', completedAt: null, updatedAt: timestamp });
}

export function validateTaskDocument(doc) {
  if (doc?.schemaVersion !== 1 || !['staged', 'active'].includes(doc.phase) || !Array.isArray(doc.items)
    || !Array.isArray(doc.projectIds) || typeof doc.timezone !== 'string') throw new Error('Task document is invalid.');
  new Intl.DateTimeFormat('en', { timeZone: doc.timezone });
  if (doc.items.length > 10000 || new Set(doc.projectIds).size !== doc.projectIds.length || doc.projectIds.some(id => typeof id !== 'string' || !id)) throw new Error('Task document limits or references are invalid.');
  const byId = new Map();
  for (const task of doc.items) {
    if (typeof task.id !== 'string' || !task.id || byId.has(task.id) || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 300
      || typeof task.notes !== 'string' || task.notes.length > 20000 || !['open', 'completed'].includes(task.status)
      || !priorities.includes(task.priority) || !Number.isFinite(Number(task.sortOrder))) throw new Error('Task record is invalid.');
    if (task.projectId != null && !doc.projectIds.includes(task.projectId)) throw new Error('Task project reference is invalid.');
    if (!Array.isArray(task.tags) || task.tags.length > 12 || task.tags.some(v => typeof v !== 'string' || !v.trim() || v.length > 40 || !normalize(v))
      || new Set(task.tags.map(normalize)).size !== task.tags.length) throw new Error('Task tags are invalid.');
    for (const key of ['createdAt', 'updatedAt', ...(task.status === 'completed' ? ['completedAt'] : []), ...(task.trashedAt != null ? ['trashedAt'] : [])]) {
      if (!task[key] || Number.isNaN(Date.parse(task[key]))) throw new Error('Task timestamp is invalid.');
    }
    if (!Object.hasOwn(task, 'trashedAt') || task.status === 'open' && task.completedAt != null || !task.schedule || task.schedule.recurrence !== null) throw new Error('Task lifecycle or schedule is invalid.');
    schedule(task);
    byId.set(task.id, task);
  }
  for (const task of doc.items) {
    const seen = new Set([task.id]);
    for (let current = task; current.parentTaskId != null;) {
      const parent = byId.get(current.parentTaskId);
      if (!parent || seen.has(parent.id) || (parent.projectId || null) !== (current.projectId || null)) throw new Error('Task hierarchy is invalid.');
      seen.add(parent.id); current = parent;
    }
  }
  if (JSON.stringify(doc).length > 1500000) throw new Error('Task document is too large for this personal store.');
  return doc;
}

export function taskDocumentFromStore(store) {
  return validateTaskDocument({ schemaVersion: 1, phase: 'staged', timezone: store.meta.timezone,
    projectIds: store.projects.map(p => p.id), items: structuredClone(store.tasks.items) });
}

export function applyTaskOperation(doc, action, input, { now = new Date().toISOString(), id = crypto.randomUUID() } = {}) {
  validateTaskDocument(doc);
  const items = doc.items;
  let task = items.find(t => t.id === input.taskId);
  if (action === 'create') {
    const parent = input.parentTaskId ? items.find(t => t.id === input.parentTaskId) : null;
    if (input.parentTaskId && !parent) throw new Error('Parent task not found.');
    if (parent?.trashedAt) throw new Error('A task in Trash cannot receive new subtasks.');
    let projectId = input.projectId || null;
    if (projectId && !doc.projectIds.includes(projectId)) throw new Error('Unknown project ID.');
    if (parent) {
      if (input.projectId !== undefined && projectId !== (parent.projectId || null)) throw new Error('A subtask must share its parent task\'s project.');
      projectId = parent.projectId || null;
    }
    if (items.some(t => t.id === id)) throw new Error('Task ID already exists.');
    task = { id, title: title(input.title), notes: notes(input.notes), projectId, parentTaskId: parent?.id || null,
      status: 'open', priority: priority(input.priority), tags: tags(input.tags),
      sortOrder: Math.max(0, ...items.filter(t => (t.parentTaskId || null) === (parent?.id || null)).map(t => Number(t.sortOrder) || 0)) + 1,
      schedule: schedule(input), createdAt: now, updatedAt: now, completedAt: null, trashedAt: null };
    items.push(task); for (const ancestor of ancestors(items, task)) reopen(ancestor, now);
    return { task };
  }
  if (!task) throw new Error('Task not found.');
  if (['edit', 'complete'].includes(action) && task.trashedAt) throw new Error('A task in Trash must be restored first.');
  if (action === 'edit') {
    if (input.ifUpdatedAt !== undefined && input.ifUpdatedAt !== task.updatedAt) throw new Error('Task changed since it was read. Get the task again before editing.');
    const patch = {};
    if (Object.hasOwn(input, 'title')) patch.title = title(input.title);
    if (Object.hasOwn(input, 'notes')) patch.notes = notes(input.notes);
    if (Object.hasOwn(input, 'priority')) patch.priority = priority(input.priority, true);
    if (Object.hasOwn(input, 'tags')) patch.tags = tags(input.tags);
    if (['dueDate', 'startTime', 'durationMinutes'].some(k => Object.hasOwn(input, k))) patch.schedule = schedule({ ...task.schedule, ...Object.fromEntries(['dueDate', 'startTime', 'durationMinutes'].filter(k => Object.hasOwn(input, k)).map(k => [k, input[k]])) });
    if (!Object.keys(patch).length) throw new Error('A task edit requires at least one field.');
    if (Object.entries(patch).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(task[k]))) Object.assign(task, patch, { updatedAt: now });
    return { task };
  }
  if (action === 'complete') {
    if (typeof input.completed !== 'boolean') throw new Error('Task completion must be true or false.');
    const targets = input.completed ? [task, ...descendants(items, task.id).filter(t => !t.trashedAt)] : [task];
    let affectedCount = 0;
    for (const target of targets) {
      const status = input.completed ? 'completed' : 'open';
      if (target.status === status) continue;
      Object.assign(target, { status, completedAt: input.completed ? now : null, updatedAt: now }); affectedCount++;
    }
    return { task, affectedCount };
  }
  if (action === 'trash') {
    if (task.trashedAt) throw new Error('Task is already in Trash.');
    const targets = [task, ...descendants(items, task.id)];
    for (const target of targets) Object.assign(target, { trashedAt: now, updatedAt: now });
    return { task, trashedCount: targets.length };
  }
  if (action === 'restore') {
    if (!task.trashedAt) throw new Error('Task is not in Trash.');
    const targets = [task, ...descendants(items, task.id)];
    for (const ancestor of ancestors(items, task)) { if (!ancestor.trashedAt) break; targets.push(ancestor); }
    let restoredCount = 0;
    for (const target of targets) if (target.trashedAt) { Object.assign(target, { trashedAt: null, updatedAt: now }); restoredCount++; }
    for (const target of targets.filter(t => t.status === 'open')) for (const ancestor of ancestors(items, target)) reopen(ancestor, now);
    return { task, restoredCount };
  }
  throw new Error('Task operation is unavailable.');
}

export function createCloudTaskService(repository) {
  async function read() {
    const row = await repository.read();
    if (!row) throw new Error('Task store is not initialized.');
    validateTaskDocument(row.document);
    if (row.document.phase !== 'active') throw new Error('Task cutover is not active.');
    return row;
  }
  const retained = (task) => !task.trashedAt || Date.parse(task.trashedAt) + 30 * 86400000 > Date.now();
  return {
    async list({ scope = 'open', query, projectId, tag, dueFrom, dueThrough, limit = 50, offset = 0 } = {}) {
      const { document: doc, revision } = await read();
      if (projectId != null && !doc.projectIds.includes(projectId)) throw new Error('Unknown project ID.');
      const selected = doc.items.filter(t => retained(t) && (scope === 'trash' ? t.trashedAt : !t.trashedAt)
        && (!['open', 'completed'].includes(scope) || t.status === scope) && (projectId === undefined || t.projectId === projectId)
        && (!tag || t.tags.some(v => searchText(v) === searchText(tag)))
        && (!query || searchText([t.id, t.title, t.notes, ...t.tags].join('\n')).includes(searchText(query)))
        && (!dueFrom || t.schedule.dueDate && t.schedule.dueDate >= dueFrom) && (!dueThrough || t.schedule.dueDate && t.schedule.dueDate <= dueThrough))
        .sort((a, b) => (a.parentTaskId || '').localeCompare(b.parentTaskId || '') || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
      return { tasks: selected.slice(offset, offset + limit).map(({ notes, ...t }) => ({ ...t, hasNotes: Boolean(notes) })),
        total: selected.length, nextOffset: offset + limit < selected.length ? offset + limit : null, timezone: doc.timezone, revision };
    },
    async get({ taskId }) {
      const { document: doc, revision } = await read();
      const task = doc.items.find(t => t.id === taskId && retained(t));
      if (!task) throw new Error('Task not found.');
      return { task, descendantCount: descendants(doc.items, taskId).length, timezone: doc.timezone, revision };
    },
    ...Object.fromEntries(['create', 'edit', 'complete', 'trash', 'restore'].map(action => [action, async input => {
      const now = new Date().toISOString(), id = crypto.randomUUID();
      for (let attempt = 0; attempt < 6; attempt++) {
        const { document, revision } = await read();
        const before = JSON.stringify(document);
        const result = applyTaskOperation(document, action, input, { now, id });
        validateTaskDocument(document);
        if (JSON.stringify(document) === before) return { ...result, revision };
        const next = await repository.compareAndSwap(revision, document);
        if (next != null) return { ...result, revision: next };
      }
      throw new Error('Task store is busy. Read again before retrying.');
    }])),
  };
}

export function createD1TaskRepository(db) {
  // Every request starts at the primary, even if someone later enables replicas.
  const connection = db.withSession('first-primary');
  return {
    async read() {
      const row = await connection.prepare('SELECT document, revision FROM lifeos_tasks WHERE id = 1').first();
      return row ? { document: JSON.parse(row.document), revision: row.revision } : null;
    },
    async compareAndSwap(revision, document) {
      const row = await connection.prepare('UPDATE lifeos_tasks SET document = ?, revision = revision + 1 WHERE id = 1 AND revision = ? RETURNING revision')
        .bind(JSON.stringify(document), revision).first();
      return row?.revision ?? null;
    },
  };
}
