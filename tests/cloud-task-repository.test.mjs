import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWranglerTaskConnection } from '../src/cloud-task-repository.mjs';

test('private query transport returns SELECT/CAS rows without SQL in the OS command line', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-query-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspaceRoot = path.join(dir, 'workspace');
  const cli = path.join(workspaceRoot, 'node_modules/wrangler/wrangler-dist/cli.js');
  await mkdir(path.dirname(cli), { recursive: true });
  // A controlled CLI endpoint exercises the real Node preloader and subprocess
  // path. Bulk-import mode cannot return these SELECT/RETURNING rows.
  await writeFile(cli, `
    const {execFileSync}=require('node:child_process');
    const sql=process.argv.find(arg=>arg.startsWith('--command='))?.slice('--command='.length);
    if (!sql || sql.startsWith('/')) throw new Error('Query was not loaded');
    if (process.platform!=='win32') {
      const command=execFileSync('ps',['-p',String(process.pid),'-o','command='],{encoding:'utf8'});
      if(command.includes('private-fixture-content')) throw new Error('SQL exposed in process arguments');
    }
    const results=sql.includes('SELECT')
      ? [{document:JSON.stringify({items:[]}),revision:1}]
      : sql.includes('revision=999') ? [] : [{revision:2}];
    process.stdout.write(JSON.stringify([{success:true,results}]));
  `);
  const configFile = path.join(dir, 'private-config.json');
  await writeFile(configFile, JSON.stringify({ account_id: 'fixture-account', vars: { MCP_ORIGIN: 'https://fixture.example' },
    d1_databases: [{ binding: 'TASKS_DB', database_name: 'fixture-db', database_id: 'fixture-id' }] }), { mode: 0o600 });
  const { repository, query } = await createWranglerTaskConnection({ configFile, workspaceRoot });
  assert.deepEqual(await repository.read(), { document: { items: [] }, revision: 1 });
  assert.deepEqual(await query('-- fictional leading comment\nSELECT document,revision FROM lifeos_tasks;'), [{ document: '{"items":[]}', revision: 1 }]);
  assert.equal(await repository.compareAndSwap(1, { notes: 'private-fixture-content' }), 2);
  assert.equal(await repository.compareAndSwap(999, { notes: 'private-fixture-content' }), null);
  await assert.rejects(createWranglerTaskConnection({ configFile, workspaceRoot, tableName: 'untrusted; DROP TABLE lifeos_tasks' }), /unavailable/);
});
