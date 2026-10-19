// Commands that drive the open LifeOS window, so an agent can show the person
// what it did ("open the task I just created") or read what they are looking
// at. Inside the server they broadcast to connected windows; from the CLI, SDK
// or MCP server they are forwarded to the running app over loopback HTTP.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CommandError, defineCommand } from './registry.mjs';

export const serverInfoPath = (storePath) => `${storePath}.server.json`;

export async function readServerInfo(storePath) {
  try {
    const info = JSON.parse(await readFile(serverInfoPath(storePath), 'utf8'));
    if (!info?.port || !info?.pid) return null;
    try { process.kill(info.pid, 0); } catch (error) { if (error.code === 'ESRCH') return null; }
    return info;
  } catch {
    return null;
  }
}

async function forward(name, input, ctx) {
  const info = await readServerInfo(ctx.storePath);
  if (!info) throw new CommandError('The LifeOS app is not running, so there is no window to control. Open LifeOS (or run npm run dev) and try again.', { status: 409, code: 'app_not_running' });
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${info.port}/api/run/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lifeos-source': ctx.source, ...(ctx.actor ? { 'x-lifeos-actor': ctx.actor } : {}) },
      body: JSON.stringify(input),
    });
  } catch {
    throw new CommandError('Could not reach the running LifeOS app.', { status: 409, code: 'app_not_running' });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new CommandError(body.error || `LifeOS returned ${response.status}.`, { status: response.status });
  return body.result;
}

function uiCommand(spec) {
  defineCommand({
    kind: 'ui',
    idempotent: true,
    ...spec,
    run: async (input, ctx) => {
      if (!ctx.ui) return forward(spec.name, input, ctx);
      return spec.run(input, ctx);
    },
  });
}

uiCommand({
  name: 'ui.view',
  title: 'What is on screen',
  description: 'Report what the person is currently looking at in the LifeOS window: route, selected list, open record and any text selection context. Requires the app to be open.',
  run: async (_input, ctx) => ctx.ui.presence() || { open: false },
});

uiCommand({
  name: 'ui.navigate',
  title: 'Go to screen',
  description: 'Navigate the open LifeOS window. Routes: today, tasks, tasks?list=today|next7|inbox|completed|trash|project:<id>|tag:<tag>|view:<id>, projects, projects?view=board, projects/<projectId>, insights?range=week|month|quarter|year, creation, creation/<ideaId>, reading, reading?view=library, almanac, settings, settings/<section>.',
  input: z.object({ to: z.string().trim().min(1).max(300) }),
  run: async (input, ctx) => ctx.ui.send({ type: 'navigate', to: input.to }),
});

uiCommand({
  name: 'ui.open',
  title: 'Open a record',
  description: 'Open one record in the LifeOS window so the person sees it: a task (detail sheet), project (project page), book (detail sheet) or idea (editor).',
  input: z.object({ kind: z.enum(['task', 'project', 'book', 'idea']), id: z.string().min(1).max(200) }),
  run: async (input, ctx) => ctx.ui.send({ type: 'open', kind: input.kind, id: input.id }),
});

uiCommand({
  name: 'ui.toast',
  title: 'Show a message',
  description: 'Show a short message in the LifeOS window (for example to confirm what an agent did).',
  input: z.object({ message: z.string().trim().min(1).max(240), tone: z.enum(['info', 'success', 'warning']).optional() }),
  run: async (input, ctx) => ctx.ui.send({ type: 'toast', message: input.message, tone: input.tone || 'info' }),
});

uiCommand({
  name: 'ui.capture',
  title: 'Prefill quick capture',
  description: 'Open the quick-capture box in the LifeOS window prefilled with text, so the person can review and confirm it. kind: task, project, log, idea, book or milestone.',
  input: z.object({ text: z.string().max(500).optional(), kind: z.enum(['task', 'project', 'log', 'idea', 'book', 'milestone']).optional() }),
  run: async (input, ctx) => ctx.ui.send({ type: 'capture', text: input.text || '', kind: input.kind || 'task' }),
});

uiCommand({
  name: 'ui.palette',
  title: 'Open command palette',
  description: 'Open the command palette in the LifeOS window, optionally with a search query.',
  input: z.object({ query: z.string().max(200).optional() }),
  run: async (input, ctx) => ctx.ui.send({ type: 'palette', query: input.query || '' }),
});
