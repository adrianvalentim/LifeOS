#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_STORE_PATH, ROOT_DIR } from '../src/lifeos-data.mjs';
import { createCloudTaskService, validateTaskDocument } from '../src/cloud-task-service.mjs';
import { digest, prepareTaskCutover, fenceTaskCutover, verifyCutoverManifest, markTaskCutoverActive } from '../src/task-cutover.mjs';
import { readTaskAuthority } from '../src/task-authority.mjs';
import { createWranglerTaskConnection, readPrivateJson, quoteSql } from '../src/cloud-task-repository.mjs';

const run = promisify(execFile);
const quote = quoteSql;
const action = process.argv[2] || 'help';
const flags = process.argv.slice(3);
function option(name) { const index = flags.indexOf(`--${name}`); return index < 0 ? undefined : flags[index + 1]; }
async function privateJson(file) {
  return readPrivateJson(file, ROOT_DIR);
}
async function connection() {
  const configFile = option('config') || process.env.LIFEOS_CLOUD_CONFIG;
  return { ...await createWranglerTaskConnection({ configFile, workspaceRoot: ROOT_DIR }), configFile };
}
async function cutoverWriterPreflight() {
  if (process.platform !== 'darwin') return;
  const installed = path.join(os.homedir(), 'Library/Application Support/LifeOS/browser-capture/src');
  try {
    for (const name of ['lifeos-data.mjs', 'task-authority.mjs', 'task-online.mjs', 'cloud-task-service.mjs', 'cloud-task-repository.mjs', 'task-query-bootstrap.mjs']) {
      if (digest(await readFile(path.join(installed, name))) !== digest(await readFile(path.join(ROOT_DIR, 'src', name)))) {
        throw new Error('Task capture runtime must be refreshed with npm run capture:install before cutover.');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Missing new dependency beside an installed old helper is unsafe.
    if (await stat(path.join(installed, 'lifeos-data.mjs')).catch(() => null)) throw new Error('Task capture runtime must be refreshed before cutover.');
  }
  let output = '';
  try { ({ stdout: output } = await run('pgrep', ['-f', 'scripts/(dev-server|capture-native-host)\\.mjs'])); }
  catch (error) { if (error.code !== 1) throw new Error('Task writer preflight failed. Stop local task writers before cutover.'); }
  for (const pid of output.trim().split(/\s+/).filter(v => /^\d+$/.test(v))) {
    const { stdout } = await run('ps', ['-p', pid, '-o', 'command=']).catch(() => ({ stdout: '' }));
    if (stdout.includes('capture-native-host.mjs')) throw new Error('Task capture is running. Finish capture before cutover.');
    const cwd = await run('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).then(r => r.stdout).catch(() => '');
    if (cwd.split('\n').some(line => line === 'n'+ROOT_DIR) || stdout.includes(ROOT_DIR)) throw new Error('Task workspace server is running. Stop it for cutover, then restart with the updated task guard.');
  }
}
try {
  if (action === 'help') {
    console.log('Private task cloud CLI\nbackup --artifacts /private/directory --origin https://approved-host\nfence --config /private/wrangler.jsonc --manifest /private/cutover.json\nimport|activate|status --config /private/wrangler.jsonc [--manifest /private/cutover.json]\nlist|get|create|edit|complete|trash|restore --config /private/wrangler.jsonc --input /private/input.json\nActivation selects the online desktop task adapter. Reads return task content to the authorized local caller. Import/status print counts only. No permanent deletion.');
  } else if (action === 'backup') {
    const manifest = await prepareTaskCutover({ storePath: DEFAULT_STORE_PATH, artifactDir: option('artifacts'), origin: option('origin') });
    console.log(JSON.stringify({ backupVerified: true, sha256: manifest.backupSha256, tasks: manifest.taskCount, manifest: path.join(path.dirname(manifest.documentPath), 'cutover.json') }));
  } else if (action === 'fence') {
    const manifest = await privateJson(option('manifest'));
    const { config, database, configFile } = await connection();
    if (config.vars.MCP_ORIGIN !== manifest.origin || database.database_id.startsWith('REPLACE_')) throw new Error('Private task destination must be approved and provisioned before fencing.');
    await cutoverWriterPreflight();
    const authority = await fenceTaskCutover(manifest, { mode: 'online', configFile, workspaceRoot: ROOT_DIR, databaseId: database.database_id, accountId: config.account_id });
    console.log(JSON.stringify({ phase: authority.phase, localTaskWrites: 'blocked', tasks: manifest.taskCount }));
  } else {
    const { config, database, query, repository } = await connection();
    if (['import', 'activate'].includes(action)) {
      const manifest = await privateJson(option('manifest'));
      const doc = await verifyCutoverManifest(manifest);
      const authority = await readTaskAuthority(manifest.storePath);
      if (!authority || authority.mode !== 'online' || authority.taskDigest !== manifest.taskDigest || authority.origin !== config.vars.MCP_ORIGIN
        || manifest.origin !== config.vars.MCP_ORIGIN || authority.databaseId !== database.database_id || authority.accountId !== config.account_id) throw new Error('Matching verified online local task fence and cloud destination are required.');
      validateTaskDocument(doc);
      if (action === 'import') {
        await query(await readFile(path.join(ROOT_DIR, 'workers/tasks/schema.sql'), 'utf8'));
        await query(`INSERT INTO lifeos_tasks (id,revision,document) SELECT 1,1,${quote(JSON.stringify(doc))} WHERE NOT EXISTS (SELECT 1 FROM lifeos_tasks WHERE id=1);`);
      }
      let row = await repository.read();
      if (!row || digest(JSON.stringify({ ...row.document, phase: 'staged' })) !== manifest.documentDigest) throw new Error('Cloud tasks differ from the verified import. No overwrite or cutover is allowed.');
      if (action === 'activate') {
        if (row.document.phase !== 'active') {
          const revision = await repository.compareAndSwap(row.revision, { ...row.document, phase: 'active' });
          if (!revision) throw new Error('Cloud tasks changed during activation. Inspect before retrying.');
          row = await repository.read();
        }
        if (row.document.phase !== 'active' || digest(JSON.stringify({ ...row.document, phase: 'staged' })) !== manifest.documentDigest) throw new Error('Cloud activation could not be verified.');
        await markTaskCutoverActive(manifest, row.revision);
      }
      console.log(JSON.stringify({ verified: true, tasks: row.document.items.length, phase: row.document.phase, revision: row.revision }));
    } else if (action === 'status') {
      const row = await repository.read(); if (row) validateTaskDocument(row.document);
      console.log(JSON.stringify({ initialized: Boolean(row), tasks: row?.document.items.length ?? null, phase: row?.document.phase ?? null, revision: row?.revision ?? null }));
    } else {
      if (!['list', 'get', 'create', 'edit', 'complete', 'trash', 'restore'].includes(action)) throw new Error('Unsupported cloud task action.');
      const input = option('input') ? await privateJson(option('input')) : {};
      console.log(JSON.stringify(await createCloudTaskService(repository)[action](input), null, 2));
    }
  }
} catch (error) {
  const safe = /^(Task |A task |Unknown project|Parent task|A subtask|Recurring tasks|Local tasks|Cloud tasks|Cloud task|Matching verified|Private |An absolute|Unsupported)/.test(error.message);
  console.error(safe ? error.message : 'Task cloud command failed. Inspect private configuration and backup artifacts locally.');
  process.exitCode = 1;
}
