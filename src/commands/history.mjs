import { z } from 'zod';
import { buildValidatedState, mutateStore } from '../lifeos-data.mjs';
import { HistoryConflictError, markUndone, readHistory, readHistoryEntry, revertPatch } from '../lifeos-history.mjs';
import { revertWorkspace } from '../lifeos-workspace.mjs';
import { CommandError, defineCommand } from './registry.mjs';

defineCommand({
  name: 'history.list',
  title: 'Recent activity',
  kind: 'read',
  description: 'Recent changes made by the person and by agents (newest first), with source, wording, touched records and whether each was undone. Use history.undo with an entry ID to revert one.',
  keywords: ['activity', 'log', 'changes', 'audit'],
  input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
  run: async (input, ctx) => ({ entries: await readHistory(ctx.storePath, { limit: input.limit || 40 }) }),
});

async function undoEntry(entry, ctx, { verb, redo = false }) {
  if (entry.undoneBy) throw new CommandError('That change was already undone.');
  const label = `${verb} ${entry.label?.replace(/^Undid |^Redid /, '') || entry.command}`;
  ctx.operation.label = label;
  if (redo) ctx.operation.redoOf = entry.id;
  else ctx.operation.undoOf = entry.id;
  try {
    if (entry.patch?.workspace) {
      const { workspace } = await revertWorkspace(ctx.storePath, entry.patch.workspace);
      await markUndone(ctx.storePath, entry.id, ctx.operation.recorded?.at(-1) || 'unknown');
      return { undone: entry.id, label, workspace };
    }
    const { store } = await mutateStore((current) => {
      revertPatch(current, entry.patch, { onlineTasks: ctx.operation.onlineTasks });
      return { undone: entry.id };
    }, ctx.storePath);
    await markUndone(ctx.storePath, entry.id, ctx.operation.recorded?.at(-1) || 'unknown');
    return { result: { undone: entry.id, label }, state: buildValidatedState(store) };
  } catch (error) {
    if (error instanceof HistoryConflictError) throw new CommandError(error.message, { status: 409, code: 'conflict' });
    throw error;
  }
}

defineCommand({
  name: 'history.undo',
  title: 'Undo',
  kind: 'write',
  description: 'Undo one recorded change (the most recent not-yet-undone change by default). Refused if the affected records changed afterwards. Undo is itself recorded, so it can be redone.',
  keywords: ['revert', 'undo'],
  input: z.object({ operationId: z.string().optional(), source: z.string().optional().describe('Undo the latest change from this source only (e.g. app, mcp).') }),
  run: async (input, ctx) => {
    let entry;
    if (input.operationId) {
      entry = await readHistoryEntry(ctx.storePath, input.operationId);
      if (!entry) throw new CommandError('That change is no longer in the history.', { status: 404 });
    } else {
      const recent = await readHistory(ctx.storePath, { limit: 200 });
      // Redone changes are ordinary changes again; undo entries are not.
      const candidate = recent.find((item) => !item.undoneBy && !item.undoOf && (!input.source || item.source === input.source));
      if (!candidate) throw new CommandError('Nothing to undo.');
      entry = await readHistoryEntry(ctx.storePath, candidate.id);
    }
    return undoEntry(entry, ctx, { verb: 'Undid' });
  },
});

defineCommand({
  name: 'history.redo',
  title: 'Redo',
  kind: 'write',
  description: 'Redo the most recently undone change (by reverting its undo).',
  run: async (_input, ctx) => {
    const recent = await readHistory(ctx.storePath, { limit: 200 });
    // Like an editor: a new ordinary change after an undo clears the redo stack.
    let lastUndo = null;
    for (const item of recent) {
      if (item.undoOf) { if (!item.undoneBy) { lastUndo = item; break; } continue; }
      if (item.redoOf) continue;
      break;
    }
    if (!lastUndo) throw new CommandError('Nothing to redo.');
    const original = recent.find((item) => item.id === lastUndo.undoOf);
    const entry = await readHistoryEntry(ctx.storePath, lastUndo.id);
    entry.label = original?.label || entry.label;
    return undoEntry(entry, ctx, { verb: 'Redid', redo: true });
  },
});
