#!/usr/bin/env node
// Private administration for the LifeOS cloud store (the LifeOS Cloudflare
// account's Worker and Durable Object). Prints counts and states only, never
// task content or keys.
//
//   pair   --config /private/cloud/wrangler.json
//          Creates this Mac's device key, keeps it in the Keychain and gives
//          the Worker only its SHA-256 (as the DEVICE_KEY_SHA256 secret).
//   status --config /private/cloud/wrangler.json
//   move   --config /private/cloud/wrangler.json --artifacts /private/dir [--from /private/d1-wrangler.jsonc]
//          Moves tasks from the D1 store to the Durable Object, once (see src/task-move.mjs).
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_STORE_PATH, ROOT_DIR } from '../src/lifeos-data.mjs';
import { createHttpTaskRepository, DEVICE_KEY_SERVICE, deviceKeyHash, generateDeviceKey, readDeviceKey, storeDeviceKey } from '../src/cloud-task-http.mjs';
import { createWranglerTaskConnection, readPrivateJson } from '../src/cloud-task-repository.mjs';
import { readTaskAuthority } from '../src/task-authority.mjs';
import { digest } from '../src/task-cutover.mjs';
import { moveTasksToDurableStore } from '../src/task-move.mjs';

const action = process.argv[2] || 'help';
const flags = process.argv.slice(3);
const option = name => { const index = flags.indexOf(`--${name}`); return index < 0 ? undefined : flags[index + 1]; };
const wranglerCli = path.join(ROOT_DIR, 'node_modules/wrangler/wrangler-dist/cli.js');

async function cloudConfig() {
  const file = option('config') || process.env.LIFEOS_CLOUD_STORE_CONFIG;
  const config = await readPrivateJson(file, ROOT_DIR);
  const origin = config.vars?.MCP_ORIGIN;
  if (!config.account_id || !origin || new URL(origin).origin !== origin || !origin.startsWith('https://') || origin.endsWith('.invalid')
    || !config.durable_objects?.bindings?.some(binding => binding.name === 'LIFEOS_STORE')) {
    throw new Error('Private LifeOS cloud configuration must name the approved account, HTTPS host and store.');
  }
  return { file, config, origin, accountId: config.account_id };
}

function wrangler(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', wranglerCli, ...args], {
      cwd: ROOT_DIR, stdio: ['pipe', 'ignore', 'ignore'],
      env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
    });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`Private Wrangler command failed (${args.slice(0, 2).join(' ')}).`))));
    child.stdin.end(input ?? '');
  });
}

function repository({ origin, accountId }) {
  return createHttpTaskRepository({ origin, key: () => readDeviceKey({ service: DEVICE_KEY_SERVICE, account: accountId }) });
}

// The browser-capture helper runs its own copy of these files. Without the
// new transport it would refuse the moved authority (safely), so update it first.
async function captureHelperMatches() {
  if (process.platform !== 'darwin') return;
  const installed = path.join(os.homedir(), 'Library/Application Support/LifeOS/browser-capture/src');
  if (!(await readFile(path.join(installed, 'lifeos-data.mjs')).catch(() => null))) return;
  for (const name of ['lifeos-data.mjs', 'task-authority.mjs', 'task-online.mjs', 'cloud-task-service.mjs', 'cloud-task-repository.mjs', 'cloud-task-http.mjs']) {
    const copy = await readFile(path.join(installed, name)).catch(() => null);
    if (!copy || digest(copy) !== digest(await readFile(path.join(ROOT_DIR, 'src', name)))) {
      throw new Error('Private capture helper is out of date. Run npm run capture:install first.');
    }
  }
}

try {
  if (action === 'help') {
    console.log(['LifeOS cloud store administration',
      'pair   --config /private/cloud/wrangler.json',
      'status --config /private/cloud/wrangler.json',
      'move   --config /private/cloud/wrangler.json --artifacts /private/dir [--from /private/d1-wrangler.jsonc]'].join('\n'));
  } else if (action === 'pair') {
    const cloud = await cloudConfig();
    const key = generateDeviceKey();
    await storeDeviceKey(key, { service: DEVICE_KEY_SERVICE, account: cloud.accountId });
    await wrangler(['secret', 'put', 'DEVICE_KEY_SHA256', '--config', cloud.file], deviceKeyHash(key));
    let status = null;
    for (let attempt = 0; attempt < 15 && !status; attempt++) {
      status = await repository(cloud).status().catch(error => {
        // A new secret takes a few seconds to reach every Cloudflare location.
        if (![401, 503].includes(error.status)) throw error;
        return new Promise(resolve => setTimeout(() => resolve(null), 2000));
      });
    }
    if (!status) throw new Error('Private device key was stored, but the Worker has not accepted it yet. Run status again in a minute.');
    console.log(JSON.stringify({ paired: true, origin: cloud.origin, initialized: status.initialized }));
  } else if (action === 'status') {
    const cloud = await cloudConfig();
    console.log(JSON.stringify(await repository(cloud).status()));
  } else if (action === 'move') {
    const cloud = await cloudConfig();
    const authority = await readTaskAuthority(DEFAULT_STORE_PATH);
    const fromConfig = option('from') || authority?.configFile;
    const d1 = await createWranglerTaskConnection({ configFile: fromConfig, workspaceRoot: ROOT_DIR,
      expectedOrigin: authority?.origin, expectedDatabaseId: authority?.databaseId, expectedAccountId: authority?.accountId });
    await captureHelperMatches();
    const result = await moveTasksToDurableStore({ storePath: DEFAULT_STORE_PATH, artifactDir: option('artifacts'),
      from: d1.repository, to: repository(cloud), target: { origin: cloud.origin, accountId: cloud.accountId, keychainService: DEVICE_KEY_SERVICE } });
    console.log(JSON.stringify({ moved: true, tasks: result.tasks, revision: result.revision }));
  } else {
    throw new Error('Unsupported LifeOS cloud action.');
  }
} catch (error) {
  const safe = /^(Task |Tasks |A cloud|Cloud tasks|Cloud task|Device |Private |An absolute|Unsupported|LifeOS cloud|The LifeOS)/.test(error.message);
  console.error(safe ? error.message : 'LifeOS cloud command failed. Inspect the private configuration locally.');
  process.exitCode = 1;
}

