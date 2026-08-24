const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const OPEN_LIBRARY_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'first_publish_year',
  'cover_i',
  'edition_key',
  'isbn',
  'language',
  'number_of_pages_median',
  'publisher',
  'subject',
].join(',');

export async function searchOpenLibrary(query, options = {}) {
  const cleanQuery = cleanText(query, 160);
  if (!cleanQuery) throw new Error('Enter a title, author, or ISBN.');
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set('q', cleanQuery);
  url.searchParams.set('fields', OPEN_LIBRARY_FIELDS);
  url.searchParams.set('limit', String(Math.min(20, Math.max(1, Number(options.limit) || 12))));
  const body = await fetchOpenLibraryJson(url, options);
  return (Array.isArray(body.docs) ? body.docs : [])
    .map(normalizeOpenLibraryDocument)
    .filter(Boolean);
}

export function normalizeOpenLibraryDocument(document) {
  if (!document || typeof document !== 'object') return null;
  const title = cleanText(document.title, 300);
  const workId = String(document.key || '').match(/^\/works\/(OL\d+W)$/)?.[1] || null;
  if (!title || !workId) return null;
  const identifiers = Array.isArray(document.isbn) ? document.isbn.map((value) => String(value).replace(/[^0-9X]/gi, '').toUpperCase()) : [];
  const isbn13 = identifiers.find((value) => value.length === 13) || null;
  const isbn10 = identifiers.find((value) => value.length === 10) || null;
  const coverId = Number(document.cover_i);
  const year = Number(document.first_publish_year);
  const pageCount = Number(document.number_of_pages_median);
  const editionId = Array.isArray(document.edition_key) ? cleanText(document.edition_key[0], 100) || null : null;
  return {
    title,
    subtitle: cleanText(document.subtitle, 400) || null,
    authors: cleanList(document.author_name, 12, 180),
    description: null,
    coverUrl: Number.isInteger(coverId) && coverId > 0
      ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`
      : null,
    isbn10,
    isbn13,
    publisher: cleanList(document.publisher, 1, 300)[0] || null,
    publishedYear: Number.isInteger(year) && year > 0 ? year : null,
    language: cleanList(document.language, 1, 30)[0] || null,
    pageCount: Number.isFinite(pageCount) && pageCount > 0 ? Math.round(pageCount) : null,
    subjects: cleanList(document.subject, 8, 120),
    source: {
      provider: 'open_library',
      workId,
      editionId,
      url: `${OPEN_LIBRARY_BASE_URL}/works/${workId}`,
      fetchedAt: new Date().toISOString(),
    },
  };
}

export async function enrichOpenLibraryBook(book, options = {}) {
  const workId = String(book?.source?.workId || '');
  if (!/^OL\d+W$/.test(workId)) return book;
  try {
    const work = await fetchOpenLibraryJson(`${OPEN_LIBRARY_BASE_URL}/works/${workId}.json`, options);
    const description = typeof work.description === 'string'
      ? work.description
      : typeof work.description?.value === 'string'
        ? work.description.value
        : null;
    const coverId = Array.isArray(work.covers) ? Number(work.covers.find((value) => Number(value) > 0)) : null;
    return {
      ...book,
      description: cleanText(description, 12_000) || book.description || null,
      coverUrl: book.coverUrl || (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : null),
      subjects: book.subjects?.length ? book.subjects : cleanList(work.subjects, 8, 120),
      source: { ...book.source, fetchedAt: new Date().toISOString() },
    };
  } catch {
    // Search results remain useful even if the optional work-detail request fails.
    return book;
  }
}

async function fetchOpenLibraryJson(url, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Book search is unavailable in this Node runtime.');
  const response = await fetchImpl(String(url), {
    headers: {
      accept: 'application/json',
      'user-agent': 'LifeOS/0.1 (local personal reading catalog)',
    },
    signal: options.signal || AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Open Library request failed (${response.status}).`);
  return response.json();
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function cleanList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}
