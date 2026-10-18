#!/usr/bin/env node
// Syntax-checks every JavaScript source LifeOS ships (server, CLI, MCP,
// browser modules, workers, the capture extension) so a new file can never be
// left out of `npm run check`.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['src', 'scripts', 'cli', 'public', 'workers', 'extensions/lifeos-capture', 'tests'];
const SKIP = new Set(['node_modules', 'vendor', 'fonts', 'target', '.wrangler']);

async function collect(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(full));
    else if (/\.(m?js)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function check(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ file, ok: code === 0, stderr }));
  });
}

const files = (await Promise.all(ROOTS.map((dir) => collect(path.join(root, dir))))).flat().sort();
const failures = [];
for (let index = 0; index < files.length; index += 12) {
  const results = await Promise.all(files.slice(index, index + 12).map(check));
  failures.push(...results.filter((result) => !result.ok));
}
if (failures.length) {
  for (const failure of failures) console.error(`✗ ${path.relative(root, failure.file)}\n${failure.stderr}`);
  process.exit(1);
}
console.log(`Syntax OK · ${files.length} files`);
