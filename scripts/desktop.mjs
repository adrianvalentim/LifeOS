#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const command = process.argv[2] || 'dev';
const extraArgs = process.argv.slice(3);
const targetDirectory = process.env.CARGO_TARGET_DIR || defaultTargetDirectory();
const environment = { ...process.env, CARGO_TARGET_DIR: targetDirectory };

let executable;
let args;
if (command === 'check') {
  executable = 'cargo';
  args = ['check', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml'), ...extraArgs];
} else if (command === 'dev' || command === 'build') {
  executable = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
  args = command === 'build' ? ['build', '--bundles', 'app', ...extraArgs] : ['dev', ...extraArgs];
} else {
  console.error(`Unknown desktop command: ${command}`);
  process.exit(1);
}

const child = spawn(executable, args, {
  cwd: root,
  env: environment,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.once('error', (error) => {
  console.error(`Could not run LifeOS desktop ${command}: ${error.message}`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`LifeOS desktop ${command} stopped with ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
  if (code === 0 && command === 'build') {
    console.log(`LifeOS macOS app: ${path.join(targetDirectory, 'release', 'bundle', 'macos', 'LifeOS Dev.app')}`);
  }
});

function defaultTargetDirectory() {
  if (process.platform !== 'darwin') return path.join(root, 'src-tauri', 'target');
  // Build on the sisyphus data disk (APFS) rather than the small internal disk; fall back when it isn't mounted.
  const sisyphusCaches = '/Volumes/sisyphus/Library/Caches';
  const cacheRoot = existsSync(sisyphusCaches) ? sisyphusCaches : path.join(os.homedir(), 'Library', 'Caches');
  return path.join(cacheRoot, 'LifeOS', 'cargo-target');
}
