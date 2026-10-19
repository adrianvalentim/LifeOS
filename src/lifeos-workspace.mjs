// Workspace configuration: how the app is arranged for this person — section
// order and visibility, the start screen, theme, saved task views and pins.
// It is configuration, not personal records, so it lives beside the store in
// its own validated file. Agents change it through the same commands as the UI.
import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { appendHistory, operationContext, stableStringify } from './lifeos-history.mjs';
import { acquireStoreLock, DEFAULT_STORE_PATH, normalizeText } from './lifeos-data.mjs';

export const workspacePath = (storePath) => `${storePath}.workspace.json`;
export const SECTIONS = ['today', 'tasks', 'projects', 'creation', 'reading', 'insights', 'almanac'];
export const SECTION_LABELS = {
  today: 'Today', tasks: 'Tasks', projects: 'Projects', creation: 'Creation',
  reading: 'Reading', insights: 'Insights', almanac: 'Almanac',
};
export const VIEW_DUE = ['any', 'overdue', 'today', 'next7', 'next30', 'dated', 'nodate'];
export const VIEW_STATUS = ['open', 'completed', 'all'];
export const VIEW_GROUPS = ['none', 'priority', 'due', 'project', 'tag'];
export const VIEW_SORTS = ['manual', 'priority', 'due', 'title', 'created'];
export const VIEW_ICONS = ['list', 'star', 'flag', 'bolt', 'pen', 'book', 'film', 'mail', 'heart', 'target', 'clock', 'leaf'];
const PRIORITIES = ['high', 'medium', 'low', 'none'];
const HEX = /^#[0-9a-f]{6}$/i;

export function defaultWorkspace() {
  return {
    version: 1,
    startScreen: 'projects',
    theme: { mode: 'system', accent: null },
    density: 'comfortable',
    nav: SECTIONS.map((id) => ({ id, hidden: false })),
    views: [],
    pinned: [],
  };
}

export function normalizeWorkspace(raw) {
  const base = defaultWorkspace();
  if (!raw || typeof raw !== 'object') return base;
  const workspace = { ...base };
  if (SECTIONS.includes(raw.startScreen)) workspace.startScreen = raw.startScreen;
  if (raw.theme && typeof raw.theme === 'object') {
    workspace.theme = {
      mode: ['system', 'light', 'dark'].includes(raw.theme.mode) ? raw.theme.mode : 'system',
      accent: HEX.test(raw.theme.accent || '') ? raw.theme.accent.toLowerCase() : null,
    };
  }
  if (['comfortable', 'compact'].includes(raw.density)) workspace.density = raw.density;
  if (Array.isArray(raw.nav)) {
    const seen = new Set();
    const nav = [];
    for (const item of raw.nav) {
      const id = item?.id === 'analytics' ? 'insights' : item?.id;
      if (!SECTIONS.includes(id) || seen.has(id)) continue;
      seen.add(id);
      nav.push({ id, hidden: Boolean(item.hidden) });
    }
    for (const id of SECTIONS) if (!seen.has(id)) nav.push({ id, hidden: false });
    workspace.nav = nav;
  }
  if (Array.isArray(raw.views)) workspace.views = raw.views.map(normalizeView).filter(Boolean).slice(0, 60);
  if (Array.isArray(raw.pinned)) {
    const seen = new Set();
    workspace.pinned = raw.pinned
      .filter((pin) => ['project', 'view', 'tag'].includes(pin?.kind) && typeof pin.id === 'string' && pin.id)
      .filter((pin) => !seen.has(`${pin.kind}:${pin.id}`) && seen.add(`${pin.kind}:${pin.id}`))
      .map((pin) => ({ kind: pin.kind, id: pin.id.slice(0, 200) }))
      .slice(0, 24);
  }
  return workspace;
}

export function normalizeView(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return null;
  const filter = raw.filter && typeof raw.filter === 'object' ? raw.filter : {};
  const list = (value, max = 40) => (Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, max) : []);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : `view-${randomUUID()}`,
    name,
    icon: VIEW_ICONS.includes(raw.icon) ? raw.icon : 'list',
    filter: {
      projects: list(filter.projects),
      tags: list(filter.tags),
      priorities: list(filter.priorities).filter((value) => PRIORITIES.includes(value)),
      due: VIEW_DUE.includes(filter.due) ? filter.due : 'any',
      status: VIEW_STATUS.includes(filter.status) ? filter.status : 'open',
      text: String(filter.text || '').trim().slice(0, 120),
    },
    groupBy: VIEW_GROUPS.includes(raw.groupBy) ? raw.groupBy : 'none',
    sortBy: VIEW_SORTS.includes(raw.sortBy) ? raw.sortBy : 'due',
  };
}

export async function readWorkspace(storePath = DEFAULT_STORE_PATH) {
  try {
    return normalizeWorkspace(JSON.parse(await readFile(workspacePath(storePath), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return defaultWorkspace();
    if (error instanceof SyntaxError) return defaultWorkspace();
    throw error;
  }
}

async function writeWorkspaceFile(storePath, workspace) {
  const file = workspacePath(storePath);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(workspace, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

// One locked, journaled change to the workspace. The store lock serializes it
// with record writes so the Undo journal keeps a single order.
export async function mutateWorkspace(mutator, storePath = DEFAULT_STORE_PATH) {
  const release = await acquireStoreLock(storePath);
  try {
    const before = await readWorkspace(storePath);
    const draft = structuredClone(before);
    const result = await mutator(draft);
    const after = normalizeWorkspace(draft);
    if (stableStringify(before) !== stableStringify(after)) {
      await writeWorkspaceFile(storePath, after);
      const operation = operationContext.getStore();
      if (operation) {
        const label = typeof operation.label === 'function' ? operation.label(result) : operation.label;
        operation.recordedLabel = label;
        const entry = await appendHistory(storePath, {
          command: operation.command,
          label,
          source: operation.source || 'app',
          actor: operation.actor || null,
          undoOf: operation.undoOf || null,
          redoOf: operation.redoOf || null,
          patch: { workspace: { before, after } },
        }).catch(() => null);
        if (entry) (operation.recorded ||= []).push(entry.id);
      }
    }
    return { result, workspace: after };
  } finally {
    await release();
  }
}

export async function revertWorkspace(storePath, change) {
  return mutateWorkspace((draft) => {
    if (stableStringify(normalizeWorkspace(draft)) !== stableStringify(change.after)) {
      throw new Error('The workspace changed after this action, so it cannot be undone without overwriting newer changes.');
    }
    for (const key of Object.keys(draft)) delete draft[key];
    Object.assign(draft, structuredClone(change.before));
  }, storePath);
}

export function findView(workspace, query) {
  const needle = normalizeText(query);
  return workspace.views.find((view) => view.id === query)
    || workspace.views.find((view) => normalizeText(view.name) === needle)
    || null;
}
