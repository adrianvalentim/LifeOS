import { randomUUID } from 'node:crypto';
import { copyFile, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_STORE_PATH = path.join(ROOT_DIR, 'data', 'lifeos.json');
export const ACTIVITY_TYPES = [
  'deep_work',
  'shallow_work',
  'admin',
  'research',
  'creative',
  'communication',
];

const HEALTH_ORDER = { critical: 0, attention: 1, healthy: 2 };
const DAY_MS = 86_400_000;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export async function readStore(storePath = DEFAULT_STORE_PATH) {
  const raw = await readFile(storePath, 'utf8');
  let store;
  try {
    store = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LifeOS data is not valid JSON: ${error.message}`);
  }
  validateStore(store);
  return store;
}

export async function writeStore(store, storePath = DEFAULT_STORE_PATH) {
  validateStore(store);
  const directory = path.dirname(storePath);
  const filename = path.basename(storePath);
  const tempPath = path.join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  const backupPath = `${storePath}.bak`;

  try {
    await copyFile(storePath, backupPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
  const release = await acquireStoreLock(storePath);
  try {
    const store = await readStore(storePath);
    const result = await mutator(store);
    await writeStore(store, storePath);
    return { result, store };
  } finally {
    await release();
  }
}

export function validateStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('LifeOS data must be a JSON object.');
  }
  if (!store.meta || !store.meta.timezone) throw new Error('LifeOS data requires meta.timezone.');
  if (!store.domains || typeof store.domains !== 'object') throw new Error('LifeOS data requires domains.');
  if (!store.settings?.weeklyPlanByDomain) throw new Error('LifeOS data requires settings.weeklyPlanByDomain.');
  if (!Array.isArray(store.projects)) throw new Error('LifeOS data requires a projects array.');
  if (!Array.isArray(store.timeEntries)) throw new Error('LifeOS data requires a timeEntries array.');

  const projectIds = new Set();
  for (const project of store.projects) {
    if (!project?.id || !project.name || !project.domain) throw new Error('Every project needs id, name, and domain.');
    if (projectIds.has(project.id)) throw new Error(`Duplicate project id: ${project.id}`);
    if (!store.domains[project.domain]) throw new Error(`Unknown domain on ${project.name}: ${project.domain}`);
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
    if (!ACTIVITY_TYPES.includes(entry.activityType)) {
      throw new Error(`Time entry ${entry.id} has unknown activity type ${entry.activityType}.`);
    }
    entryIds.add(entry.id);
  }
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

  return {
    id: input.id || randomUUID(),
    projectId: project?.id || null,
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
  validateStore(store);
  const copy = structuredClone(store);
  const now = resolveNow(options.now);
  const today = dateOnly(now, copy.meta.timezone);
  const activeRange = ['week', 'month', 'quarter', 'year'].includes(options.range) ? options.range : 'week';
  const currentWeekBounds = rangeBounds('week', today);
  const selectedBounds = rangeBounds(activeRange, today);
  const projects = hydrateProjects(copy, { now, currentWeekBounds });
  const recommendations = buildRecommendations(projects);
  const todayEntries = copy.timeEntries.filter((entry) => entry.date === today && !entry.aggregation);
  const currentWeekEntries = filterEntries(copy.timeEntries, currentWeekBounds);
  const rangeEntries = filterEntries(copy.timeEntries, selectedBounds);
  const actualByDomain = Object.fromEntries(Object.keys(copy.domains).map((key) => [key, 0]));

  for (const entry of rangeEntries) {
    const project = entry.projectId ? copy.projects.find((candidate) => candidate.id === entry.projectId) : null;
    if (project && actualByDomain[project.domain] !== undefined) {
      actualByDomain[project.domain] += Number(entry.durationMinutes || 0) / 60;
    }
  }
  for (const key of Object.keys(actualByDomain)) actualByDomain[key] = round1(actualByDomain[key]);

  const composition = composeEntries(rangeEntries);
  const rangeMinutes = sumMinutes(rangeEntries);
  const todayMinutes = sumMinutes(todayEntries);
  const currentWeekMinutes = sumMinutes(currentWeekEntries);
  const weeklyPlanHours = Object.values(copy.settings.weeklyPlanByDomain).reduce((sum, hours) => sum + Number(hours || 0), 0);
  const rangeDays = Math.round((parseDateOnly(selectedBounds.end) - parseDateOnly(selectedBounds.start)) / DAY_MS) + 1;
  const plannedRangeHours = round1(weeklyPlanHours * rangeDays / 7);
  const rangeHours = round1(rangeMinutes / 60);
  const deepRatio = rangeMinutes ? composition.deepMinutes / rangeMinutes : 0;
  const activeCount = projects.filter((project) => project.status === 'active').length;
  const criticalCount = projects.filter((project) => project.status === 'active' && project.health === 'critical').length;
  const monthBounds = rangeBounds('month', today);
  const yearBounds = rangeBounds('year', today);
  const challenge = hydrateChallenge(copy.challenge, copy.timeEntries, today);

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
      health,
      dueInDays: daysUntil(project.deadline, today),
      lastTouched,
      daysSinceTouched: round1(daysSinceTouched),
      lastTouchedLabel: formatAgo(lastTouched, now),
      weekHours: round1(weekHours),
      weekHoursLabel: weekHours ? formatHours(weekHours) : '-',
      streak: projectStreak(project.id, store.timeEntries, today),
      weekHistory: projectWeekHistory(project.id, store.timeEntries, today),
    };
  }).sort((a, b) => {
    const healthDelta = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    return healthDelta || b.priority - a.priority || a.name.localeCompare(b.name);
  });
}

function buildRecommendations(projects) {
  const ranked = projects
    .filter((project) => project.status === 'active')
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
