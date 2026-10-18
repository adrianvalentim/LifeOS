// Shared schemas and reference resolution for commands. Agents usually know a
// project or task by name; the person's UI always knows exact IDs. Commands
// accept either, and resolve names with the same rules as the CLI.
import { z } from 'zod';
import {
  buildState,
  normalizeText,
  readStore,
  requireProject,
  requireTask,
} from '../lifeos-data.mjs';
import { readWorkspace } from '../lifeos-workspace.mjs';
import { CommandError } from './registry.mjs';

export const id = z.string().trim().min(1).max(200);
export const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');
export const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour).');
export const priority = z.enum(['none', 'low', 'medium', 'high']);
export const range = z.enum(['week', 'month', 'quarter', 'year']);
export const activityType = z.enum(['deep_work', 'shallow_work', 'admin', 'research', 'creative', 'communication']);
export const projectStatus = z.enum(['to_do', 'next_up', 'doing', 'paused', 'done', 'dropped']);
export const readingStatus = z.enum(['to_read', 'next_up', 'reading', 'finished', 'dropped']);
export const ideaStatus = z.enum(['to_do', 'next_up', 'doing', 'done', 'dropped']);
export const tags = z.array(z.string().trim().min(1).max(40)).max(24);

export const projectRef = {
  projectId: id.optional().describe('Exact project ID (preferred when known).'),
  project: z.string().trim().min(1).max(200).optional().describe('Project name when the ID is unknown (exact or unambiguous partial match).'),
};
export const optionalListRef = {
  projectId: id.nullable().optional().describe('Exact project ID, or null for Inbox.'),
  project: z.string().trim().min(1).max(200).optional().describe('Project name, or "inbox" for no project.'),
};
export const taskRef = {
  taskId: id.optional().describe('Exact task ID (preferred).'),
  task: z.string().trim().min(1).max(300).optional().describe('Task title when the ID is unknown (exact or unambiguous partial match).'),
};
export const bookRef = {
  bookId: id.optional().describe('Exact book ID.'),
  book: z.string().trim().min(1).max(300).optional().describe('Book title when the ID is unknown.'),
};
export const ideaRef = {
  ideaId: id.optional().describe('Exact idea ID.'),
  idea: z.string().trim().min(1).max(300).optional().describe('Idea title when the ID is unknown.'),
};

// Lazily reads the store once per command run (cloud task reads are slow).
export function storeReader(ctx) {
  let pending = null;
  return () => {
    pending ||= readStore(ctx.storePath, { initialize: true });
    return pending;
  };
}

export async function derivedState(ctx, options = {}) {
  const store = await readStore(ctx.storePath);
  return buildState(store, options);
}

export async function resolveProjectId(input, ctx, { required = true, allowInbox = false } = {}) {
  if (input.projectId !== undefined) {
    if (input.projectId === null) {
      if (allowInbox) return null;
      throw new CommandError('A project is required.');
    }
    return input.projectId;
  }
  if (input.project !== undefined) {
    if (allowInbox && ['inbox', 'none', 'no project', 'general'].includes(normalizeText(input.project))) return null;
    const store = await (ctx.read ||= storeReader(ctx))();
    try {
      return requireProject(store, input.project).id;
    } catch (error) {
      throw new CommandError(error.message);
    }
  }
  if (required) throw new CommandError('Name the project with projectId or project.');
  return undefined;
}

export async function resolveTaskId(input, ctx, { field = 'taskId', nameField = 'task' } = {}) {
  if (input[field]) return input[field];
  if (input[nameField]) {
    const store = await (ctx.read ||= storeReader(ctx))();
    try {
      return requireTask(store, input[nameField]).id;
    } catch (error) {
      throw new CommandError(error.message);
    }
  }
  throw new CommandError(`Name the task with ${field} or ${nameField}.`);
}

function requireByTitle(items, query, kind, titleOf) {
  const needle = normalizeText(query);
  const exact = items.filter((item) => item.id === query || normalizeText(titleOf(item)) === needle);
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : items.filter((item) => normalizeText(titleOf(item)).includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new CommandError(`Ambiguous ${kind}: ${query}. Matches: ${partial.slice(0, 6).map(titleOf).join(', ')}`);
  throw new CommandError(`${kind[0].toUpperCase()}${kind.slice(1)} not found: ${query}`);
}

export async function resolveBookId(input, ctx) {
  if (input.bookId) return input.bookId;
  if (input.book) {
    const store = await (ctx.read ||= storeReader(ctx))();
    return requireByTitle(store.reading.books, input.book, 'book', (book) => book.title).id;
  }
  throw new CommandError('Name the book with bookId or book.');
}

export async function resolveIdeaId(input, ctx) {
  if (input.ideaId) return input.ideaId;
  if (input.idea) {
    const store = await (ctx.read ||= storeReader(ctx))();
    return requireByTitle(store.creation.ideas, input.idea, 'idea', (idea) => idea.title).id;
  }
  throw new CommandError('Name the idea with ideaId or idea.');
}

export async function workspaceFor(ctx) {
  return readWorkspace(ctx.storePath);
}

// Mutators return either the record or { task|project|book|idea|entry, ... }.
export function titleOf(result) {
  return result?.task?.title ?? result?.idea?.title ?? result?.book?.title ?? result?.project?.name
    ?? result?.entry?.description ?? result?.milestone?.text ?? result?.title ?? result?.name
    ?? result?.label ?? result?.text ?? result?.description ?? '';
}

export function quote(value, max = 60) {
  const text = String(value ?? '').trim();
  return `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;
}

export function omit(value, keys) {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

// Compact task shape for agents: everything except long notes.
export function taskSummary(task, projectsById) {
  return {
    id: task.id,
    title: task.title,
    status: task.trashedAt ? 'trashed' : task.status,
    priority: task.priority,
    tags: task.tags,
    dueDate: task.schedule?.dueDate || null,
    startTime: task.schedule?.startTime || null,
    durationMinutes: task.schedule?.durationMinutes || null,
    projectId: task.projectId,
    project: task.projectId ? projectsById.get(task.projectId)?.name || null : 'Inbox',
    parentTaskId: task.parentTaskId,
    depth: task.depth ?? 0,
    subtasks: task.subtreeTotal > 1 ? { completed: task.subtreeCompleted, total: task.subtreeTotal } : null,
    hasNotes: Boolean(task.notes),
    completedAt: task.completedAt,
    trashedAt: task.trashedAt,
  };
}

export function projectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    subtitle: project.subtitle || '',
    status: project.status,
    health: project.health,
    domain: project.domain,
    categories: project.categoryLabels || [],
    priority: project.priority,
    deadline: project.deadline,
    dueInDays: project.dueInDays,
    progress: project.progress,
    weekHours: project.weekHours,
    plannedHours: project.plannedHours,
    lastTouched: project.lastTouchedLabel,
    streak: project.streak,
    tasks: project.taskSummary,
    nextAction: project.nextAction || null,
  };
}
