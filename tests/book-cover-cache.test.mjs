import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deleteCachedReadingBookCover,
  getOrCacheReadingBookCover,
  readingCoverCachePath,
} from '../src/book-cover-cache.mjs';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

function savedBook() {
  return {
    id: 'saved-book',
    title: 'Saved book',
    coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false',
    source: { provider: 'open_library' },
  };
}

test('saved Open Library covers cache one medium image beside the store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeos-cover-cache-'));
  const storePath = path.join(directory, 'lifeos.json');
  let fetchCount = 0;
  let requestedUrl;
  const fetchImpl = async (url) => {
    fetchCount += 1;
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(JPEG.length) }),
      arrayBuffer: async () => JPEG,
    };
  };

  const first = await getOrCacheReadingBookCover(savedBook(), storePath, { fetchImpl });
  const second = await getOrCacheReadingBookCover(savedBook(), storePath, { fetchImpl });

  assert.equal(requestedUrl, 'https://covers.openlibrary.org/b/id/123-M.jpg?default=false');
  assert.equal(fetchCount, 1);
  assert.equal(first.mimeType, 'image/jpeg');
  assert.deepEqual(second.bytes, JPEG);
  assert.deepEqual(await readFile(readingCoverCachePath('saved-book', storePath)), JPEG);
});

test('cached covers are removed with their saved book', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeos-cover-delete-'));
  const storePath = path.join(directory, 'lifeos.json');
  await getOrCacheReadingBookCover(savedBook(), storePath, {
    fetchImpl: async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => JPEG }),
  });

  assert.equal(await deleteCachedReadingBookCover('saved-book', storePath), true);
  await assert.rejects(readFile(readingCoverCachePath('saved-book', storePath)), { code: 'ENOENT' });
  assert.equal(await deleteCachedReadingBookCover('saved-book', storePath), false);
});
