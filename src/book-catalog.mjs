const OPEN_LIBRARY_SEARCH_URL = 'https://openlibrary.org/search.json';
const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const OPEN_LIBRARY_PAGE_SIZE = 20;
const OPEN_LIBRARY_MAX_PAGE = 50;
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
  const page = Math.min(OPEN_LIBRARY_MAX_PAGE, Math.max(1, Math.trunc(Number(options.page)) || 1));
  const limit = Math.min(OPEN_LIBRARY_PAGE_SIZE, Math.max(1, Math.trunc(Number(options.limit)) || OPEN_LIBRARY_PAGE_SIZE));
  const searchQuery = openLibrarySearchQuery(cleanQuery);
  const url = new URL(OPEN_LIBRARY_SEARCH_URL);
  url.searchParams.set('q', searchQuery.query);
  url.searchParams.set('fields', OPEN_LIBRARY_FIELDS);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  const body = await fetchOpenLibraryJson(url, { ...options, timeoutMs: options.timeoutMs || 20_000 });
  const results = (Array.isArray(body.docs) ? body.docs : [])
    .map(normalizeOpenLibraryDocument)
    .filter(Boolean);
  const reportedTotal = Number(body.numFound ?? body.num_found);
  const total = Number.isFinite(reportedTotal) && reportedTotal >= 0
    ? Math.trunc(reportedTotal)
    : (page - 1) * limit + results.length;
  return {
    results,
    page,
    pageSize: limit,
    total,
    hasMore: page < OPEN_LIBRARY_MAX_PAGE && page * limit < total,
    queryType: searchQuery.type,
  };
}

export function openLibrarySearchQuery(query) {
  const cleanQuery = cleanText(query, 160);
  const candidate = cleanQuery
    .replace(/^isbn(?:-1[03])?\s*:?\s*/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  if (isValidIsbn(candidate)) return { query: `isbn:${candidate}`, type: 'isbn' };
  return { query: cleanQuery, type: 'text' };
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
      ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`
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
      coverUrl: book.coverUrl || (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false` : null),
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
      'user-agent': 'LifeOS/0.1 (https://github.com/adrianvalentim/LifeOS)',
    },
    signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs) || 10_000),
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

function isValidIsbn(value) {
  if (/^\d{13}$/.test(value)) {
    const sum = [...value.slice(0, 12)].reduce((total, digit, index) => (
      total + Number(digit) * (index % 2 === 0 ? 1 : 3)
    ), 0);
    return (10 - (sum % 10)) % 10 === Number(value[12]);
  }
  if (/^\d{9}[\dX]$/.test(value)) {
    const sum = [...value].reduce((total, digit, index) => (
      total + (digit === 'X' ? 10 : Number(digit)) * (10 - index)
    ), 0);
    return sum % 11 === 0;
  }
  return false;
}
