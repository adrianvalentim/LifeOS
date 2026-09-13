#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIRECTORY } from '../src/lifeos-storage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'extensions/lifeos-capture/manifest.json'), 'utf8'));
const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
  .slice(0, 32).replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + parseInt(value, 16)));
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

// Only authored runtime files are deployed. No personal store, demo seed,
// credentials, development dependencies, or browser profile is copied.
const RUNTIME_FILES = [
  'src/lifeos-data.mjs', 'src/lifeos-storage.mjs', 'public/web-links.js',
  'scripts/capture-native-host.mjs', 'scripts/capture-backup-worker.mjs',
];

async function copyRuntimeFile(relativePath, installRoot) {
  const destination = path.join(installRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(path.join(root, relativePath), destination);
  await chmod(destination, 0o600);
}

async function copyExtensionTree(relativeDirectory, installRoot) {
  for (const item of await readdir(path.join(root, relativeDirectory), { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'README.md') continue;
    const relativePath = path.join(relativeDirectory, item.name);
    if (item.isDirectory()) await copyExtensionTree(relativePath, installRoot);
    else if (item.isFile()) await copyRuntimeFile(relativePath, installRoot);
  }
}

export async function installCaptureHost({ home = os.homedir(), nodePath, dataDirectory = DATA_DIRECTORY } = {}) {
  if (process.platform !== 'darwin') throw new Error('This first release installs the LifeOS helper on macOS.');
  if (!nodePath) {
    nodePath = process.execPath;
    // Keep Homebrew upgrades from invalidating a versioned Cellar path.
    for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
      if (await realpath(candidate).catch(() => null) === await realpath(process.execPath)) {
        nodePath = candidate;
        break;
      }
    }
  }
  const support = path.join(home, 'Library', 'Application Support');
  const helperDirectory = path.join(support, 'LifeOS', 'browser-capture');
  // Brave's PreSandboxStartup overrides native-messaging discovery to Chrome's
  // locations on macOS. Its browser profile directory is not searched here.
  // https://github.com/brave/brave-core/blob/master/app/brave_main_delegate.cc
  const hostDirectory = path.join(support, 'Google', 'Chrome', 'NativeMessagingHosts');
  await mkdir(helperDirectory, { recursive: true, mode: 0o700 });
  await mkdir(hostDirectory, { recursive: true, mode: 0o700 });
  for (const file of RUNTIME_FILES) await copyRuntimeFile(file, helperDirectory);
  await copyExtensionTree('extensions/lifeos-capture', helperDirectory);
  // .js modules share the repository's ESM mode without copying its dev config.
  await writeFile(path.join(helperDirectory, 'package.json'), '{"type":"module","private":true}\n', { mode: 0o600 });
  const launcher = path.join(helperDirectory, 'lifeos-capture');
  // Absolute paths avoid depending on the PATH/environment of a Dock-launched browser.
  const script = `#!/bin/sh\nexport LIFEOS_DATA_DIR=${quote(path.resolve(dataDirectory))}\nexec ${quote(nodePath)} ${quote(path.join(helperDirectory, 'scripts/capture-native-host.mjs'))} "$@"\n`;
  await writeFile(launcher, script, { mode: 0o700 });
  await chmod(launcher, 0o700);
  const hostPath = path.join(hostDirectory, 'com.lifeos.capture.json');
  await writeFile(hostPath, `${JSON.stringify({
    name: 'com.lifeos.capture', description: 'Save a webpage as a local LifeOS task',
    path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2)}\n`, { mode: 0o600 });
  return { extensionId, extensionDirectory: path.join(helperDirectory, 'extensions/lifeos-capture'), hostPath, launcher };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const installed = await installCaptureHost();
  console.log(`LifeOS Capture helper installed for Brave.\nExtension ID: ${installed.extensionId}\nLoad unpacked: ${installed.extensionDirectory}`);
}
