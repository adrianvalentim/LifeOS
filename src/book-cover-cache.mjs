import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_STORE_PATH } from './lifeos-storage.mjs';

const OPEN_LIBRARY_COVER_HOST = 'covers.openlibrary.org';
const MAX_COVER_BYTES = 1024 * 1024;
const coverLoads = new Map();

export function readingCoverCacheDirectory(storePath = DEFAULT_STORE_PATH) {
  return path.join(path.dirname(storePath), 'reading-covers');
}

export function readingCoverCachePath(bookId, storePath = DEFAULT_STORE_PATH) {
  const key = createHash('sha256').update(String(bookId)).digest('hex');
  return path.join(readingCoverCacheDirectory(storePath), `${key}.cover`);
}

export async function getOrCacheReadingBookCover(book, storePath = DEFAULT_STORE_PATH, options = {}) {
  if (!book?.id || !isOpenLibraryCover(book)) return null;
  const cachePath = readingCoverCachePath(book.id, storePath);
  const cached = await readCachedCover(cachePath);
  if (cached) return cached;
  if (coverLoads.has(cachePath)) return coverLoads.get(cachePath);

  const load = downloadCover(book.coverUrl, cachePath, options)
    .finally(() => coverLoads.delete(cachePath));
  coverLoads.set(cachePath, load);
  return load;
}

export async function deleteCachedReadingBookCover(bookId, storePath = DEFAULT_STORE_PATH) {
  if (!bookId) return false;
  try {
    await unlink(readingCoverCachePath(bookId, storePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function downloadCover(sourceUrl, cachePath, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Book cover caching is unavailable in this Node runtime.');
  const response = await fetchImpl(mediumOpenLibraryCoverUrl(sourceUrl), {
    headers: {
      accept: 'image/jpeg,image/png,image/webp',
      'user-agent': 'LifeOS/0.1 (local personal reading catalog)',
    },
    signal: options.signal || AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Open Library cover request failed (${response.status}).`);

  const declaredSize = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_COVER_BYTES) {
    throw new Error('Open Library cover is larger than the local cache limit.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_COVER_BYTES) {
    throw new Error('Open Library cover is empty or larger than the local cache limit.');
  }
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) throw new Error('Open Library returned an unsupported cover format.');

  await atomicWriteCover(cachePath, bytes);
  return coverResponse(cachePath, bytes, mimeType);
}

async function readCachedCover(cachePath) {
  try {
    const bytes = await readFile(cachePath);
    const mimeType = detectImageMimeType(bytes);
    if (bytes.length && bytes.length <= MAX_COVER_BYTES && mimeType) {
      return coverResponse(cachePath, bytes, mimeType);
    }
    await unlink(cachePath);
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWriteCover(cachePath, bytes) {
  const directory = path.dirname(cachePath);
  const tempPath = path.join(directory, `.${path.basename(cachePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(tempPath, bytes, { mode: 0o600 });
  try {
    await rename(tempPath, cachePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await unlink(cachePath).catch((unlinkError) => {
      if (unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    await rename(tempPath, cachePath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function isOpenLibraryCover(book) {
  if (book.source?.provider !== 'open_library' || !book.coverUrl) return false;
  try {
    const url = new URL(book.coverUrl);
    return url.protocol === 'https:' && url.hostname === OPEN_LIBRARY_COVER_HOST;
  } catch {
    return false;
  }
}

function mediumOpenLibraryCoverUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  url.pathname = url.pathname.replace(/-[SML]\.jpg$/i, '-M.jpg');
  return url.toString();
}

function detectImageMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function coverResponse(cachePath, bytes, mimeType) {
  const digest = createHash('sha256').update(bytes).digest('base64url').slice(0, 24);
  return { cachePath, bytes, mimeType, etag: `"${digest}"` };
}
