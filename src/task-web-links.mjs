import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readStore } from './lifeos-data.mjs';
import { extractWebLinks } from '../public/web-links.js';

export async function openSavedTaskLink(input, { storePath, platform = process.platform, run = promisify(execFile) } = {}) {
  const store = await readStore(storePath);
  const task = store.tasks.items.find((item) => item.id === input.taskId && !item.trashedAt);
  const link = task && extractWebLinks(task.notes).find((item) => item.url === input.url);
  if (!link) throw new Error('This link is no longer saved on the task. Refresh LifeOS and try again.');
  if (platform !== 'darwin') throw new Error('Open the saved URL directly in your browser.');
  // URL is validated HTTP(S) from the saved task; no shell or arbitrary command is accepted.
  await run('/usr/bin/open', [link.url], { timeout: 10_000 });
  return { ok: true };
}
