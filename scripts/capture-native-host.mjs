#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { endianness } from 'node:os';
import { promisify } from 'node:util';
import { captureWebPage, readStore } from '../src/lifeos-data.mjs';

const manifest = JSON.parse(await readFile(new URL('../extensions/lifeos-capture/manifest.json', import.meta.url), 'utf8'));
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
  .slice(0, 32).replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + parseInt(value, 16)));
const littleEndian = endianness() === 'LE';
const MAX_MESSAGE = 64 * 1024;

function reply(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  if (littleEndian) header.writeUInt32LE(body.length); else header.writeUInt32BE(body.length);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

async function handle(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid capture request.');
  if (message.action === 'ping') {
    await readStore();
    return { ok: true, app: 'LifeOS', version: 1 };
  }
  if (message.action === 'open') {
    if (process.platform !== 'darwin') throw new Error('Open LifeOS from your applications menu.');
    await promisify(execFile)('/usr/bin/open', ['-a', 'LifeOS Dev']);
    return { ok: true };
  }
  if (message.action !== 'capture') throw new Error('Unsupported capture request.');
  const result = await captureWebPage({ url: message.url, title: message.title });
  return {
    ok: true, created: result.created, url: result.url,
    task: { id: result.task.id, title: result.task.title, priority: result.task.priority,
      dueDate: result.task.schedule.dueDate, status: result.task.status },
    project: result.project?.name || 'Inbox',
    warning: result.backup?.ok === false ? 'Saved locally. Your backup needs attention in LifeOS.' : null,
  };
}

if (process.argv[2] !== `chrome-extension://${extensionId}/`) {
  reply({ ok: false, error: 'This helper only accepts the LifeOS Capture extension.' });
} else {
  let buffer = Buffer.alloc(0);
  let handled = false;
  const timeout = setTimeout(() => reply({ ok: false, error: 'Capture request timed out.' }), 10_000);
  process.stdin.on('data', (chunk) => {
    if (handled) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < 4) return;
    const length = littleEndian ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
    if (length === 0 || length > MAX_MESSAGE) {
      handled = true;
      clearTimeout(timeout);
      return reply({ ok: false, error: 'Capture request is too large or empty.' });
    }
    if (buffer.length < length + 4) return;
    handled = true;
    clearTimeout(timeout);
    process.stdin.pause();
    Promise.resolve().then(() => handle(JSON.parse(buffer.subarray(4, length + 4).toString('utf8'))))
      .then(reply, (error) => reply({ ok: false, error: error.message }));
  });
  process.stdin.on('end', () => {
    if (!handled) reply({ ok: false, error: 'Capture request was interrupted.' });
  });
  process.stdin.on('error', () => reply({ ok: false, error: 'Could not read the capture request.' }));
}
