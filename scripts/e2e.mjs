#!/usr/bin/env node
// `npm run test:e2e [-- playwright args]`: makes sure the pinned Chromium is in
// the LifeOS cache (a quick no-op once it is), then runs the browser suite.
// Headless runs need only Chromium's headless shell; --headed, --debug and
// --ui also fetch the full browser.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { BROWSERS_PATH, ROOT } from '../tests/e2e/environment.mjs';

const args = process.argv.slice(2);
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS_PATH };
const cli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const visible = args.some((arg) => ['--headed', '--debug', '--ui'].includes(arg));

const installed = await playwright(['install', ...(visible ? [] : ['--only-shell']), 'chromium']);
if (installed !== 0) {
  console.error(`Could not install Chromium into ${BROWSERS_PATH}.`);
  process.exit(installed);
}
process.exitCode = await playwright(['test', '--config', path.join(ROOT, 'tests', 'e2e', 'playwright.config.mjs'), ...args]);

function playwright(cliArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...cliArgs], { cwd: ROOT, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
