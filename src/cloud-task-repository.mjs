// Local administration transport. Wrangler keeps its existing encrypted,
// Keychain-backed credentials; this module never reads or copies those tokens.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
export const quoteSql = value => `'${String(value).replaceAll("'", "''")}'`;
export async function readPrivateJson(file, workspaceRoot) {
  if (!file || !path.isAbsolute(file)) throw new Error('An absolute private configuration/input path is required.');
  const resolved = await realpath(file), info = await stat(resolved);
  const root = await realpath(workspaceRoot);
  if (!info.isFile() || info.mode & 0o077 || resolved === root || resolved.startsWith(root + path.sep)) throw new Error('Private files must be mode 0600 outside Git.');
  return JSON.parse(await readFile(resolved, 'utf8'));
}
export async function createWranglerTaskConnection({ configFile, workspaceRoot, expectedOrigin, expectedDatabaseId, expectedAccountId, tableName = 'lifeos_tasks' }) {
  // The second table is an isolated fictional acceptance store. Production
  // callers always use the fixed default; no SQL identifier comes from tasks.
  if (!['lifeos_tasks', 'lifeos_adapter_fixture'].includes(tableName)) throw new Error('Task repository table is unavailable.');
  const config = await readPrivateJson(configFile, workspaceRoot);
  const database = config.d1_databases?.find(binding => binding.binding === 'TASKS_DB');
  if (!database || !config.account_id || !config.vars?.MCP_ORIGIN
    || expectedOrigin && config.vars.MCP_ORIGIN !== expectedOrigin
    || expectedDatabaseId && database.database_id !== expectedDatabaseId
    || expectedAccountId && config.account_id !== expectedAccountId) throw new Error('Private task connection does not match the approved destination.');
  async function query(sql) {
    if (Buffer.byteLength(sql) > 99000) throw new Error('Task query exceeds the CLI import limit; use a reviewed storage adapter.');
    const dir = await mkdtemp(path.join(path.dirname(configFile), 'query-'));
    const file = path.join(dir, 'private.sql');
    try {
      await writeFile(file, sql, { mode: 0o600 });
      let stdout;
      try {
        ({ stdout } = await run(process.execPath, ['--no-warnings', '--import', fileURLToPath(new URL('./task-query-bootstrap.mjs', import.meta.url)),
          path.join(workspaceRoot, 'node_modules/wrangler/wrangler-dist/cli.js'), 'd1', 'execute', database.database_name,
          '--remote', '--config', configFile, '--command', file, '--json'], { cwd: workspaceRoot, maxBuffer: 8000000, timeout: 7000,
          env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' } }));
      } catch { throw new Error('Cloud task database command failed. Verify approved D1 access and connectivity.'); }
      const responses = JSON.parse(stdout);
      if (!Array.isArray(responses) || responses.some(r => r.success === false)) throw new Error('Cloud task database query was not confirmed.');
      return responses.flatMap(r => r.results || []);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  const repository = {
    async read() { const [row] = await query(`SELECT document, revision FROM ${tableName} WHERE id=1;`); return row ? { document: JSON.parse(row.document), revision: row.revision } : null; },
    async compareAndSwap(revision, document) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Task revision is invalid.');
      const [row] = await query(`UPDATE ${tableName} SET document=${quoteSql(JSON.stringify(document))}, revision=revision+1 WHERE id=1 AND revision=${revision} RETURNING revision;`);
      return row?.revision ?? null;
    },
  };
  return { config, database, query, repository };
}
