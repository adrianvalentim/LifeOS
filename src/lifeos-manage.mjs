// Management operations that complete the product: creating and editing
// projects, correcting time entries, and editing the planning model (domains,
// categories, settings, milestones and the challenge). Every write uses the
// same locked, validated, atomic store transaction as the rest of LifeOS.
import { randomUUID } from 'node:crypto';
import {
  ACTIVITY_TYPES,
  DEFAULT_STORE_PATH,
  PROJECT_STATUSES,
  buildValidatedState,
  cleanHttpsUrl,
  cleanIdentifier,
  cleanReadingList,
  cleanReadingTags,
  cleanReadingText,
  dateOnly,
  ensureCategory,
  mutateStore,
  normalizeText,
  requireOptionalDateOnly,
  requireOptionalTime,
  resolveNow,
} from './lifeos-data.mjs';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function slug(value, fallback) {
  return normalizeText(value).replaceAll(' ', '-').slice(0, 48) || fallback;
}

function uniqueId(base, taken) {
  let id = base;
  let suffix = 2;
  while (taken.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function cleanLine(value, max, label, { required = false } = {}) {
  const text = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

function cleanBlock(value, max, label) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n');
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text;
}

function cleanNumber(value, { min, max, label, integer = false, nullable = false }) {
  if (nullable && (value === null || value === '' || value === undefined)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
  }
  return number;
}

function requireDomain(store, value) {
  const domain = String(value ?? '').trim();
  if (!store.domains[domain]) throw new Error(`Unknown domain: ${domain || '(none)'}.`);
  return domain;
}

function resolveCategoryIds(store, input) {
  const ids = [];
  for (const id of input.categoryIds || []) {
    if (!store.categories[id]) throw new Error(`Unknown category: ${id}.`);
    ids.push(id);
  }
  for (const label of input.categories || []) ids.push(ensureCategory(store, label).id);
  const unique = [...new Set(ids)];
  if (unique.length > 12) throw new Error('A project can have at most 12 categories.');
  return unique;
}

function findProjectIndex(store, projectId) {
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error(`Project not found: ${projectId}`);
  return index;
}

const PROJECT_FIELDS = ['name', 'subtitle', 'domain', 'status', 'priority', 'plannedHours', 'deadline', 'progress', 'note', 'nextAction'];

function applyProjectFields(store, project, input) {
  if (Object.hasOwn(input, 'name')) project.name = cleanLine(input.name, 120, 'Project name', { required: true });
  if (Object.hasOwn(input, 'subtitle')) project.subtitle = cleanLine(input.subtitle, 160, 'Subtitle');
  if (Object.hasOwn(input, 'domain')) project.domain = requireDomain(store, input.domain);
  if (Object.hasOwn(input, 'priority')) project.priority = cleanNumber(input.priority, { min: 1, max: 5, integer: true, label: 'Priority' });
  if (Object.hasOwn(input, 'plannedHours')) project.plannedHours = cleanNumber(input.plannedHours, { min: 0, max: 168, label: 'Weekly planned hours' });
  if (Object.hasOwn(input, 'deadline')) project.deadline = requireOptionalDateOnly(input.deadline, 'Deadline');
  if (Object.hasOwn(input, 'progress')) project.progress = cleanNumber(input.progress, { min: 0, max: 1, label: 'Progress', nullable: true });
  if (Object.hasOwn(input, 'note')) project.note = cleanBlock(input.note, 4000, 'Note');
  if (Object.hasOwn(input, 'nextAction')) {
    const nextAction = cleanLine(input.nextAction, 300, 'Next action');
    if (nextAction) project.nextAction = nextAction;
    else delete project.nextAction;
  }
  if (Object.hasOwn(input, 'categoryIds') || Object.hasOwn(input, 'categories')) {
    project.categoryIds = resolveCategoryIds(store, input);
  }
}

export async function createProject(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: project, store } = await mutateStore((current) => {
    const name = cleanLine(input.name, 120, 'Project name', { required: true });
    if (current.projects.some((project) => normalizeText(project.name) === normalizeText(name))) {
      throw new Error(`A project named ${name} already exists.`);
    }
    const status = input.status ?? 'to_do';
    if (!PROJECT_STATUSES.includes(status)) throw new Error(`Unknown project status: ${status}`);
    const timestamp = now.toISOString();
    const project = {
      id: uniqueId(slug(name, 'project'), new Set(current.projects.map((item) => item.id))),
      name,
      subtitle: '',
      domain: input.domain ? requireDomain(current, input.domain) : Object.keys(current.domains)[0],
      categoryIds: [],
      status,
      priority: 3,
      plannedHours: 0,
      deadline: null,
      progress: null,
      note: '',
      createdAt: timestamp,
      statusChangedAt: timestamp,
    };
    if (!project.domain) throw new Error('Create a domain before creating a project.');
    applyProjectFields(current, project, { ...input, name });
    current.projects.push(project);
    return project;
  }, storePath);
  return { project, state: buildValidatedState(store, { now }) };
}

export async function updateProject(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  if (![...PROJECT_FIELDS, 'categoryIds', 'categories'].some((key) => Object.hasOwn(input, key))) {
    throw new Error('A project update requires at least one field.');
  }
  const { result: project, store } = await mutateStore((current) => {
    const project = current.projects[findProjectIndex(current, input.projectId)];
    if (Object.hasOwn(input, 'name')) {
      const name = cleanLine(input.name, 120, 'Project name', { required: true });
      if (current.projects.some((other) => other.id !== project.id && normalizeText(other.name) === normalizeText(name))) {
        throw new Error(`A project named ${name} already exists.`);
      }
    }
    applyProjectFields(current, project, input);
    if (Object.hasOwn(input, 'status') && input.status !== project.status) {
      if (!PROJECT_STATUSES.includes(input.status)) throw new Error(`Unknown project status: ${input.status}`);
      project.status = input.status;
      project.statusChangedAt = now.toISOString();
    }
    return project;
  }, storePath);
  return { project, state: buildValidatedState(store, { now }) };
}

export async function removeProjectCategory(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: project, store } = await mutateStore((current) => {
    const project = current.projects[findProjectIndex(current, input.projectId)];
    project.categoryIds = project.categoryIds.filter((id) => id !== input.categoryId);
    return project;
  }, storePath);
  return { project, state: buildValidatedState(store, { now }) };
}

export async function updateTimeEntry(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: entry, store } = await mutateStore((current) => {
    const entry = current.timeEntries.find((item) => item.id === input.entryId);
    if (!entry) throw new Error(`Time entry not found: ${input.entryId}`);
    if (Object.hasOwn(input, 'date')) {
      const date = requireOptionalDateOnly(input.date, 'Entry date');
      if (!date) throw new Error('An entry date is required.');
      entry.date = date;
    }
    if (Object.hasOwn(input, 'time')) entry.time = requireOptionalTime(input.time, 'Entry time');
    if (Object.hasOwn(input, 'durationMinutes')) {
      entry.durationMinutes = cleanNumber(input.durationMinutes, { min: 1, max: 1440, integer: true, label: 'Duration (minutes)' });
    }
    if (Object.hasOwn(input, 'activityType')) {
      if (!ACTIVITY_TYPES.includes(input.activityType)) throw new Error(`Unknown activity type: ${input.activityType}`);
      entry.activityType = input.activityType;
    }
    if (Object.hasOwn(input, 'description')) {
      entry.description = cleanLine(input.description, 500, 'Description') || 'Logged work';
    }
    if (Object.hasOwn(input, 'projectId')) {
      if (input.projectId === null || input.projectId === '') {
        entry.projectId = null;
      } else {
        const project = current.projects.find((item) => item.id === input.projectId);
        if (!project) throw new Error(`Project not found: ${input.projectId}`);
        entry.projectId = project.id;
        delete entry.domain;
      }
    }
    if (Object.hasOwn(input, 'categoryIds')) {
      for (const id of input.categoryIds) if (!current.categories[id]) throw new Error(`Unknown category: ${id}.`);
      entry.categoryIds = [...new Set(input.categoryIds)];
    }
    return entry;
  }, storePath);
  return { entry, state: buildValidatedState(store, { now }) };
}

export async function deleteTimeEntry(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: entry, store } = await mutateStore((current) => {
    const index = current.timeEntries.findIndex((item) => item.id === input.entryId);
    if (index < 0) throw new Error(`Time entry not found: ${input.entryId}`);
    return current.timeEntries.splice(index, 1)[0];
  }, storePath);
  return { entry, state: buildValidatedState(store, { now }) };
}

function domainFields(input, existing = {}) {
  const domain = { ...existing };
  if (Object.hasOwn(input, 'label') || !existing.label) domain.label = cleanLine(input.label, 40, 'Domain name', { required: true });
  if (Object.hasOwn(input, 'short') || !existing.short) {
    domain.short = cleanLine(input.short || domain.label.slice(0, 4), 8, 'Short label').toUpperCase() || domain.label.slice(0, 4).toUpperCase();
  }
  if (Object.hasOwn(input, 'color') || !existing.color) {
    const color = String(input.color || '#8a6f4e').trim();
    if (!HEX_COLOR.test(color)) throw new Error('Domain color must be a #RRGGBB hex color.');
    domain.color = color.toLowerCase();
  }
  return domain;
}

export async function createDomain(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const fields = domainFields(input);
    if (Object.values(current.domains).some((domain) => normalizeText(domain.label) === normalizeText(fields.label))) {
      throw new Error(`A domain named ${fields.label} already exists.`);
    }
    const id = uniqueId(slug(fields.label, 'domain'), new Set(Object.keys(current.domains)));
    current.domains[id] = fields;
    current.settings.weeklyPlanByDomain[id] = cleanNumber(input.weeklyHours ?? 0, { min: 0, max: 168, label: 'Weekly plan' });
    return { id, ...fields };
  }, storePath);
  return { domain: result, state: buildValidatedState(store, { now }) };
}

export async function updateDomain(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const existing = current.domains[input.domainId];
    if (!existing) throw new Error(`Unknown domain: ${input.domainId}.`);
    const fields = domainFields(input, existing);
    if (Object.entries(current.domains).some(([id, domain]) => id !== input.domainId && normalizeText(domain.label) === normalizeText(fields.label))) {
      throw new Error(`A domain named ${fields.label} already exists.`);
    }
    current.domains[input.domainId] = fields;
    if (Object.hasOwn(input, 'weeklyHours')) {
      current.settings.weeklyPlanByDomain[input.domainId] = cleanNumber(input.weeklyHours, { min: 0, max: 168, label: 'Weekly plan' });
    }
    return { id: input.domainId, ...fields };
  }, storePath);
  return { domain: result, state: buildValidatedState(store, { now }) };
}

export async function deleteDomain(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const domain = current.domains[input.domainId];
    if (!domain) throw new Error(`Unknown domain: ${input.domainId}.`);
    const projects = current.projects.filter((project) => project.domain === input.domainId).length;
    const entries = current.timeEntries.filter((entry) => entry.domain === input.domainId).length;
    if (projects || entries || current.activeSession?.domain === input.domainId) {
      throw new Error(`${domain.label} is still used by ${projects} project${projects === 1 ? '' : 's'} and ${entries} preserved entr${entries === 1 ? 'y' : 'ies'}. Move them first.`);
    }
    if (Object.keys(current.domains).length === 1) throw new Error('LifeOS needs at least one domain.');
    delete current.domains[input.domainId];
    delete current.settings.weeklyPlanByDomain[input.domainId];
    return { id: input.domainId, ...domain };
  }, storePath);
  return { domain: result, state: buildValidatedState(store, { now }) };
}

export async function createCategory(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const label = cleanLine(input.label, 60, 'Category name', { required: true });
    const existing = Object.values(current.categories).some((category) => normalizeText(category.label) === normalizeText(label));
    if (existing) throw new Error(`A category named ${label} already exists.`);
    return ensureCategory(current, label);
  }, storePath);
  return { category: result, state: buildValidatedState(store, { now }) };
}

export async function updateCategory(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const category = current.categories[input.categoryId];
    if (!category) throw new Error(`Unknown category: ${input.categoryId}.`);
    const label = cleanLine(input.label, 60, 'Category name', { required: true });
    if (Object.entries(current.categories).some(([id, other]) => id !== input.categoryId && normalizeText(other.label) === normalizeText(label))) {
      throw new Error(`A category named ${label} already exists.`);
    }
    category.label = label;
    return { id: input.categoryId, ...category };
  }, storePath);
  return { category: result, state: buildValidatedState(store, { now }) };
}

export async function deleteCategory(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const category = current.categories[input.categoryId];
    if (!category) throw new Error(`Unknown category: ${input.categoryId}.`);
    const entries = current.timeEntries.filter((entry) => entry.categoryIds.includes(input.categoryId)).length;
    if (entries || current.activeSession?.categoryIds.includes(input.categoryId)) {
      throw new Error(`${category.label} preserves the history of ${entries} time entr${entries === 1 ? 'y' : 'ies'} and cannot be deleted.`);
    }
    let detached = 0;
    for (const project of current.projects) {
      if (!project.categoryIds.includes(input.categoryId)) continue;
      project.categoryIds = project.categoryIds.filter((id) => id !== input.categoryId);
      detached += 1;
    }
    delete current.categories[input.categoryId];
    return { category: { id: input.categoryId, ...category }, detachedProjects: detached };
  }, storePath);
  return { ...result, state: buildValidatedState(store, { now }) };
}

export async function updateSettings(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const settings = current.settings;
    if (Object.hasOwn(input, 'deepTarget')) settings.deepTarget = cleanNumber(input.deepTarget, { min: 0, max: 1, label: 'Deep-work target' });
    if (Object.hasOwn(input, 'defaultDailyPlanHours')) {
      settings.defaultDailyPlanHours = cleanNumber(input.defaultDailyPlanHours, { min: 0.5, max: 24, label: 'Daily plan' });
    }
    if (input.weeklyPlanByDomain) {
      for (const [domainId, hours] of Object.entries(input.weeklyPlanByDomain)) {
        if (!current.domains[domainId]) throw new Error(`Unknown domain: ${domainId}.`);
        settings.weeklyPlanByDomain[domainId] = cleanNumber(hours, { min: 0, max: 168, label: `${current.domains[domainId].label} weekly plan` });
      }
    }
    if (input.health) {
      settings.health ||= {};
      if (Object.hasOwn(input.health, 'attentionInactiveDays')) {
        settings.health.attentionInactiveDays = cleanNumber(input.health.attentionInactiveDays, { min: 0.5, max: 60, label: 'Attention threshold' });
      }
      if (Object.hasOwn(input.health, 'criticalInactiveDays')) {
        settings.health.criticalInactiveDays = cleanNumber(input.health.criticalInactiveDays, { min: 1, max: 120, label: 'Critical threshold' });
      }
      if (Number(settings.health.criticalInactiveDays ?? 5) <= Number(settings.health.attentionInactiveDays ?? 2.5)) {
        throw new Error('The critical threshold must be longer than the attention threshold.');
      }
    }
    if (Object.hasOwn(input, 'appName')) current.meta.appName = cleanLine(input.appName, 40, 'App name', { required: true });
    if (Object.hasOwn(input, 'tagline')) current.meta.tagline = cleanLine(input.tagline, 80, 'Tagline');
    if (Object.hasOwn(input, 'timezone')) {
      const timezone = String(input.timezone || '').trim();
      try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(now); }
      catch { throw new Error(`Unknown timezone: ${timezone}.`); }
      current.meta.timezone = timezone;
    }
    return { settings, meta: current.meta };
  }, storePath);
  return { ...result, state: buildValidatedState(store, { now }) };
}

function milestoneFields(input, existing = {}) {
  const milestone = { ...existing };
  if (Object.hasOwn(input, 'text') || !existing.text) milestone.text = cleanLine(input.text, 300, 'Milestone', { required: true });
  if (Object.hasOwn(input, 'date') || !existing.date) {
    const date = requireOptionalDateOnly(input.date, 'Milestone date');
    if (!date) throw new Error('A milestone date is required.');
    milestone.date = date;
  }
  if (Object.hasOwn(input, 'projectId')) {
    if (input.projectId) milestone.projectId = input.projectId;
    else delete milestone.projectId;
  }
  return milestone;
}

export async function createMilestone(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    current.milestones ||= [];
    const milestone = milestoneFields({ date: dateOnly(now, current.meta.timezone), ...input });
    if (milestone.projectId && !current.projects.some((project) => project.id === milestone.projectId)) {
      throw new Error(`Project not found: ${milestone.projectId}`);
    }
    milestone.id = `milestone-${randomUUID()}`;
    current.milestones.push(milestone);
    return milestone;
  }, storePath);
  return { milestone: result, state: buildValidatedState(store, { now }) };
}

export async function updateMilestone(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const index = (current.milestones || []).findIndex((milestone) => milestone.id === input.milestoneId);
    if (index < 0) throw new Error(`Milestone not found: ${input.milestoneId}`);
    const milestone = milestoneFields(input, current.milestones[index]);
    if (milestone.projectId && !current.projects.some((project) => project.id === milestone.projectId)) {
      throw new Error(`Project not found: ${milestone.projectId}`);
    }
    current.milestones[index] = milestone;
    return milestone;
  }, storePath);
  return { milestone: result, state: buildValidatedState(store, { now }) };
}

export async function deleteMilestone(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const index = (current.milestones || []).findIndex((milestone) => milestone.id === input.milestoneId);
    if (index < 0) throw new Error(`Milestone not found: ${input.milestoneId}`);
    return current.milestones.splice(index, 1)[0];
  }, storePath);
  return { milestone: result, state: buildValidatedState(store, { now }) };
}

export async function setChallenge(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const existing = current.challenge || {};
    const project = current.projects.find((item) => item.id === (input.projectId ?? existing.projectId));
    if (!project) throw new Error('A challenge needs an existing project.');
    const today = dateOnly(now, current.meta.timezone);
    const startDate = requireOptionalDateOnly(input.startDate ?? existing.startDate ?? today, 'Challenge start');
    const endDate = requireOptionalDateOnly(input.endDate ?? existing.endDate, 'Challenge end');
    if (!startDate || !endDate || endDate < startDate) throw new Error('A challenge needs a start date on or before its end date.');
    const activityTypes = input.activityTypes ?? existing.activityTypes ?? [];
    for (const type of activityTypes) if (!ACTIVITY_TYPES.includes(type)) throw new Error(`Unknown activity type: ${type}`);
    current.challenge = {
      id: existing.id || `challenge-${randomUUID()}`,
      text: cleanLine(input.text ?? existing.text, 300, 'Challenge', { required: true }),
      projectId: project.id,
      startDate,
      endDate,
      target: cleanNumber(input.target ?? existing.target ?? 3, { min: 1, max: 100, integer: true, label: 'Target sessions' }),
      minDurationMinutes: cleanNumber(input.minDurationMinutes ?? existing.minDurationMinutes ?? 45, { min: 1, max: 1440, integer: true, label: 'Minimum session length' }),
      activityTypes: [...new Set(activityTypes)],
    };
    return current.challenge;
  }, storePath);
  return { challenge: result, state: buildValidatedState(store, { now }) };
}

export async function clearChallenge(input = {}, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result, store } = await mutateStore((current) => {
    const challenge = current.challenge || null;
    current.challenge = null;
    return challenge;
  }, storePath);
  return { challenge: result, state: buildValidatedState(store, { now }) };
}

const BOOK_TEXT_FIELDS = { title: 300, subtitle: 400, description: 12_000, publisher: 300, language: 30 };

export async function updateReadingBook(input, storePath = DEFAULT_STORE_PATH) {
  const now = resolveNow(input.now);
  const { result: book, store } = await mutateStore((current) => {
    const book = current.reading.books.find((item) => item.id === input.bookId);
    if (!book) throw new Error(`Reading book not found: ${input.bookId}`);
    for (const [field, max] of Object.entries(BOOK_TEXT_FIELDS)) {
      if (!Object.hasOwn(input, field)) continue;
      const value = cleanReadingText(input[field], max);
      if (field === 'title' && !value) throw new Error('A book title is required.');
      book[field] = value || (field === 'title' ? book.title : null);
    }
    if (Object.hasOwn(input, 'authors')) book.authors = cleanReadingList(input.authors, 12, 180);
    if (Object.hasOwn(input, 'publishedYear')) {
      book.publishedYear = cleanNumber(input.publishedYear, { min: 1, max: 3000, integer: true, label: 'Published year', nullable: true });
    }
    if (Object.hasOwn(input, 'pageCount')) {
      book.pageCount = cleanNumber(input.pageCount, { min: 1, max: 100_000, integer: true, label: 'Page count', nullable: true });
    }
    if (Object.hasOwn(input, 'isbn10')) book.isbn10 = cleanIdentifier(input.isbn10, 10);
    if (Object.hasOwn(input, 'isbn13')) book.isbn13 = cleanIdentifier(input.isbn13, 13);
    if (Object.hasOwn(input, 'coverUrl')) book.coverUrl = cleanHttpsUrl(input.coverUrl);
    if (Object.hasOwn(input, 'tags')) book.tags = cleanReadingTags(input.tags);
    book.updatedAt = now.toISOString();
    return book;
  }, storePath);
  return { book, state: buildValidatedState(store, { now }) };
}
