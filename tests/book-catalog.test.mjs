import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichOpenLibraryBook, normalizeOpenLibraryDocument, searchOpenLibrary } from '../src/book-catalog.mjs';

test('Open Library search results normalize to the local Reading shape', () => {
  const book = normalizeOpenLibraryDocument({
    key: '/works/OL45883W',
    title: 'A Book',
    subtitle: 'A Subtitle',
    author_name: ['A. Reader'],
    first_publish_year: 1999,
    cover_i: 1234,
    edition_key: ['OL999M'],
    isbn: ['123456789X', '9781234567897'],
    language: ['eng'],
    number_of_pages_median: 320,
    publisher: ['Example Press'],
    subject: ['Fiction', 'Journeys'],
  });

  assert.equal(book.source.workId, 'OL45883W');
  assert.equal(book.source.editionId, 'OL999M');
  assert.equal(book.isbn13, '9781234567897');
  assert.equal(book.coverUrl, 'https://covers.openlibrary.org/b/id/1234-L.jpg?default=false');
  assert.deepEqual(book.authors, ['A. Reader']);
});

test('Open Library search requests a bounded result set and maps documents', async () => {
  let requestedUrl;
  const results = await searchOpenLibrary('book title', {
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => ({ docs: [{ key: '/works/OL1W', title: 'Book title' }] }) };
    },
  });

  assert.equal(requestedUrl.origin, 'https://openlibrary.org');
  assert.equal(requestedUrl.searchParams.get('q'), 'book title');
  assert.equal(requestedUrl.searchParams.get('limit'), '12');
  assert.equal(results[0].title, 'Book title');
});

test('Open Library work details enrich description without making import fragile', async () => {
  const base = normalizeOpenLibraryDocument({ key: '/works/OL1W', title: 'Book title' });
  const enriched = await enrichOpenLibraryBook(base, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ description: { value: 'A useful description.' }, subjects: ['History'] }) }),
  });
  assert.equal(enriched.description, 'A useful description.');
  assert.deepEqual(enriched.subjects, ['History']);

  const fallback = await enrichOpenLibraryBook(base, { fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(fallback, base);
});
