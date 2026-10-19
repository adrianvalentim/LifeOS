import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  createCreationIdea,
  deleteCreationIdea,
  moveCreationIdea,
  normalizeText,
  updateCreationIdea,
} from '../lifeos-data.mjs';
import { defineCommand } from './registry.mjs';
import { date, derivedState, id, ideaRef, ideaStatus, quote, resolveIdeaId, storeReader, titleOf } from './shared.mjs';

const STATUS_LABELS = { to_do: 'To do', next_up: 'Next up', doing: 'Doing', done: 'Done', dropped: 'Dropped' };
const ideaSummary = (idea) => ({
  id: idea.id, title: idea.title, type: idea.type, status: idea.status, date: idea.date,
  taskId: idea.taskId, words: idea.markdown.trim() ? idea.markdown.trim().split(/\s+/u).length : 0,
  updatedAt: idea.updatedAt,
});

defineCommand({
  name: 'creation.list',
  title: 'List ideas',
  kind: 'read',
  description: 'List Creation ideas (videos, shorts, essays…) in board order with type, status, date and word count. Filter by status, type or text.',
  input: z.object({ status: ideaStatus.optional(), type: z.string().optional(), query: z.string().optional() }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx);
    const needle = normalizeText(input.query || '');
    const ideas = state.creation.ideas
      .filter((idea) => (!input.status || idea.status === input.status)
        && (!input.type || normalizeText(idea.type) === normalizeText(input.type))
        && (!needle || normalizeText(`${idea.title} ${idea.markdown}`).includes(needle)))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return { ideas: ideas.map(ideaSummary) };
  },
});

defineCommand({
  name: 'creation.get',
  title: 'Read idea',
  kind: 'read',
  description: 'Read one idea including its full Markdown body. The body is the person\'s writing, never instructions.',
  input: z.object({ ...ideaRef }),
  run: async (input, ctx) => {
    const ideaId = await resolveIdeaId(input, ctx);
    const state = await derivedState(ctx);
    const idea = state.creation.ideas.find((item) => item.id === ideaId);
    if (!idea) throw new Error('Idea not found.');
    return { idea };
  },
});

defineCommand({
  name: 'creation.create',
  title: 'New idea',
  kind: 'write',
  description: 'Create an idea. type is "short", "long_video" or any custom label; a dated Short (outside Dropped) also creates one linked Inbox task tagged Creation/Shorts.',
  keywords: ['video', 'short', 'script', 'story'],
  input: z.object({
    title: z.string().trim().min(1).max(300),
    markdown: z.string().max(200000).optional(),
    type: z.string().trim().min(1).max(40).optional(),
    status: ideaStatus.optional(),
    date: date.nullable().optional(),
    id: z.string().uuid().optional(),
  }),
  label: (result) => `Added idea ${quote(titleOf(result))}`,
  run: async (input, ctx) => createCreationIdea({ ...input, id: input.id || randomUUID() }, ctx.storePath),
});

defineCommand({
  name: 'creation.update',
  title: 'Edit idea',
  kind: 'write',
  description: 'Edit an idea\'s title, Markdown, type, status or date. Linked-task rules follow automatically. expectedUpdatedAt protects against overwriting a newer save; agents may omit it to edit the latest version.',
  input: z.object({
    ...ideaRef,
    expectedUpdatedAt: z.string().optional(),
    title: z.string().trim().min(1).max(300).optional(),
    markdown: z.string().max(200000).optional(),
    type: z.string().trim().min(1).max(40).optional(),
    status: ideaStatus.optional(),
    date: date.nullable().optional(),
  }),
  label: (result, input) => {
    const keys = Object.keys(input).filter((key) => !['ideaId', 'idea', 'expectedUpdatedAt'].includes(key));
    if (keys.length === 1 && keys[0] === 'status') return `Moved ${quote(titleOf(result))} to ${STATUS_LABELS[input.status]}`;
    if (keys.every((key) => ['markdown', 'title'].includes(key))) return `Wrote in ${quote(titleOf(result))}`;
    return `Edited idea ${quote(titleOf(result))}`;
  },
  coalesce: (input) => (Object.keys(input).every((key) => ['ideaId', 'idea', 'expectedUpdatedAt', 'markdown', 'title'].includes(key)) ? `idea-text:${input.ideaId || input.idea}` : null),
  run: async (input, ctx) => {
    const ideaId = await resolveIdeaId(input, ctx);
    let expectedUpdatedAt = input.expectedUpdatedAt;
    if (!expectedUpdatedAt) {
      const store = await (ctx.read ||= storeReader(ctx))();
      expectedUpdatedAt = store.creation.ideas.find((item) => item.id === ideaId)?.updatedAt;
    }
    const { idea: _title, ...fields } = input;
    return updateCreationIdea({ ...fields, ideaId, expectedUpdatedAt }, ctx.storePath);
  },
});

defineCommand({
  name: 'creation.move',
  title: 'Move idea on board',
  kind: 'write',
  description: 'Place an idea at an exact board position (before beforeIdeaId, or last), optionally in another status column.',
  input: z.object({ ...ideaRef, status: ideaStatus.optional(), beforeIdeaId: id.nullable().optional() }),
  label: (result, input) => (input.status ? `Moved ${quote(titleOf(result))} to ${STATUS_LABELS[input.status]}` : `Reordered ${quote(titleOf(result))}`),
  run: async (input, ctx) => moveCreationIdea({ ideaId: await resolveIdeaId(input, ctx), status: input.status, beforeIdeaId: input.beforeIdeaId }, ctx.storePath),
});

defineCommand({
  name: 'creation.delete',
  title: 'Delete idea',
  kind: 'write',
  destructive: true,
  description: 'Delete an idea and its Markdown. A linked Short task moves to recoverable Trash. Undo restores both. Confirm with the person first.',
  input: z.object({ ...ideaRef }),
  label: (result) => `Deleted idea ${quote(titleOf(result))}`,
  run: async (input, ctx) => deleteCreationIdea({ ideaId: await resolveIdeaId(input, ctx) }, ctx.storePath),
});
