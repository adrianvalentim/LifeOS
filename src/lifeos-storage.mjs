import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { access, chmod, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..');
export const LEGACY_STORE_PATH = path.join(ROOT_DIR, 'data', 'lifeos.json');
export const DEMO_STORE_PATH = path.join(ROOT_DIR, 'data', 'lifeos.demo.json');
export const DATA_DIRECTORY = resolveDataDirectory();
export const DEFAULT_STORE_PATH = path.join(DATA_DIRECTORY, 'lifeos.json');
export const STORAGE_CONFIG_PATH = path.join(DATA_DIRECTORY, 'storage.json');
export const BACKUP_STATUS_PATH = path.join(DATA_DIRECTORY, 'backup-status.json');

const CONFIG_VERSION = 1;

export function resolveDataDirectory(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const paths = platform === 'win32' ? path.win32 : path;
  if (env.LIFEOS_DATA_DIR) return paths.resolve(expandHome(env.LIFEOS_DATA_DIR, home, paths));
  if (platform === 'darwin') return paths.join(home, 'Library', 'Application Support', 'LifeOS');
  if (platform === 'win32') {
    return paths.join(env.APPDATA || paths.join(home, 'AppData', 'Roaming'), 'LifeOS');
  }
  return paths.join(env.XDG_DATA_HOME || paths.join(home, '.local', 'share'), 'lifeos');
}

export async function initializeDefaultStore() {
  await mkdir(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  if (await exists(DEFAULT_STORE_PATH)) return { created: false, storePath: DEFAULT_STORE_PATH };

  const sourcePath = await exists(LEGACY_STORE_PATH) ? LEGACY_STORE_PATH : DEMO_STORE_PATH;
  await copyFile(sourcePath, DEFAULT_STORE_PATH);
  await writeFilePermissions(DEFAULT_STORE_PATH);
  return { created: true, sourcePath, storePath: DEFAULT_STORE_PATH };
}

export async function readStorageConfig() {
  try {
    const config = JSON.parse(await readFile(STORAGE_CONFIG_PATH, 'utf8'));
    if (!config || config.version !== CONFIG_VERSION) throw new Error('unsupported storage configuration');
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: CONFIG_VERSION, backupDirectory: null };
    if (error instanceof SyntaxError) throw new Error(`LifeOS storage configuration is not valid JSON: ${error.message}`);
    throw error;
  }
}

export async function resolveBackupDirectory() {
  if (process.env.LIFEOS_BACKUP_DIR) {
    return path.resolve(expandHome(process.env.LIFEOS_BACKUP_DIR, os.homedir()));
  }
  const config = await readStorageConfig();
  return config.backupDirectory ? path.resolve(config.backupDirectory) : null;
}

export async function configureBackupDirectory(directory, store) {
  if (!directory || !String(directory).trim()) throw new Error('A backup directory is required.');
  const backupDirectory = path.resolve(expandHome(String(directory).trim(), os.homedir()));
  if (backupDirectory === DATA_DIRECTORY || backupDirectory.startsWith(`${DATA_DIRECTORY}${path.sep}`)) {
    throw new Error('The cloud backup directory must be outside the local LifeOS data directory.');
  }

  await mkdir(backupDirectory, { recursive: true });
  const attemptedAt = new Date().toISOString();
  await writeBackupSnapshot(store, { backupDirectory, attemptedAt });
  await atomicWriteJson(STORAGE_CONFIG_PATH, { version: CONFIG_VERSION, backupDirectory }, 0o600);
  await recordBackupStatus({ ok: true, attemptedAt, completedAt: new Date().toISOString(), backupDirectory });
  return getStorageStatus();
}

export async function disableBackupDirectory() {
  await mkdir(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  await atomicWriteJson(STORAGE_CONFIG_PATH, { version: CONFIG_VERSION, backupDirectory: null }, 0o600);
  return getStorageStatus();
}

export async function backUpStore(store, { timeoutMs = 0 } = {}) {
  if (timeoutMs > 0) return backUpStoreWithDeadline(store, timeoutMs);
  let backupDirectory;
  const attemptedAt = new Date().toISOString();
  try {
    backupDirectory = await resolveBackupDirectory();
    if (!backupDirectory) return { configured: false, ok: null };
    const result = await writeBackupSnapshot(store, { backupDirectory, attemptedAt });
    await recordBackupStatus({ ok: true, attemptedAt, completedAt: new Date().toISOString(), backupDirectory });
    return { configured: true, ok: true, ...result };
  } catch (error) {
    await recordBackupStatus({ ok: false, attemptedAt, backupDirectory, error: error.message }).catch(() => undefined);
    return { configured: true, ok: false, backupDirectory, error: error.message };
  }
}

async function backUpStoreWithDeadline(store, timeoutMs) {
  const attemptedAt = new Date().toISOString();
  try {
    // Filesystem calls to a stalled cloud provider cannot be cancelled reliably
    // in-process. Isolate only the optional snapshot so the local writer can exit.
    return await new Promise((resolve, reject) => {
      const child = fork(new URL('../scripts/capture-backup-worker.mjs', import.meta.url), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let response;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.once('message', (message) => { response = message; });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (timedOut) reject(new Error('Cloud backup took too long. The local save is complete.'));
        else if (response && typeof response === 'object') resolve(response);
        else reject(new Error('Cloud backup stopped before completion. The local save is complete.'));
      });
      child.send(store, (error) => { if (error) { child.kill(); reject(error); } });
    });
  } catch (error) {
    await recordBackupStatus({ ok: false, attemptedAt, error: error.message }).catch(() => undefined);
    return { configured: true, ok: false, error: error.message };
  }
}

export async function writeBackupSnapshot(store, options = {}) {
  const backupDirectory = options.backupDirectory || await resolveBackupDirectory();
  if (!backupDirectory) throw new Error('No cloud backup directory is configured.');
  const attemptedAt = options.attemptedAt || new Date().toISOString();
  const snapshotDate = dateInTimeZone(attemptedAt, store?.meta?.timezone || 'UTC');
  const month = snapshotDate.slice(0, 7);
  const dailyDirectory = path.join(backupDirectory, 'daily');
  const monthlyDirectory = path.join(backupDirectory, 'monthly');
  await Promise.all([
    mkdir(backupDirectory, { recursive: true }),
    mkdir(dailyDirectory, { recursive: true }),
    mkdir(monthlyDirectory, { recursive: true }),
  ]);

  const latestPath = path.join(backupDirectory, 'latest.json');
  const dailyPath = path.join(dailyDirectory, `${snapshotDate}.json`);
  const monthlyPath = path.join(monthlyDirectory, `${month}.json`);
  await Promise.all([
    atomicWriteJson(latestPath, store),
    atomicWriteJson(dailyPath, store),
    atomicWriteJson(monthlyPath, store),
  ]);
  return { backupDirectory, latestPath, dailyPath, monthlyPath, snapshotDate };
}

export async function getStorageStatus() {
  const backupDirectory = await resolveBackupDirectory();
  const backupStatus = await readJsonIfPresent(BACKUP_STATUS_PATH);
  const latestPath = backupDirectory ? path.join(backupDirectory, 'latest.json') : null;
  let latestSnapshotAt = null;
  if (latestPath) {
    try {
      latestSnapshotAt = (await stat(latestPath)).mtime.toISOString();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return {
    dataDirectory: DATA_DIRECTORY,
    storePath: DEFAULT_STORE_PATH,
    backupConfigured: Boolean(backupDirectory),
    backupDirectory,
    latestSnapshotAt,
    lastBackup: backupStatus,
    detectedGoogleDrives: await discoverGoogleDriveRoots(),
  };
}

export async function discoverGoogleDriveRoots(options = {}) {
  if ((options.platform || process.platform) !== 'darwin') return [];
  const home = options.home || os.homedir();
  const cloudStorage = path.join(home, 'Library', 'CloudStorage');
  let names;
  try {
    names = await readdir(cloudStorage, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const candidates = names
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('GoogleDrive-'))
    .map((entry) => path.join(cloudStorage, entry.name, 'My Drive'));
  const roots = [];
  for (const candidate of candidates) {
    if (await exists(candidate)) roots.push(candidate);
  }
  return roots.sort();
}

async function recordBackupStatus(status) {
  await mkdir(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  await atomicWriteJson(BACKUP_STATUS_PATH, status, 0o600);
}

async function atomicWriteJson(targetPath, value, mode) {
  const directory = path.dirname(targetPath);
  const filename = path.basename(targetPath);
  const tempPath = path.join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await unlink(targetPath).catch((unlinkError) => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    await rename(tempPath, targetPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return { ok: false, error: `Invalid status file: ${error.message}` };
    throw error;
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeFilePermissions(filePath) {
  if (process.platform === 'win32') return;
  await chmod(filePath, 0o600);
}

function expandHome(value, home, paths = path) {
  if (value === '~') return home;
  if (value.startsWith(`~${paths.sep}`)) return paths.join(home, value.slice(2));
  return value;
}

function dateInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const keyed = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${keyed.year}-${keyed.month}-${keyed.day}`;
}
