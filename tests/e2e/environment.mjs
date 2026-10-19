// Where the browser suite keeps everything it downloads or writes: the pinned
// Chromium build, one throwaway store per test, and failure traces. None of it
// belongs in Git or on a small system disk, so on macOS it lives with the
// other LifeOS build caches (the sisyphus data disk when it is mounted).
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_STORE = path.join(ROOT, 'data', 'lifeos.demo.json');

function cacheRoot() {
  if (process.env.LIFEOS_E2E_DIR) return path.resolve(process.env.LIFEOS_E2E_DIR);
  if (process.platform !== 'darwin') return path.join(ROOT, '.cache');
  const sisyphusCaches = '/Volumes/sisyphus/Library/Caches';
  return path.join(existsSync(sisyphusCaches) ? sisyphusCaches : path.join(os.homedir(), 'Library', 'Caches'), 'LifeOS');
}

export const CACHE_ROOT = cacheRoot();
export const BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(CACHE_ROOT, 'ms-playwright');
export const STORES_DIR = path.join(CACHE_ROOT, 'e2e', 'stores');
export const RESULTS_DIR = path.join(CACHE_ROOT, 'e2e', 'results');
