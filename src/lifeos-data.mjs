import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_STORE_PATH,
  DEMO_STORE_PATH,
  ROOT_DIR,
  backUpStore,
  initializeDefaultStore,
} from './lifeos-storage.mjs';

export { DEFAULT_STORE_PATH, DEMO_STORE_PATH, ROOT_DIR } from './lifeos-storage.mjs';
export const CURRENT_SCHEMA_VERSION = 9;
export const ACTIVITY_TYPES = [
  'deep_work',
  'shallow_work',
  'admin',
  'research',
  'creative',
  'communication',
];
export const PROJECT_STATUSES = ['to_do', 'next_up', 'doing', 'paused', 'done', 'dropped'];
export const READING_STATUSES = ['to_read', 'next_up', 'reading', 'finished', 'dropped'];
export const TASK_STATUSES = ['open', 'completed'];
export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high'];

const HEALTH_ORDER = { critical: 0, attention: 1, healthy: 2 };
const ACTIVE_PROJECT_STATUSES = new Set(['to_do', 'next_up', 'doing']);
const READING_STATUS_ORDER = Object.fromEntries(READING_STATUSES.map((status, index) => [status, index]));
const TASK_STATUS_ORDER = Object.fromEntries(TASK_STATUSES.map((status, index) => [status, index]));
const MAX_TASK_TAGS = 12;
const DAY_MS = 86_400_000;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export async function readStore(storePath = DEFAULT_STORE_PATH) {
  if (isDefaultStorePath(storePath)) await initializeDefaultStore();
  const raw = await readFile(storePath, 'utf8');
  let store;
  try {
    store = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LifeOS data is not valid JSON: ${error.message}`);
  }
  const migrated = migrateStore(store);
  validateStore(migrated);
  return migrated;
}

export async function writeStore(store, storePath = DEFAULT_STORE_PATH) {
  const migrated = migrateStore(store);
  validateStore(migrated);
  const directory = path.dirname(storePath);
  const filename = path.basename(storePath);
  const tempPath = path.join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  const backupPath = `${storePath}.bak`;

  await mkdir(directory, { recursive: true });
  try {
    await copyFile(storePath, backupPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await writeFile(tempPath, `${JSON.stringify(migrated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(tempPath, storePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await unlink(storePath).catch((unlinkError) => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    await rename(tempPath, storePath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function mutateStore(mutator, storePath = DEFAULT_STORE_PATH) {
  if (isDefaultStorePath(storePath)) await initializeDefaultStore();
  const release = await acquireStoreLock(storePath);
  let result;
  let store;
  try {
    store = await readStore(storePath);
    result = await mutator(store);
    await writeStore(store, storePath);
  } finally {
    await release();
  }

  if (!isDefaultStorePath(storePath)) return { result, store, backup: { configured: false, ok: null } };
  const backup = await backUpStore(store);
  if (backup.ok === false) console.warn(`LifeOS cloud backup failed: ${backup.error}`);
  return { result, store, backup };
}

function isDefaultStorePath(storePath) {
  return path.resolve(storePath) === path.resolve(DEFAULT_STORE_PATH);
}

export function migrateStore(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const store = structuredClone(input);
  const version = Number(store.meta?.schemaVersion || 1);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`LifeOS data uses unsupported schema version ${version}.`);
  }
  if (!store.reading || typeof store.reading !== 'object' || Array.isArray(store.reading)) {
    store.reading = { books: [] };
  }
  if (!Array.isArray(store.reading.books)) store.reading.books = [];
  if (version < 4) {
    for (const book of store.reading.books) {
      if (!Array.isArray(book.tags)) book.tags = [];
    }
  }
  if (version < 5) {
    for (const project of store.projects || []) {
      if (PROJECT_STATUSES.includes(project.status)) continue;
      const legacyStatus = normalizeText(project.status);
      if (legacyStatus === 'active') project.status = 'next_up';
      else if (['complete', 'completed', 'finished', 'done'].includes(legacyStatus)) project.status = 'done';
      else if (['todo', 'to do', 'planned', 'backlog'].includes(legacyStatus)) project.status = 'to_do';
      else if (['doing', 'in progress'].includes(legacyStatus)) project.status = 'doing';
      else project.status = 'dropped';
    }
  }
  if (version < 6) {
    if (!store.categories || typeof store.categories !== 'object' || Array.isArray(store.categories)) {
      store.categories = {};
    }
    for (const project of store.projects || []) {
      if (!Array.isArray(project.categoryIds)) project.categoryIds = [];
    }
    for (const entry of store.timeEntries || []) {
      if (!Array.isArray(entry.categoryIds)) entry.categoryIds = [];
    }
    if (store.activeSession && !Array.isArray(store.activeSession.categoryIds)) {
      store.activeSession.categoryIds = [];
    }
  }
  if (version < 7) {
    if (!store.tasks || typeof store.tasks !== 'object' || Array.isArray(store.tasks)) {
      store.tasks = { items: [] };
    }
    if (!Array.isArray(store.tasks.items)) store.tasks.items = [];
  }
  if (version < 8) {
    for (const task of store.tasks?.items || []) {
      if (typeof task.notes !== 'string') task.notes = '';
    }
  }
  if (version < 9) {
    for (const task of store.tasks?.items || []) {
      if (!TASK_PRIORITIES.includes(task.priority)) task.priority = 'none';
      if (!Array.isArray(task.tags)) task.tags = [];
    }
  }
  if (store.meta) store.meta.schemaVersion = CURRENT_SCHEMA_VERSION;
  return store;
}

export function validateStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('LifeOS data must be a JSON object.');
  }
  if (!store.meta || !store.meta.timezone) throw new Error('LifeOS data requires meta.timezone.');
  if (!store.domains || typeof store.domains !== 'object') throw new Error('LifeOS data requires domains.');
  if (!store.categories || typeof store.categories !== 'object' || Array.isArray(store.categories)) {
    throw new Error('LifeOS data requires categories.');
  }
  if (!store.settings?.weeklyPlanByDomain) throw new Error('LifeOS data requires settings.weeklyPlanByDomain.');
  if (!Array.isArray(store.projects)) throw new Error('LifeOS data requires a projects array.');
  if (!Array.isArray(store.timeEntries)) throw new Error('LifeOS data requires a timeEntries array.');
  if (!store.reading || !Array.isArray(store.reading.books)) {
    throw new Error('LifeOS data requires reading.books.');
  }
  if (!store.tasks || !Array.isArray(store.tasks.items)) {
    throw new Error('LifeOS data requires tasks.items.');
  }

  const categoryIds = new Set();
  const categoryLabels = new Set();
  for (const [categoryId, category] of Object.entries(store.categories)) {
    const label = String(category?.label || '').trim();
    const normalizedLabel = normalizeText(label);
    if (!categoryId || !label || !normalizedLabel || categoryLabels.has(normalizedLabel)) {
      throw new Error(`Invalid or duplicate category: ${categoryId || '(missing id)'}.`);
    }
    categoryIds.add(categoryId);
    categoryLabels.add(normalizedLabel);
  }

  const projectIds = new Set();
  for (const project of store.projects) {
    if (!project?.id || !project.name || !project.domain) throw new Error('Every project needs id, name, and domain.');
    if (projectIds.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`);
    if (!store.domains[project.domain]) throw new Error(`Unknown domain on ${project.name}: ${project.domain}`);
    if (!PROJECT_STATUSES.includes(project.status)) {
      throw new Error(`Project ${project.id} has unknown status ${project.status}.`);
    }
    validateCategoryIds(project.categoryIds, categoryIds, `Project ${project.id}`);
    projectIds.add(project.id);
  }

  const entryIds = new Set();
  for (const entry of store.timeEntries) {
    if (!entry?.id || !entry.date || !Number.isFinite(Number(entry.durationMinutes))) {
      throw new Error('Every time entry needs id, date, and durationMinutes.');
    }
    if (entryIds.has(entry.id)) throw new Error(`Duplicate time entry id: ${entry.id}`);
    if (entry.projectId && !projectIds.has(entry.projectId)) {
      throw new Error(`Time entry ${entry.id} references missing project ${entry.projectId}.`);
    }
    if (entry.domain && !store.domains[entry.domain]) {
      throw new Error(`Time entry ${entry.id} references missing domain ${entry.domain}.`);
    }
    validateCategoryIds(entry.categoryIds, categoryIds, `Time entry ${entry.id}`);
    if (!ACTIVITY_TYPES.includes(entry.activityType)) {
      throw new Error(`Time entry ${entry.id} has unknown activity type ${entry.activityType}.`);
    }
    entryIds.add(entry.id);
  }

  if (store.activeSession) {
    if (store.activeSession.projectId && !projectIds.has(store.activeSession.projectId)) {
      throw new Error(`Active session references missing project ${store.activeSession.projectId}.`);
    }
    if (store.activeSession.domain && !store.domains[store.activeSession.domain]) {
      throw new Error(`Active session references missing domain ${store.activeSession.domain}.`);
    }
    validateCategoryIds(store.activeSession.categoryIds, categoryIds, 'Active session');
  }

  const bookIds = new Set();
  for (const book of store.reading.books) {
    if (!book?.id || !book.title || !Array.isArray(book.authors)) {
      throw new Error('Every reading book needs id, title, and authors.');
    }
    if (bookIds.has(book.id)) throw new Error(`Duplicate reading book id: ${book.id}`);
    if (!READING_STATUSES.includes(book.status)) {
      throw new Error(`Reading book ${book.id} has unknown status ${book.status}.`);
    }
    if (!Number.isFinite(Number(book.sortOrder))) {
      throw new Error(`Reading book ${book.id} needs a finite sortOrder.`);
    }
    if (book.finishedAt != null && Number.isNaN(new Date(book.finishedAt).getTime())) {
      throw new Error(`Reading book ${book.id} has an invalid date read.`);
    }
    if (!Array.isArray(book.tags) || book.tags.length > 24) {
      throw new Error(`Reading book ${book.id} needs no more than 24 tags.`);
    }
    const normalizedTags = new Set();
    for (const tag of book.tags) {
      const cleanTag = String(tag || '').trim();
      const normalized = normalizeText(cleanTag);
      if (!cleanTag || cleanTag.length > 40 || !normalized || normalizedTags.has(normalized)) {
        throw new Error(`Reading book ${book.id} has invalid or duplicate tags.`);
      }
      normalizedTags.add(normalized);
    }
    bookIds.add(book.id);
  }

  const taskIds = new Set();
  const tasksById = new Map();
  for (const task of store.tasks.items) {
    const title = String(task?.title || '').trim();
    if (!task?.id || !title || title.length > 300) {
      throw new Error('Every task needs an id and a title no longer than 300 characters.');
    }
    if (typeof task.notes !== 'string' || task.notes.length > 20_000) {
      throw new Error(`Task ${task.id} needs notes no longer than 20000 characters.`);
    }
    if (taskIds.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    if (task.projectId != null && !projectIds.has(task.projectId)) {
      throw new Error(`Task ${task.id} references missing project ${task.projectId}.`);
    }
    if (!TASK_STATUSES.includes(task.status)) {
      throw new Error(`Task ${task.id} has unknown status ${task.status}.`);
    }
    if (!Number.isFinite(Number(task.sortOrder))) {
      throw new Error(`Task ${task.id} needs a finite sortOrder.`);
    }
    if (!TASK_PRIORITIES.includes(task.priority)) {
      throw new Error(`Task ${task.id} has unknown priority ${task.priority}.`);
    }
    validateTaskTags(task.tags, task.id);
    validateTaskTimestamp(task.createdAt, `Task ${task.id} createdAt`);
    validateTaskTimestamp(task.updatedAt, `Task ${task.id} updatedAt`);
    if (task.status === 'completed') {
      validateTaskTimestamp(task.completedAt, `Task ${task.id} completedAt`);
    } else if (task.completedAt != null) {
      throw new Error(`Open task ${task.id} cannot have completedAt.`);
    }
    validateTaskSchedule(task.schedule, task.id);
    taskIds.add(task.id);
    tasksById.set(task.id, task);
  }
  for (const task of store.tasks.items) {
    if (task.parentTaskId == null) continue;
    const parent = tasksById.get(task.parentTaskId);
    if (!parent) throw new Error(`Task ${task.id} references missing parent task ${task.parentTaskId}.`);
    if (parent.id === task.id) throw new Error(`Task ${task.id} cannot be its own parent.`);
    if ((parent.projectId || null) !== (task.projectId || null)) {
      throw new Error(`Task ${task.id} must share its parent task's project.`);
    }
  }
  validateTaskHierarchy(tasksById);
  return store;
}

export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function validateCategoryIds(values, knownIds, owner) {
  if (!Array.isArray(values) || values.length > 12) {
    throw new Error(`${owner} needs no more than 12 categoryIds.`);
  }
  const unique = new Set(values);
  if (unique.size !== values.length || values.some((categoryId) => !knownIds.has(categoryId))) {
    throw new Error(`${owner} has invalid, duplicate, or unknown categoryIds.`);
  }
}

function validateTaskTimestamp(value, label) {
  if (!value || Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a valid timestamp.`);
}

function validateTaskTags(tags, taskId) {
  if (!Array.isArray(tags) || tags.length > MAX_TASK_TAGS) {
    throw new Error(`Task ${taskId} needs no more than ${MAX_TASK_TAGS} tags.`);
  }
  const normalizedTags = new Set();
  for (const tag of tags) {
    const cleanTag = String(tag || '').trim();
    const normalized = normalizeText(cleanTag);
    if (!cleanTag || cleanTag.length > 40 || !normalized || normalizedTags.has(normalized)) {
      throw new Error(`Task ${taskId} has invalid or duplicate tags.`);
    }
    normalizedTags.add(normalized);
  }
}

function validateTaskSchedule(schedule, taskId) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new Error(`Task ${taskId} requires a schedule object.`);
  }
  const dueDate = requireOptionalDateOnly(schedule.dueDate, `Task ${taskId} due date`);
  const startTime = requireOptionalTime(schedule.startTime, `Task ${taskId} start time`);
  requireOptionalTaskDuration(schedule.durationMinutes, `Task ${taskId} duration`);
  if (startTime && !dueDate) throw new Error(`Task ${taskId} start time requires a due date.`);
  if (schedule.recurrence !== null) {
    throw new Error(`Task ${taskId} recurrence is reserved for a future schema revision and must be null.`);
  }
}

function validateTaskHierarchy(tasksById) {
  const visited = new Set();
  const visiting = new Set();
  const visit = (task) => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error(`Task hierarchy contains a cycle at ${task.id}.`);
    visiting.add(task.id);
    if (task.parentTaskId != null) visit(tasksById.get(task.parentTaskId));
    visiting.delete(task.id);
    visited.add(task.id);
  };
  for (const task of tasksById.values()) visit(task);
}

export function dateOnly(value = new Date(), timeZone = 'UTC') {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) {
    if (!value.includes('T')) return value.slice(0, 10);
    value = new Date(value);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localTime(value = new Date(), timeZone = 'UTC') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid time: ${value}`);
  const parts = zonedParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function parseDateOnly(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(dateValue, amount) {
  return new Date(parseDateOnly(dateValue) + Number(amount) * DAY_MS).toISOString().slice(0, 10);
}

export function startOfWeek(dateValue) {
  const day = new Date(parseDateOnly(dateValue)).getUTCDay();
  return addDays(dateValue, -((day + 6) % 7));
}

export function daysUntil(dateValue, fromDateValue) {
  if (!dateValue) return null;
  return Math.ceil((parseDateOnly(dateValue) - parseDateOnly(fromDateValue)) / DAY_MS);
}

export function daysSince(dateTimeValue, nowValue) {
  if (!dateTimeValue) return null;
  const diff = new Date(nowValue).getTime() - new Date(dateTimeValue).getTime();
  return Math.max(0, diff / DAY_MS);
}

export function formatAgo(dateTimeValue, nowValue) {
  if (!dateTimeValue) return 'never';
  const diffHours = Math.max(0, (new Date(nowValue).getTime() - new Date(dateTimeValue).getTime()) / 36e5);
  if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))}m ago`;
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}`;
}

export function formatHours(hours) {
  return formatMinutes(Math.round((Number(hours) || 0) * 60));
}

export function findProject(store, query) {
  return projectMatches(store, query).at(0) || null;
}

export function requireProject(store, query) {
  const matches = projectMatches(store, query);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Ambiguous project: ${query}. Matches: ${matches.map((project) => project.name).join(', ')}`);
  }
  throw new Error(`Project not found: ${query}`);
}

export function findTask(store, query) {
  return taskMatches(store, query).at(0) || null;
}

export function requireTask(store, query) {
  const matches = taskMatches(store, query);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Ambiguous task: ${query}. Matches: ${matches.map((task) => task.title).join(', ')}`);
  }
  throw new Error(`Task not found: ${query}`);
}

export function findCategory(store, query) {
  const needle = normalizeText(query);
  if (!needle) return null;
  const categories = Object.entries(store.categories || {})
    .map(([id, category]) => ({ id, ...category }));
  const exact = categories.find((category) => (
    normalizeText(category.id) === needle || normalizeText(category.label) === needle
  ));
  if (exact) return exact;
  return categories.find((category) => normalizeText(category.label).includes(needle)) || null;
}

function ensureCategory(store, label) {
  const cleanLabel = String(label || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!normalizeText(cleanLabel)) throw new Error('A category name is required.');
  const existing = findCategory(store, cleanLabel);
  if (existing && normalizeText(existing.label) === normalizeText(cleanLabel)) return existing;

  const baseId = normalizeText(cleanLabel).replaceAll(' ', '-');
  let id = baseId;
  let suffix = 2;
  while (store.categories[id]) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  store.categories[id] = { label: cleanLabel };
  return { id, ...store.categories[id] };
}

export function parseDurationToMinutes(input) {
  const text = String(input || '').toLowerCase().replace(/,/g, '.');
  let minutes = 0;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/);
  if (hourMatch) minutes += Number(hourMatch[1]) * 60;
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)\b/);
  if (minuteMatch) minutes += Number(minuteMatch[1]);
  if (!minutes) {
    const bare = normalizeText(input).match(/\b(\d{1,3})\b/);
    if (bare) minutes = Number(bare[1]);
  }
  return minutes > 0 ? Math.round(minutes) : null;
}

export function inferActivityType(input) {
  const text = normalizeText(input);
  if (/\b(read|reading|research|paper|literature|background|study|studied)\b/.test(text)) return 'research';
  if (/\b(reply|call|meeting|async|message|communication|interview)\b/.test(text)) return 'communication';
  if (/\b(inbox|email|scheduling|admin|paperwork|ops|orders)\b/.test(text)) return 'admin';
  if (/\b(edit|editing|draft|write|writing|script|cut|color|film|create|creative)\b/.test(text)) return 'creative';
  if (/\b(shallow|triage)\b/.test(text)) return 'shallow_work';
  return 'deep_work';
}

export function inferProjectFromText(store, input) {
  const text = normalizeText(input);
  const ranked = [...store.projects].sort((a, b) => normalizeText(b.name).length - normalizeText(a.name).length);
  return ranked.find((project) => {
    const name = normalizeText(project.name);
    const id = normalizeText(project.id);
    return text.includes(name) || text.includes(id);
  }) || null;
}

export function createTimeEntry(store, input) {
  const now = input.now ? new Date(input.now) : new Date();
  const durationMinutes = Number(input.durationMinutes ?? parseDurationToMinutes(input.rawInput ?? input.description));
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('A positive duration is required.');
  }

  const project = resolveProjectForEntry(store, input);
  const timeZone = store.meta.timezone;
  const date = input.date || dateOnly(now, timeZone);
  const time = input.time === null ? null : input.time || localTime(now, timeZone);
  const activityType = input.activityType || inferActivityType(`${input.rawInput || ''} ${input.description || ''}`);
  if (!ACTIVITY_TYPES.includes(activityType)) throw new Error(`Unknown activity type: ${activityType}`);
  const preservedDomain = project ? null : input.domain || null;
  if (preservedDomain && !store.domains[preservedDomain]) {
    throw new Error(`Unknown domain: ${preservedDomain}`);
  }

  return {
    id: input.id || randomUUID(),
    projectId: project?.id || null,
    ...(preservedDomain ? { domain: preservedDomain } : {}),
    categoryIds: [...new Set(input.categoryIds || [])],
    date,
    time,
    durationMinutes: Math.round(durationMinutes),
    activityType,
    description: input.description || cleanLogDescription(input.rawInput || ''),
    rawInput: input.rawInput || input.description || '',
    captureSource: input.source || 'codex_cli',
    createdAt: input.createdAt || now.toISOString(),
  };
}

export function applyTimeEntry(store, entry) {
  store.timeEntries.push(entry);
  store.timeEntries.sort((a, b) => entryTimestamp(a) - entryTimestamp(b));
  return entry;
}

export async function logTime(input, storePath = DEFAULT_STORE_PATH) {
  const { result: entry, store } = await mutateStore((current) => {
    const next = createTimeEntry(current, input);
    return applyTimeEntry(current, next);
  }, storePath);
  return { entry, state: buildState(store, { now: input.now, range: input.range }) };
}

export async function startSession(input, storePath = DEFAULT_STORE_PATH) {
  const { result: session, store } = await mutateStore((current) => {
    if (current.activeSession) throw new Error('A LifeOS session is already running. Stop it before starting another.');
    const project = resolveProjectForEntry(current, input);
    const startedAt = input.startedAt || new Date().toISOString();
    current.activeSession = {
      id: randomUUID(),
      projectId: project?.id || null,
      categoryIds: [...new Set(input.categoryIds || [])],
      activityType: input.activityType || inferActivityType(input.description || project?.name || ''),
      description: input.description || `Focused work on ${project?.name || 'general work'}`,
      rawInput: input.rawInput || input.description || '',
      startedAt,
    };
    return current.activeSession;
  }, storePath);
  return { session, state: buildState(store, { now: input.now }) };
}

export async function stopSession(input = {}, storePath = DEFAULT_STORE_PATH) {
  const { result, store } = await mutateStore((current) => {
    const session = current.activeSession;
    if (!session) throw new Error('There is no active LifeOS session to stop.');
    const stoppedAt = input.stoppedAt ? new Date(input.stoppedAt) : new Date();
    const elapsed = Math.max(1, Math.round((stoppedAt.getTime() - new Date(session.startedAt).getTime()) / 60_000));
    const startedAt = new Date(session.startedAt);
    const entry = createTimeEntry(current, {
      projectId: session.projectId,
      domain: session.domain,
      categoryIds: session.categoryIds,
      durationMinutes: input.durationMinutes || elapsed,
      activityType: input.activityType || session.activityType,
      description: input.description || session.description,
      rawInput: session.rawInput,
      source: 'lifeos_timer',
      date: dateOnly(startedAt, current.meta.timezone),
      time: localTime(startedAt, current.meta.timezone),
      createdAt: stoppedAt.toISOString(),
      now: stoppedAt,
    });
    applyTimeEntry(current, entry);
    current.activeSession = null;
    return { session, entry };
  }, storePath);
  return { ...result, state: buildState(store, { now: input.now || input.stoppedAt }) };
}

export async function setProjectStatus(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const status = requireProjectStatus(input.status);
  const { result: project, store } = await mutateStore((current) => {
    const existing = current.projects.find((candidate) => candidate.id === input.projectId);
    if (!existing) throw new Error(`Project not found: ${input.projectId}`);
    if (existing.status === status) return existing;
    existing.status = status;
    existing.statusChangedAt = now.toISOString();
    return existing;
  }, storePath);
  return { project, state: buildState(store, { now }) };
}

export async function addProjectCategory(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const project = current.projects.find((candidate) => candidate.id === input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    const category = ensureCategory(current, input.category);
    if (!project.categoryIds.includes(category.id)) project.categoryIds.push(category.id);
    return { project, category };
  }, storePath);
  return { ...result, state: buildState(store, { now }) };
}

export async function deleteProject(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const projectIndex = current.projects.findIndex((candidate) => candidate.id === input.projectId);
    if (projectIndex < 0) throw new Error(`Project not found: ${input.projectId}`);
    const project = current.projects[projectIndex];
    if (current.challenge?.projectId === project.id) {
      throw new Error(`Project ${project.name} is used by the active challenge and cannot be deleted.`);
    }

    const referencedEntries = current.timeEntries.filter((entry) => entry.projectId === project.id);
    const activeSessionUsesProject = current.activeSession?.projectId === project.id;
    let preservedCategory = null;
    if (input.preserveCategory) preservedCategory = ensureCategory(current, input.preserveCategory);
    if (input.preserveHistory === true
      && (referencedEntries.length || activeSessionUsesProject)
      && project.categoryIds.length === 0
      && !preservedCategory) {
      preservedCategory = ensureCategory(current, project.name);
    }
    const preservedCategoryIds = [...new Set([
      ...project.categoryIds,
      ...(preservedCategory ? [preservedCategory.id] : []),
    ])];
    if ((referencedEntries.length || activeSessionUsesProject) && !preservedCategoryIds.length) {
      throw new Error(`Project ${project.name} still has time history. Use preserveCategory to retain it before deletion.`);
    }

    for (const entry of referencedEntries) {
      entry.projectId = null;
      entry.domain ||= project.domain;
      entry.categoryIds = [...new Set([...entry.categoryIds, ...preservedCategoryIds])];
    }
    if (activeSessionUsesProject) {
      current.activeSession.projectId = null;
      current.activeSession.domain = project.domain;
      current.activeSession.categoryIds = [...new Set([
        ...current.activeSession.categoryIds,
        ...preservedCategoryIds,
      ])];
    }
    const detachedTasks = current.tasks.items.filter((task) => task.projectId === project.id);
    for (const task of detachedTasks) {
      task.projectId = null;
      task.updatedAt = now.toISOString();
    }
    current.projects.splice(projectIndex, 1);
    return {
      project,
      preservedCategory,
      preservedEntryCount: referencedEntries.length,
      preservedActiveSession: Boolean(activeSessionUsesProject),
      detachedTaskCount: detachedTasks.length,
    };
  }, storePath);
  return { ...result, state: buildState(store, { now }) };
}

export function buildCategoryStats(store, query, options = {}) {
  const copy = migrateStore(store);
  validateStore(copy);
  const category = findCategory(copy, query);
  if (!category) throw new Error(`Category not found: ${query}`);
  const now = resolveNow(options.now);
  const today = dateOnly(now, copy.meta.timezone);
  const range = ['week', 'month', 'quarter', 'year'].includes(options.range) ? options.range : 'week';
  const bounds = rangeBounds(range, today);
  const entries = filterEntries(copy.timeEntries, bounds)
    .filter((entry) => entryCategoryIds(copy, entry).includes(category.id));
  const minutes = sumMinutes(entries);
  return {
    category,
    range,
    rangeLabel: rangeLabels(today)[range],
    bounds,
    entryCount: entries.length,
    totalMinutes: minutes,
    totalHours: round1(minutes / 60),
    totalLabel: formatMinutes(minutes),
    projects: copy.projects
      .filter((project) => project.categoryIds.includes(category.id))
      .map((project) => ({ id: project.id, name: project.name, status: project.status })),
  };
}

export async function createTask(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const title = cleanTaskTitle(input.title);
  const parentTaskId = input.parentTaskId == null || input.parentTaskId === ''
    ? null
    : String(input.parentTaskId).trim();
  const schedule = normalizeTaskSchedule(input);
  const { result: task, store } = await mutateStore((current) => {
    const parent = parentTaskId
      ? current.tasks.items.find((candidate) => candidate.id === parentTaskId)
      : null;
    if (parentTaskId && !parent) throw new Error(`Parent task not found: ${parentTaskId}`);

    let projectId = normalizeTaskProjectId(current, input.projectId);
    if (parent) {
      if (input.projectId !== undefined && projectId !== (parent.projectId || null)) {
        throw new Error('A subtask must share its parent task\'s project.');
      }
      projectId = parent.projectId || null;
    }

    const timestamp = now.toISOString();
    const next = {
      id: input.id || randomUUID(),
      title,
      notes: cleanTaskNotes(input.notes),
      projectId,
      parentTaskId,
      status: 'open',
      priority: cleanTaskPriority(input.priority),
      tags: cleanTaskTags(input.tags),
      sortOrder: nextTaskSortOrder(current.tasks.items, parentTaskId),
      schedule,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    current.tasks.items.push(next);
    let ancestor = parent;
    while (ancestor) {
      if (ancestor.status === 'completed') {
        ancestor.status = 'open';
        ancestor.completedAt = null;
        ancestor.updatedAt = timestamp;
      }
      ancestor = ancestor.parentTaskId
        ? current.tasks.items.find((candidate) => candidate.id === ancestor.parentTaskId)
        : null;
    }
    return next;
  }, storePath);
  return { task, state: buildState(store, { now }) };
}

export async function updateTask(input, storePath = DEFAULT_STORE_PATH) {
  if (!Object.hasOwn(input, 'title') && !Object.hasOwn(input, 'notes')) {
    throw new Error('A task update requires a title or notes.');
  }
  const now = resolveNow(input.now);
  const { result: task, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    const title = Object.hasOwn(input, 'title') ? cleanTaskTitle(input.title) : existing.title;
    const notes = Object.hasOwn(input, 'notes') ? cleanTaskNotes(input.notes) : existing.notes;
    if (existing.title !== title || existing.notes !== notes) {
      existing.title = title;
      existing.notes = notes;
      existing.updatedAt = now.toISOString();
    }
    return existing;
  }, storePath);
  return { task, state: buildState(store, { now }) };
}

export async function deleteTask(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    const targets = new Set([
      existing.id,
      ...taskDescendants(current.tasks.items, existing.id).map((task) => task.id),
    ]);
    current.tasks.items = current.tasks.items.filter((task) => !targets.has(task.id));
    return { task: existing, deletedCount: targets.size };
  }, storePath);
  return { ...result, state: buildState(store, { now }) };
}

export async function setTaskCompletion(input, storePath = DEFAULT_STORE_PATH) {
  if (typeof input.completed !== 'boolean') throw new Error('Task completion must be true or false.');
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    const timestamp = now.toISOString();
    const targets = input.completed
      ? [existing, ...taskDescendants(current.tasks.items, existing.id)]
      : [existing];
    let affectedCount = 0;
    for (const task of targets) {
      const status = input.completed ? 'completed' : 'open';
      if (task.status === status) continue;
      task.status = status;
      task.completedAt = input.completed ? timestamp : null;
      task.updatedAt = timestamp;
      affectedCount += 1;
    }
    return { task: existing, affectedCount };
  }, storePath);
  return { ...result, state: buildState(store, { now }) };
}

export async function setTaskProject(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    if (existing.parentTaskId) throw new Error('Only a top-level task can be assigned to a project.');
    const projectId = normalizeTaskProjectId(current, input.projectId);
    const targets = [existing, ...taskDescendants(current.tasks.items, existing.id)];
    const timestamp = now.toISOString();
    let affectedCount = 0;
    for (const task of targets) {
      if ((task.projectId || null) === projectId) continue;
      task.projectId = projectId;
      task.updatedAt = timestamp;
      affectedCount += 1;
    }
    return { task: existing, affectedCount };
  }, storePath);
  return { ...result, state: buildState(store, { now }) };
}

export async function setTaskPriority(input, storePath = DEFAULT_STORE_PATH) {
  const priority = cleanTaskPriority(input.priority, { required: true });
  const now = resolveNow(input.now);
  const { result: task, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    if (existing.priority !== priority) {
      existing.priority = priority;
      existing.updatedAt = now.toISOString();
    }
    return existing;
  }, storePath);
  return { task, state: buildState(store, { now }) };
}

export async function updateTaskTags(input, storePath = DEFAULT_STORE_PATH) {
  if (!Array.isArray(input.tags)) throw new Error('Task tags must be an array.');
  const tags = cleanTaskTags(input.tags);
  const now = resolveNow(input.now);
  const { result: task, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    if (existing.tags.join('\u0000') !== tags.join('\u0000')) {
      existing.tags = tags;
      existing.updatedAt = now.toISOString();
    }
    return existing;
  }, storePath);
  return { task, state: buildState(store, { now }) };
}

export async function setTaskSchedule(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: task, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    const schedule = normalizeTaskSchedule({
      dueDate: Object.hasOwn(input, 'dueDate') ? input.dueDate : existing.schedule.dueDate,
      startTime: Object.hasOwn(input, 'startTime') ? input.startTime : existing.schedule.startTime,
      durationMinutes: Object.hasOwn(input, 'durationMinutes')
        ? input.durationMinutes
        : existing.schedule.durationMinutes,
    });
    if (JSON.stringify(existing.schedule) !== JSON.stringify(schedule)) {
      existing.schedule = schedule;
      existing.updatedAt = now.toISOString();
    }
    return existing;
  }, storePath);
  return { task, state: buildState(store, { now }) };
}

export async function reorderTask(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const beforeTaskId = input.beforeTaskId === null || input.beforeTaskId === undefined
    ? null
    : String(input.beforeTaskId).trim();
  const { result: task, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);

    const keepParent = !Object.hasOwn(input, 'parentTaskId');
    const requestedParentId = keepParent
      ? existing.parentTaskId || null
      : input.parentTaskId === null || input.parentTaskId === undefined || input.parentTaskId === ''
        ? null
        : String(input.parentTaskId).trim();
    if (requestedParentId === existing.id) throw new Error('A task cannot be nested under itself.');

    const descendants = taskDescendants(current.tasks.items, existing.id);
    if (requestedParentId && descendants.some((task) => task.id === requestedParentId)) {
      throw new Error('A task cannot be nested under one of its own subtasks.');
    }
    const parent = requestedParentId
      ? current.tasks.items.find((candidate) => candidate.id === requestedParentId)
      : null;
    if (requestedParentId && !parent) throw new Error(`Parent task not found: ${requestedParentId}`);

    const timestamp = now.toISOString();
    const projectId = parent ? parent.projectId || null : existing.projectId || null;
    if (existing.parentTaskId !== requestedParentId) {
      existing.parentTaskId = requestedParentId;
      existing.updatedAt = timestamp;
    }
    for (const member of [existing, ...descendants]) {
      if ((member.projectId || null) === projectId) continue;
      member.projectId = projectId;
      member.updatedAt = timestamp;
    }

    const siblings = current.tasks.items
      .filter((candidate) => (candidate.parentTaskId || null) === requestedParentId && candidate.id !== existing.id)
      .sort(compareTaskOrder);
    const targetIndex = beforeTaskId === null
      ? siblings.length
      : siblings.findIndex((candidate) => candidate.id === beforeTaskId);
    if (targetIndex < 0) throw new Error(`Task position target not found: ${beforeTaskId}`);
    siblings.splice(targetIndex, 0, existing);
    for (const [index, sibling] of siblings.entries()) {
      const sortOrder = index + 1;
      if (Number(sibling.sortOrder) === sortOrder) continue;
      sibling.sortOrder = sortOrder;
      sibling.updatedAt = timestamp;
    }
    return existing;
  }, storePath);
  return { task, state: buildState(store, { now }) };
}

export async function duplicateTask(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const existing = current.tasks.items.find((candidate) => candidate.id === input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    const timestamp = now.toISOString();
    const copies = [];
    const copySubtree = (source, parentTaskId) => {
      const copy = {
        ...structuredClone(source),
        id: randomUUID(),
        parentTaskId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      copies.push(copy);
      for (const child of current.tasks.items.filter((candidate) => candidate.parentTaskId === source.id)) {
        copySubtree(child, copy.id);
      }
      return copy;
    };
    const root = copySubtree(existing, existing.parentTaskId || null);
    current.tasks.items.push(...copies);

    const siblings = current.tasks.items
      .filter((candidate) => (candidate.parentTaskId || null) === (existing.parentTaskId || null) && candidate.id !== root.id)
      .sort(compareTaskOrder);
    const targetIndex = siblings.findIndex((candidate) => candidate.id === existing.id) + 1;
    siblings.splice(targetIndex, 0, root);
    for (const [index, sibling] of siblings.entries()) {
      const sortOrder = index + 1;
      if (Number(sibling.sortOrder) === sortOrder) continue;
      sibling.sortOrder = sortOrder;
      sibling.updatedAt = timestamp;
    }
    return { task: root, copiedCount: copies.length };
  }, storePath);
  return { ...result, state: buildState(store, { now }) };
}

export async function addReadingBook(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const status = requireReadingStatus(input.status || 'to_read');
  const candidate = normalizeReadingCandidate(input.book || input, now);
  const { result: book, store } = await mutateStore((current) => {
    const duplicate = current.reading.books.find((existing) => sameReadingBook(existing, candidate));
    if (duplicate) throw new Error(`This book is already in Reading: ${duplicate.title}`);
    const next = {
      ...candidate,
      id: input.id || randomUUID(),
      status,
      sortOrder: nextReadingSortOrder(current.reading.books, status),
      addedAt: input.addedAt || now.toISOString(),
      statusChangedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    applyReadingStatusDates(next, status, now.toISOString());
    current.reading.books.push(next);
    return next;
  }, storePath);
  return { book, state: buildState(store, { now }) };
}

export async function setReadingBookStatus(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const status = requireReadingStatus(input.status);
  const { result: book, store } = await mutateStore((current) => {
    const existing = current.reading.books.find((candidate) => candidate.id === input.bookId);
    if (!existing) throw new Error(`Reading book not found: ${input.bookId}`);
    if (existing.status === status) return existing;
    existing.status = status;
    existing.sortOrder = nextReadingSortOrder(current.reading.books, status);
    existing.statusChangedAt = now.toISOString();
    existing.updatedAt = now.toISOString();
    applyReadingStatusDates(existing, status, now.toISOString());
    return existing;
  }, storePath);
  return { book, state: buildState(store, { now }) };
}

export async function reorderReadingBook(input, storePath = DEFAULT_STORE_PATH) {
  const hasPlacement = input.status !== undefined;
  const direction = input.direction === 'up' ? -1 : input.direction === 'down' ? 1 : 0;
  if (!hasPlacement && !direction) throw new Error('Reading order direction must be up or down.');
  const status = hasPlacement ? requireReadingStatus(input.status) : null;
  const beforeBookId = input.beforeBookId === null || input.beforeBookId === undefined
    ? null
    : String(input.beforeBookId).trim();
  if (hasPlacement && input.beforeBookId !== null && input.beforeBookId !== undefined && !beforeBookId) {
    throw new Error('Reading position target must be a book ID or null.');
  }
  const now = resolveNow(input.now);
  const { result: book, store } = await mutateStore((current) => {
    const existing = current.reading.books.find((candidate) => candidate.id === input.bookId);
    if (!existing) throw new Error(`Reading book not found: ${input.bookId}`);
    if (hasPlacement) {
      const previousStatus = existing.status;
      const siblings = current.reading.books
        .filter((candidate) => candidate.status === status && candidate.id !== existing.id)
        .sort(compareReadingBooks);
      const targetIndex = beforeBookId === null
        ? siblings.length
        : siblings.findIndex((candidate) => candidate.id === beforeBookId);
      if (targetIndex < 0) throw new Error(`Reading position target not found in ${status}: ${beforeBookId}`);

      siblings.splice(targetIndex, 0, existing);
      existing.status = status;
      for (const [index, sibling] of siblings.entries()) {
        const sortOrder = index + 1;
        if (Number(sibling.sortOrder) === sortOrder && sibling.status === status) continue;
        sibling.sortOrder = sortOrder;
        sibling.updatedAt = now.toISOString();
      }
      if (previousStatus !== status) {
        existing.statusChangedAt = now.toISOString();
        existing.updatedAt = now.toISOString();
        applyReadingStatusDates(existing, status, now.toISOString());
      }
      return existing;
    }

    const siblings = current.reading.books
      .filter((candidate) => candidate.status === existing.status)
      .sort(compareReadingBooks);
    const index = siblings.findIndex((candidate) => candidate.id === existing.id);
    const neighbor = siblings[index + direction];
    if (!neighbor) return existing;
    const previousOrder = existing.sortOrder;
    existing.sortOrder = neighbor.sortOrder;
    neighbor.sortOrder = previousOrder;
    existing.updatedAt = now.toISOString();
    neighbor.updatedAt = now.toISOString();
    return existing;
  }, storePath);
  return { book, state: buildState(store, { now }) };
}

export async function updateReadingBookTags(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const tags = cleanReadingTags(input.tags);
  const { result: book, store } = await mutateStore((current) => {
    const existing = current.reading.books.find((candidate) => candidate.id === input.bookId);
    if (!existing) throw new Error(`Reading book not found: ${input.bookId}`);
    existing.tags = tags;
    existing.updatedAt = now.toISOString();
    return existing;
  }, storePath);
  return { book, state: buildState(store, { now }) };
}

export async function updateReadingBookFinishedDate(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const finishedDate = requireOptionalDateOnly(input.date, 'Date read');
  const { result: book, store } = await mutateStore((current) => {
    const existing = current.reading.books.find((candidate) => candidate.id === input.bookId);
    if (!existing) throw new Error(`Reading book not found: ${input.bookId}`);
    if (existing.status !== 'finished') throw new Error('A date read can only be set for a finished book.');
    if (finishedDate && finishedDate > dateOnly(now, current.meta.timezone)) {
      throw new Error('Date read cannot be in the future.');
    }
    existing.finishedAt = finishedDate ? `${finishedDate}T12:00:00.000Z` : null;
    existing.updatedAt = now.toISOString();
    return existing;
  }, storePath);
  return { book, state: buildState(store, { now }) };
}

export async function deleteReadingBook(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: book, store } = await mutateStore((current) => {
    const index = current.reading.books.findIndex((candidate) => candidate.id === input.bookId);
    if (index === -1) throw new Error(`Reading book not found: ${input.bookId}`);
    return current.reading.books.splice(index, 1)[0];
  }, storePath);
  return { book, state: buildState(store, { now }) };
}

export function cleanLogDescription(input) {
  return String(input || '')
    .replace(/^\/?log\s+/i, '')
    .replace(/\b(spent|worked|starting|start|done|on|for)\b/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Logged work';
}

export function calculateProjectHealth(project, store, options = {}) {
  const now = resolveNow(options.now);
  const today = dateOnly(now, store.meta.timezone);
  const week = options.weekHours ?? project.weekHours ?? projectHoursForRange(project.id, store.timeEntries, rangeBounds('week', today));
  const lastTouched = options.lastTouched ?? project.lastTouched ?? latestProjectTouch(project.id, store.timeEntries);
  const since = daysSince(lastTouched, now) ?? 99;
  const due = daysUntil(project.deadline, today);
  const planned = Number(project.plannedHours || 0);
  const criticalInactiveDays = Number(store.settings.health?.criticalInactiveDays ?? 5);
  const attentionInactiveDays = Number(store.settings.health?.attentionInactiveDays ?? 2.5);

  if ((due != null && due <= 3 && (project.progress ?? 0) < 0.5) || since >= criticalInactiveDays) return 'critical';
  if (since >= attentionInactiveDays || (planned > 0 && week < planned * 0.5)) return 'attention';
  return 'healthy';
}

export function projectRiskScore(project) {
  const gap = project.plannedHours > 0
    ? Math.max(0, Number(project.plannedHours) - Number(project.weekHours || 0)) / Number(project.plannedHours)
    : 0;
  const since = Number(project.daysSinceTouched || 0);
  const due = project.dueInDays;
  return (
    Number(project.priority || 1) * 8
    + (project.health === 'critical' ? 60 : project.health === 'attention' ? 25 : 0)
    + Math.min(30, since * 4)
    + (due != null && due <= 3 ? 35 : due != null && due <= 7 ? 15 : 0)
    + gap * 20
  );
}

export function recommend(store, options = {}) {
  const projects = options.projects || hydrateProjects(store, options);
  return buildRecommendations(projects)[0] || null;
}

export function rhythmHeatmap(store, todayValue) {
  const today = todayValue || dateOnly(new Date(), store.meta.timezone);
  const dates = Array.from({ length: 14 }, (_, index) => addDays(today, index - 13));
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const minutes = Array.from({ length: 14 }, () => Array(24).fill(0));

  for (const entry of store.timeEntries) {
    if (entry.aggregation || !entry.time || !dateIndex.has(entry.date)) continue;
    const [hour, minute] = entry.time.split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
    const row = minutes[dateIndex.get(entry.date)];
    const startMinute = hour * 60 + minute;
    for (let offset = 0; offset < Number(entry.durationMinutes || 0); offset += 1) {
      const absoluteMinute = startMinute + offset;
      if (absoluteMinute >= 24 * 60) break;
      row[Math.floor(absoluteMinute / 60)] += 1;
    }
  }

  const max = Math.max(1, ...minutes.flat());
  return {
    dates,
    values: minutes.map((row) => row.map((value) => round2(value / max))),
  };
}

export function buildState(store, options = {}) {
  const copy = migrateStore(store);
  validateStore(copy);
  const now = resolveNow(options.now);
  const today = dateOnly(now, copy.meta.timezone);
  const activeRange = ['week', 'month', 'quarter', 'year'].includes(options.range) ? options.range : 'week';
  const currentWeekBounds = rangeBounds('week', today);
  const selectedBounds = rangeBounds(activeRange, today);
  const tasks = hydrateTasks(copy.tasks, copy.projects);
  const projects = hydrateProjects(copy, {
    now,
    currentWeekBounds,
    taskSummaryByProject: tasks.summary.byProject,
  });
  const recommendations = buildRecommendations(projects);
  const todayEntries = copy.timeEntries.filter((entry) => entry.date === today && !entry.aggregation);
  const currentWeekEntries = filterEntries(copy.timeEntries, currentWeekBounds);
  const rangeEntries = filterEntries(copy.timeEntries, selectedBounds);
  const actualByDomain = Object.fromEntries(Object.keys(copy.domains).map((key) => [key, 0]));
  const actualByCategory = Object.fromEntries(Object.keys(copy.categories).map((key) => [key, 0]));
  const projectsById = new Map(copy.projects.map((project) => [project.id, project]));

  for (const entry of rangeEntries) {
    const project = entry.projectId ? projectsById.get(entry.projectId) : null;
    const domainId = project?.domain || entry.domain;
    if (domainId && actualByDomain[domainId] !== undefined) {
      actualByDomain[domainId] += Number(entry.durationMinutes || 0) / 60;
    }
    for (const categoryId of entryCategoryIds(copy, entry)) {
      if (actualByCategory[categoryId] !== undefined) {
        actualByCategory[categoryId] += Number(entry.durationMinutes || 0) / 60;
      }
    }
  }
  for (const key of Object.keys(actualByDomain)) actualByDomain[key] = round1(actualByDomain[key]);
  for (const key of Object.keys(actualByCategory)) actualByCategory[key] = round1(actualByCategory[key]);

  const composition = composeEntries(rangeEntries);
  const rangeMinutes = sumMinutes(rangeEntries);
  const todayMinutes = sumMinutes(todayEntries);
  const currentWeekMinutes = sumMinutes(currentWeekEntries);
  const weeklyPlanHours = Object.values(copy.settings.weeklyPlanByDomain).reduce((sum, hours) => sum + Number(hours || 0), 0);
  const rangeDays = Math.round((parseDateOnly(selectedBounds.end) - parseDateOnly(selectedBounds.start)) / DAY_MS) + 1;
  const plannedRangeHours = round1(weeklyPlanHours * rangeDays / 7);
  const rangeHours = round1(rangeMinutes / 60);
  const deepRatio = rangeMinutes ? composition.deepMinutes / rangeMinutes : 0;
  const activeCount = projects.filter((project) => ACTIVE_PROJECT_STATUSES.has(project.status)).length;
  const criticalCount = projects.filter((project) => ACTIVE_PROJECT_STATUSES.has(project.status) && project.health === 'critical').length;
  const monthBounds = rangeBounds('month', today);
  const yearBounds = rangeBounds('year', today);
  const challenge = hydrateChallenge(copy.challenge, copy.timeEntries, today);
  const reading = hydrateReading(copy.reading);

  return {
    ...copy,
    meta: {
      ...copy.meta,
      today,
      now: now.toISOString(),
      weekNumber: isoWeekNumber(today),
      issueNumber: dayOfYear(today),
    },
    projects,
    todayEntries,
    recommendations,
    recommendation: recommendations[0] || null,
    rhythmHeatmap: rhythmHeatmap(copy, today),
    challenge,
    reading,
    tasks,
    milestones: [...(copy.milestones || [])].sort((a, b) => b.date.localeCompare(a.date)),
    weekByDay: buildWeekByDay(currentWeekEntries, currentWeekBounds.start),
    summary: {
      activeCount,
      criticalCount,
      todayMinutes,
      todayLabel: formatMinutes(todayMinutes),
      currentWeekHours: round1(currentWeekMinutes / 60),
      currentWeekLabel: formatMinutes(currentWeekMinutes),
      range: activeRange,
      rangeLabel: rangeLabels(today)[activeRange],
      totalRangeHours: rangeHours,
      totalRangeLabel: formatMinutes(rangeMinutes),
      plannedRangeHours,
      plannedRangeLabel: formatHours(plannedRangeHours),
      deepRatio: round2(deepRatio),
      onPlan: plannedRangeHours ? Math.round(rangeHours / plannedRangeHours * 100) : 0,
    },
    analytics: {
      range: activeRange,
      bounds: selectedBounds,
      labels: rangeLabels(today),
      actualByDomain,
      actualByCategory,
      composition: {
        deep: round1(composition.deepMinutes / 60),
        shallow: round1(composition.shallowMinutes / 60),
        admin: round1(composition.adminMinutes / 60),
      },
      productionConsumption: productionConsumption(rangeEntries),
      deepWork: {
        monthMinutes: deepWorkMinutes(filterEntries(copy.timeEntries, monthBounds)),
        yearMinutes: deepWorkMinutes(filterEntries(copy.timeEntries, yearBounds)),
      },
      note: analyticsNote(deepRatio, copy.settings.deepTarget, rangeHours, plannedRangeHours),
    },
  };
}

export async function getState(storePath = DEFAULT_STORE_PATH, options = {}) {
  return buildState(await readStore(storePath), options);
}

function resolveNow(value) {
  const now = value ? new Date(value) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid current time: ${value}`);
  return now;
}

function hydrateTasks(tasks, projects) {
  const items = [...tasks.items];
  const childrenByParent = new Map();
  for (const task of items) {
    const key = task.parentTaskId || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(task);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(compareTasks);

  const hydratedById = new Map();
  const hydrate = (task, depth) => {
    const children = (childrenByParent.get(task.id) || []).map((child) => hydrate(child, depth + 1));
    const subtreeTotal = 1 + children.reduce((sum, child) => sum + child.subtreeTotal, 0);
    const subtreeCompleted = (task.status === 'completed' ? 1 : 0)
      + children.reduce((sum, child) => sum + child.subtreeCompleted, 0);
    const hydrated = {
      ...task,
      depth,
      childIds: children.map((child) => child.id),
      directSubtaskCount: children.length,
      subtreeTotal,
      subtreeCompleted,
      progress: round2(subtreeCompleted / subtreeTotal),
    };
    hydratedById.set(task.id, hydrated);
    return hydrated;
  };
  const roots = (childrenByParent.get(null) || []).map((task) => hydrate(task, 0));
  const ordered = [];
  const append = (task) => {
    ordered.push(task);
    for (const childId of task.childIds) append(hydratedById.get(childId));
  };
  for (const root of roots) append(root);

  const byProject = Object.fromEntries(projects.map((project) => [project.id, summarizeTasks(
    items.filter((task) => task.projectId === project.id),
  )]));
  return {
    ...tasks,
    items: ordered,
    summary: {
      ...summarizeTasks(items),
      inbox: summarizeTasks(items.filter((task) => task.projectId == null)),
      byProject,
    },
  };
}

function summarizeTasks(items) {
  const total = items.length;
  const completed = items.filter((task) => task.status === 'completed').length;
  return {
    total,
    open: total - completed,
    completed,
    progress: total ? round2(completed / total) : 0,
  };
}

function hydrateReading(reading) {
  const books = [...reading.books].sort((a, b) => {
    const statusDelta = READING_STATUS_ORDER[a.status] - READING_STATUS_ORDER[b.status];
    return statusDelta || compareReadingBooks(a, b);
  });
  const byStatus = Object.fromEntries(READING_STATUSES.map((status) => [status, 0]));
  for (const book of books) byStatus[book.status] += 1;
  return {
    ...reading,
    books,
    summary: {
      total: books.length,
      boardTotal: byStatus.next_up + byStatus.reading + byStatus.finished,
      byStatus,
    },
  };
}

function normalizeReadingCandidate(input, now) {
  const title = cleanReadingText(input.title, 300);
  if (!title) throw new Error('A book title is required.');
  const authors = cleanReadingList(input.authors, 12, 180);
  const source = input.source && typeof input.source === 'object' ? {
    provider: cleanReadingText(input.source.provider, 80) || 'manual',
    workId: cleanReadingText(input.source.workId, 100) || null,
    editionId: cleanReadingText(input.source.editionId, 100) || null,
    url: cleanHttpsUrl(input.source.url),
    fetchedAt: cleanReadingText(input.source.fetchedAt, 80) || now.toISOString(),
  } : { provider: 'manual', workId: null, editionId: null, url: null, fetchedAt: now.toISOString() };
  const pageCount = Number(input.pageCount);
  const publishedYear = Number(input.publishedYear);
  return {
    title,
    subtitle: cleanReadingText(input.subtitle, 400) || null,
    authors,
    description: cleanReadingText(input.description, 12_000) || null,
    coverUrl: cleanHttpsUrl(input.coverUrl),
    isbn10: cleanIdentifier(input.isbn10, 10),
    isbn13: cleanIdentifier(input.isbn13, 13),
    publisher: cleanReadingText(input.publisher, 300) || null,
    publishedYear: Number.isInteger(publishedYear) && publishedYear > 0 ? publishedYear : null,
    language: cleanReadingText(input.language, 30) || null,
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? Math.round(pageCount) : null,
    subjects: cleanReadingList(input.subjects, 12, 120),
    tags: cleanReadingTags(input.tags),
    source,
  };
}

function sameReadingBook(existing, candidate) {
  if (candidate.source.workId && existing.source?.workId === candidate.source.workId) return true;
  if (candidate.isbn13 && existing.isbn13 === candidate.isbn13) return true;
  if (candidate.isbn10 && existing.isbn10 === candidate.isbn10) return true;
  return normalizeText(existing.title) === normalizeText(candidate.title)
    && normalizeText(existing.authors?.[0]) === normalizeText(candidate.authors?.[0]);
}

function requireProjectStatus(value) {
  if (!PROJECT_STATUSES.includes(value)) throw new Error(`Unknown project status: ${value}`);
  return value;
}

function requireReadingStatus(value) {
  if (!READING_STATUSES.includes(value)) throw new Error(`Unknown reading status: ${value}`);
  return value;
}

function requireOptionalDateOnly(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${label} must be a real calendar date.`);
  }
  return date;
}

function requireOptionalTime(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const time = String(value).trim();
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`${label} must use HH:MM.`);
  }
  return time;
}

function requireOptionalTaskDuration(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 10_080) {
    throw new Error(`${label} must be a whole number from 1 to 10080 minutes.`);
  }
  return duration;
}

function cleanTaskTitle(value) {
  const title = String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  if (!title) throw new Error('A task title is required.');
  return title;
}

function cleanTaskPriority(value, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`Task priority must be one of ${TASK_PRIORITIES.join(', ')}.`);
    return 'none';
  }
  const priority = String(value).trim().toLowerCase();
  if (!TASK_PRIORITIES.includes(priority)) {
    throw new Error(`Task priority must be one of ${TASK_PRIORITIES.join(', ')}.`);
  }
  return priority;
}

function cleanTaskTags(value) {
  if (!Array.isArray(value)) return [];
  const tags = [];
  const seen = new Set();
  for (const item of value) {
    const tag = String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const normalized = normalizeText(tag);
    if (!tag || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(tag);
    if (tags.length === MAX_TASK_TAGS) break;
  }
  return tags;
}

function cleanTaskNotes(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .slice(0, 20_000);
}

function normalizeTaskSchedule(input) {
  const source = input.schedule && typeof input.schedule === 'object' && !Array.isArray(input.schedule)
    ? input.schedule
    : input;
  const dueDate = requireOptionalDateOnly(source.dueDate, 'Task due date');
  const startTime = requireOptionalTime(source.startTime, 'Task start time');
  const durationMinutes = requireOptionalTaskDuration(source.durationMinutes, 'Task duration');
  if (startTime && !dueDate) throw new Error('A task start time requires a due date.');
  if (source.recurrence !== null && source.recurrence !== undefined) {
    throw new Error('Recurring tasks are reserved for a future release.');
  }
  return { dueDate, startTime, durationMinutes, recurrence: null };
}

function applyReadingStatusDates(book, status, timestamp) {
  if (status === 'reading' && !book.startedAt) book.startedAt = timestamp;
  if (status === 'finished' && !book.finishedAt) book.finishedAt = timestamp;
  if (status === 'dropped' && !book.droppedAt) book.droppedAt = timestamp;
}

function nextReadingSortOrder(books, status) {
  return Math.max(0, ...books.filter((book) => book.status === status).map((book) => Number(book.sortOrder) || 0)) + 1;
}

function compareReadingBooks(a, b) {
  const orderDelta = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  return orderDelta || a.title.localeCompare(b.title);
}

function cleanReadingText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function cleanReadingList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanReadingText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function cleanReadingTags(value) {
  if (!Array.isArray(value)) return [];
  const tags = [];
  const seen = new Set();
  for (const item of value) {
    const tag = cleanReadingText(item, 40).replace(/\s+/g, ' ');
    const normalized = normalizeText(tag);
    if (!tag || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(tag);
    if (tags.length === 24) break;
  }
  return tags;
}

function cleanIdentifier(value, length) {
  const identifier = String(value || '').replace(/[^0-9X]/gi, '').toUpperCase();
  return identifier.length === length ? identifier : null;
}

function cleanHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function projectMatches(store, query) {
  const needle = normalizeText(query);
  if (!needle || ['inbox', 'email', 'emails', 'admin', 'scheduling', 'general'].includes(needle)) return [];
  const exact = store.projects.filter((project) => normalizeText(project.name) === needle || normalizeText(project.id) === needle);
  if (exact.length) return exact;
  const contained = store.projects.filter((project) => {
    const values = [project.name, project.subtitle, project.id].map(normalizeText);
    return values.some((value) => value.includes(needle)) || needle.includes(normalizeText(project.name));
  });
  return contained.sort((a, b) => normalizeText(a.name).length - normalizeText(b.name).length);
}

function taskMatches(store, query) {
  const needle = normalizeText(query);
  if (!needle) return [];
  const tasks = store.tasks?.items || [];
  const exact = tasks.filter((task) => normalizeText(task.id) === needle || normalizeText(task.title) === needle);
  if (exact.length) return exact;
  return tasks
    .filter((task) => normalizeText(task.title).includes(needle))
    .sort((a, b) => normalizeText(a.title).length - normalizeText(b.title).length);
}

function normalizeTaskProjectId(store, value) {
  if (value === null || value === undefined || value === '') return null;
  const projectId = String(value).trim();
  if (!store.projects.some((project) => project.id === projectId)) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return projectId;
}

function taskDescendants(items, taskId) {
  const descendants = [];
  const queue = items.filter((task) => task.parentTaskId === taskId);
  while (queue.length) {
    const task = queue.shift();
    descendants.push(task);
    queue.push(...items.filter((candidate) => candidate.parentTaskId === task.id));
  }
  return descendants;
}

function nextTaskSortOrder(items, parentTaskId) {
  return Math.max(
    0,
    ...items
      .filter((task) => (task.parentTaskId || null) === (parentTaskId || null))
      .map((task) => Number(task.sortOrder) || 0),
  ) + 1;
}

function compareTasks(a, b) {
  const statusDelta = TASK_STATUS_ORDER[a.status] - TASK_STATUS_ORDER[b.status];
  return statusDelta || compareTaskOrder(a, b);
}

function compareTaskOrder(a, b) {
  const orderDelta = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  return orderDelta || a.title.localeCompare(b.title);
}

function resolveProjectForEntry(store, input) {
  if (input.projectId) {
    const project = store.projects.find((candidate) => candidate.id === input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    return project;
  }
  if (input.project) {
    const matches = projectMatches(store, input.project);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Ambiguous project: ${input.project}. Matches: ${matches.map((item) => item.name).join(', ')}`);
    throw new Error(`Project not found: ${input.project}`);
  }
  return inferProjectFromText(store, input.rawInput ?? input.description);
}

function entryTimestamp(entry) {
  const candidate = entry.createdAt || `${entry.date}T${entry.time || '12:00'}:00Z`;
  const value = new Date(candidate).getTime();
  return Number.isFinite(value) ? value : parseDateOnly(entry.date);
}

function latestProjectTouch(projectId, entries) {
  const relevant = entries.filter((entry) => entry.projectId === projectId);
  if (!relevant.length) return null;
  const latest = relevant.reduce((current, entry) => entryTimestamp(entry) > entryTimestamp(current) ? entry : current);
  return latest.createdAt || `${latest.date}T${latest.time || '12:00'}:00Z`;
}

function entryCategoryIds(store, entry) {
  const project = entry.projectId
    ? store.projects.find((candidate) => candidate.id === entry.projectId)
    : null;
  return [...new Set([...(entry.categoryIds || []), ...(project?.categoryIds || [])])];
}

function hydrateProjects(store, options = {}) {
  const now = resolveNow(options.now);
  const today = dateOnly(now, store.meta.timezone);
  const currentWeekBounds = options.currentWeekBounds || rangeBounds('week', today);
  return store.projects.map((project) => {
    const weekHours = projectHoursForRange(project.id, store.timeEntries, currentWeekBounds);
    const lastTouched = latestProjectTouch(project.id, store.timeEntries);
    const daysSinceTouched = daysSince(lastTouched, now) ?? 99;
    const health = calculateProjectHealth(project, store, { now, weekHours, lastTouched });
    return {
      ...project,
      categoryLabels: project.categoryIds.map((categoryId) => store.categories[categoryId].label),
      health,
      dueInDays: daysUntil(project.deadline, today),
      lastTouched,
      daysSinceTouched: round1(daysSinceTouched),
      lastTouchedLabel: formatAgo(lastTouched, now),
      weekHours: round1(weekHours),
      weekHoursLabel: weekHours ? formatHours(weekHours) : '-',
      streak: projectStreak(project.id, store.timeEntries, today),
      weekHistory: projectWeekHistory(project.id, store.timeEntries, today),
      taskSummary: options.taskSummaryByProject?.[project.id] || summarizeTasks([]),
    };
  }).sort((a, b) => {
    const healthDelta = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    return healthDelta || b.priority - a.priority || a.name.localeCompare(b.name);
  });
}

function buildRecommendations(projects) {
  const ranked = projects
    .filter((project) => ACTIVE_PROJECT_STATUSES.has(project.status))
    .map((project) => ({ project, score: projectRiskScore(project) }))
    .sort((a, b) => b.score - a.score);

  return ranked.map(({ project, score }, index) => {
    const durationMinutes = project.health === 'critical' && project.priority >= 5 ? 90 : project.health === 'healthy' ? 45 : 60;
    const dueText = project.dueInDays == null ? 'no hard deadline' : project.dueInDays < 0 ? `${Math.abs(project.dueInDays)}d overdue` : `due in ${project.dueInDays}d`;
    const action = project.nextAction || `Put ${durationMinutes} focused minutes into ${project.name}.`;
    return {
      projectId: project.id,
      projectName: project.name,
      domain: project.domain,
      durationMinutes,
      confidence: round2(Math.min(0.95, 0.62 + score / 240)),
      rank: index + 1,
      action,
      reasonShort: `${project.lastTouchedLabel} - ${dueText}`,
      reasonLong: `${project.name} is currently the highest-value intervention at this rank: ${project.lastTouchedLabel}, ${dueText}, and ${formatHours(project.weekHours)} logged against a ${formatHours(project.plannedHours)} weekly plan.`,
    };
  }).map((item, index, all) => ({
    ...item,
    alternatives: all.filter((_, candidateIndex) => candidateIndex !== index).slice(0, 2).map((candidate) => ({
      projectId: candidate.projectId,
      projectName: candidate.projectName,
      durationMinutes: candidate.durationMinutes,
      why: candidate.reasonShort,
    })),
  }));
}

function rangeBounds(range, today) {
  const [year, month] = today.split('-').map(Number);
  if (range === 'week') {
    const start = startOfWeek(today);
    return { start, end: addDays(start, 6) };
  }
  if (range === 'month') {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { start, end };
  }
  if (range === 'quarter') {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    const start = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(year, quarterStartMonth + 2, 0)).toISOString().slice(0, 10);
    return { start, end };
  }
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function filterEntries(entries, bounds) {
  return entries.filter((entry) => entry.date >= bounds.start && entry.date <= bounds.end);
}

function projectHoursForRange(projectId, entries, bounds) {
  return round1(sumMinutes(filterEntries(entries, bounds).filter((entry) => entry.projectId === projectId)) / 60);
}

function projectWeekHistory(projectId, entries, today) {
  const currentStart = startOfWeek(today);
  return Array.from({ length: 8 }, (_, index) => {
    const start = addDays(currentStart, (index - 7) * 7);
    const end = addDays(start, 6);
    return projectHoursForRange(projectId, entries, { start, end });
  });
}

function projectStreak(projectId, entries, today) {
  const minutesByDay = new Map();
  for (const entry of entries) {
    if (entry.projectId !== projectId || entry.aggregation) continue;
    minutesByDay.set(entry.date, (minutesByDay.get(entry.date) || 0) + Number(entry.durationMinutes || 0));
  }
  let cursor = today;
  if ((minutesByDay.get(cursor) || 0) < 30) cursor = addDays(cursor, -1);
  let streak = 0;
  while ((minutesByDay.get(cursor) || 0) >= 30) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function composeEntries(entries) {
  return entries.reduce((acc, entry) => {
    const minutes = Number(entry.durationMinutes || 0);
    if (['deep_work', 'research', 'creative'].includes(entry.activityType)) acc.deepMinutes += minutes;
    else if (['shallow_work', 'communication'].includes(entry.activityType)) acc.shallowMinutes += minutes;
    else acc.adminMinutes += minutes;
    return acc;
  }, { deepMinutes: 0, shallowMinutes: 0, adminMinutes: 0 });
}

function productionConsumption(entries) {
  let productionMinutes = 0;
  let consumptionMinutes = 0;
  let supportMinutes = 0;
  for (const entry of entries) {
    const minutes = Number(entry.durationMinutes || 0);
    if (['creative', 'deep_work', 'communication'].includes(entry.activityType)) productionMinutes += minutes;
    else if (entry.activityType === 'research') consumptionMinutes += minutes;
    else supportMinutes += minutes;
  }
  const compared = productionMinutes + consumptionMinutes;
  return {
    productionHours: round1(productionMinutes / 60),
    consumptionHours: round1(consumptionMinutes / 60),
    supportHours: round1(supportMinutes / 60),
    productionPct: compared ? Math.round(productionMinutes / compared * 100) : 0,
    consumptionPct: compared ? Math.round(consumptionMinutes / compared * 100) : 0,
  };
}

function deepWorkMinutes(entries) {
  return entries
    .filter((entry) => ['deep_work', 'research', 'creative'].includes(entry.activityType) && Number(entry.durationMinutes) >= 45)
    .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
}

function buildWeekByDay(entries, weekStartDate) {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return names.map((day, index) => {
    const composition = composeEntries(entries.filter((entry) => entry.date === addDays(weekStartDate, index)));
    return {
      day,
      deep: round1(composition.deepMinutes / 60),
      shallow: round1(composition.shallowMinutes / 60),
      admin: round1(composition.adminMinutes / 60),
    };
  });
}

function hydrateChallenge(challenge, entries, today) {
  if (!challenge) return null;
  const matches = entries.filter((entry) => (
    !entry.aggregation
    && entry.projectId === challenge.projectId
    && entry.date >= challenge.startDate
    && entry.date <= challenge.endDate
    && Number(entry.durationMinutes || 0) >= Number(challenge.minDurationMinutes || 0)
    && (!challenge.activityTypes?.length || challenge.activityTypes.includes(entry.activityType))
  ));
  return {
    ...challenge,
    progress: Math.min(Number(challenge.target || 0), matches.length),
    daysLeft: Math.max(0, daysUntil(challenge.endDate, today)),
  };
}

function rangeLabels(today) {
  const date = new Date(`${today}T12:00:00Z`);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
  const monthNumber = Number(today.slice(5, 7));
  return {
    week: `Week ${isoWeekNumber(today)}`,
    month,
    quarter: `Q${Math.floor((monthNumber - 1) / 3) + 1}`,
    year: today.slice(0, 4),
  };
}

function analyticsNote(deepRatio, target, actualHours, plannedHours) {
  const ratioDelta = Math.round((deepRatio - Number(target || 0)) * 100);
  const planDelta = round1(actualHours - plannedHours);
  const ratioText = ratioDelta >= 0
    ? `Deep work is ${ratioDelta} points above target.`
    : `Deep work is ${Math.abs(ratioDelta)} points below target.`;
  const planText = planDelta >= 0
    ? `Tracked time is ${formatHours(planDelta)} ahead of plan.`
    : `Tracked time is ${formatHours(Math.abs(planDelta))} below plan.`;
  return `${ratioText} ${planText}`;
}

function sumMinutes(entries) {
  return entries.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
}

function isoWeekNumber(dateValue) {
  const date = new Date(parseDateOnly(dateValue));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
}

function dayOfYear(dateValue) {
  const year = Number(dateValue.slice(0, 4));
  return Math.floor((parseDateOnly(dateValue) - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
}

async function acquireStoreLock(storePath) {
  const lockPath = `${storePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, 'utf8');
      return async () => {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
  }
  throw new Error('LifeOS data is busy. Try again in a moment.');
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
