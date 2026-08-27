import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReadingUiState,
  readingWithBookPosition,
  readingWithBookStatus,
  renderReading,
  sortReadingBooks,
} from '../public/reading.js';

function fixture() {
  return {
    books: [
      { id: 'one', title: 'One', authors: ['A'], status: 'next_up', sortOrder: 1, tags: [] },
      {
        id: 'two',
        title: 'Two',
        authors: ['B'],
        status: 'reading',
        sortOrder: 1,
        tags: [],
        coverUrl: 'https://covers.openlibrary.org/b/id/2-L.jpg?default=false',
        source: { provider: 'open_library' },
      },
      { id: 'three', title: 'Three', authors: ['C'], status: 'reading', sortOrder: 2, tags: [] },
    ],
    summary: {
      total: 3,
      boardTotal: 3,
      byStatus: { to_read: 0, next_up: 1, reading: 2, finished: 0, dropped: 0 },
    },
  };
}

test('optimistic reading status moves are immutable and update board counts', () => {
  const original = fixture();
  const moved = readingWithBookStatus(original, 'two', 'finished');

  assert.notEqual(moved, original);
  assert.equal(original.books[1].status, 'reading');
  assert.equal(moved.books[1].status, 'finished');
  assert.equal(moved.summary.byStatus.reading, 1);
  assert.equal(moved.summary.byStatus.finished, 1);
  assert.equal(moved.summary.boardTotal, 3);
});

test('optimistic reading placement changes queue order and can cross columns', () => {
  const original = fixture();
  const reordered = readingWithBookPosition(original, 'three', 'reading', 'two');
  const readingIds = reordered.books
    .filter((book) => book.status === 'reading')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((book) => book.id);
  assert.deepEqual(readingIds, ['three', 'two']);

  const moved = readingWithBookPosition(reordered, 'three', 'next_up', 'one');
  const nextIds = moved.books
    .filter((book) => book.status === 'next_up')
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((book) => book.id);
  assert.deepEqual(nextIds, ['three', 'one']);
  assert.equal(moved.summary.byStatus.next_up, 2);
  assert.equal(moved.summary.byStatus.reading, 1);
});

test('Kanban cards omit redundant status and order controls while retaining sortable semantics', () => {
  const ui = createReadingUiState();
  ui.movingBookId = 'two';
  const html = renderReading(fixture(), ui);

  assert.match(html, /data-reading-drag-id="two"/);
  assert.doesNotMatch(html, /data-codex-context-kind/);
  assert.doesNotMatch(html, /draggable="true"/);
  assert.match(html, /class="reading-card is-saving"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-roledescription="sortable book"/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /data-reading-reorder/);
  assert.doesNotMatch(html, /data-reading-status-book/);
  assert.match(html, /src="\/api\/reading\/books\/two\/cover"/);
  assert.doesNotMatch(html, /src="https:\/\/covers\.openlibrary\.org\/b\/id\/2-L\.jpg/);
});

test('Finished Kanban shows only books read in the configured current year', () => {
  const reading = fixture();
  reading.books.push(
    { id: 'current-finished', title: 'Current Read', authors: ['C'], status: 'finished', sortOrder: 1, tags: [], finishedAt: '2026-04-03T12:00:00Z' },
    { id: 'previous-finished', title: 'Previous Read', authors: ['P'], status: 'finished', sortOrder: 2, tags: [], finishedAt: '2025-12-31T12:00:00Z' },
    { id: 'local-boundary', title: 'Local Boundary Read', authors: ['L'], status: 'finished', sortOrder: 3, tags: [], finishedAt: '2027-01-01T01:30:00Z' },
  );
  reading.summary.total += 3;
  reading.summary.byStatus.finished += 3;
  const html = renderReading(reading, createReadingUiState(), {
    today: '2026-08-24',
    timeZone: 'America/Sao_Paulo',
  });

  assert.match(html, /data-reading-drag-id="current-finished"/);
  assert.match(html, /data-reading-drag-id="local-boundary"/);
  assert.doesNotMatch(html, /data-reading-drag-id="previous-finished"/);
  assert.match(html, /class="reading-column-period">2026</);
  assert.match(html, /status-finished[\s\S]*class="column-count">2</);
});

test('Finished book details expose manual date editing in the configured timezone', () => {
  const reading = fixture();
  reading.books.push({
    id: 'local-boundary',
    title: 'Local Boundary Read',
    authors: ['L'],
    status: 'finished',
    sortOrder: 1,
    tags: [],
    finishedAt: '2027-01-01T01:30:00Z',
  });
  reading.summary.total += 1;
  reading.summary.byStatus.finished += 1;
  const ui = createReadingUiState();
  ui.selectedBookId = 'local-boundary';
  const html = renderReading(reading, ui, {
    today: '2026-08-24',
    timeZone: 'America/Sao_Paulo',
  });

  assert.match(html, /class="book-detail-finished-date"/);
  assert.match(html, /data-reading-finished-date-book="local-boundary"/);
  assert.match(html, /data-codex-context-kind="book"/);
  assert.match(html, /data-codex-context-id="local-boundary"/);
  assert.equal((html.match(/data-codex-context-id=/g) || []).length, 1);
  assert.match(html, /value="2026-12-31"/);
});

test('Library keeps visible non-drag status controls', () => {
  const ui = createReadingUiState();
  ui.view = 'library';
  const html = renderReading(fixture(), ui);

  assert.match(html, /data-reading-status-book="two"/);
  assert.match(html, /aria-label="Status for Two"/);
  assert.doesNotMatch(html, /data-codex-context-kind/);
});

test('Library headers sort every displayed field and keep missing values last', () => {
  const books = [
    { title: 'Zulu', status: 'finished', publishedYear: 2003, addedAt: '2026-05-01T12:00:00Z', finishedAt: '2026-08-01T12:00:00Z', coverUrl: 'https://example.com/z.jpg' },
    { title: 'Alpha', status: 'to_read', publishedYear: 1969, addedAt: '2026-06-01T12:00:00Z', finishedAt: null, coverUrl: null },
    { title: 'Middle', status: 'reading', publishedYear: null, addedAt: '2026-04-01T12:00:00Z', finishedAt: '2026-07-01T12:00:00Z', coverUrl: 'https://example.com/m.jpg' },
  ];

  assert.deepEqual(sortReadingBooks(books, 'book', 'asc').map((book) => book.title), ['Alpha', 'Middle', 'Zulu']);
  assert.deepEqual(sortReadingBooks(books, 'status', 'asc').map((book) => book.title), ['Alpha', 'Middle', 'Zulu']);
  assert.deepEqual(sortReadingBooks(books, 'edition', 'desc').map((book) => book.title), ['Zulu', 'Alpha', 'Middle']);
  assert.deepEqual(sortReadingBooks(books, 'addedAt', 'desc').map((book) => book.title), ['Alpha', 'Zulu', 'Middle']);
  assert.deepEqual(sortReadingBooks(books, 'finishedAt', 'desc').map((book) => book.title), ['Zulu', 'Middle', 'Alpha']);
  assert.deepEqual(sortReadingBooks(books, 'cover', 'desc').map((book) => book.title), ['Middle', 'Zulu', 'Alpha']);
});

test('Finished Library rows expose an editable date read control and sortable headers', () => {
  const reading = fixture();
  reading.books.push({
    id: 'finished',
    title: 'Already Read',
    authors: ['C'],
    status: 'finished',
    sortOrder: 1,
    tags: [],
    addedAt: '2026-01-02T12:00:00Z',
    finishedAt: '2026-02-03T12:00:00Z',
  });
  reading.summary.total += 1;
  reading.summary.byStatus.finished += 1;
  const ui = createReadingUiState();
  ui.view = 'library';
  ui.sortKey = 'finishedAt';
  ui.sortDirection = 'desc';
  const html = renderReading(reading, ui);

  assert.match(html, /data-reading-sort="book"/);
  assert.match(html, /data-reading-sort="finishedAt"/);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /data-reading-finished-date-book="finished"/);
  assert.match(html, /value="2026-02-03"/);
  assert.doesNotMatch(html, /data-reading-finished-date-book="two"/);
});

test('Reading keeps the toolbar and hero free of redundant helper copy', () => {
  const html = renderReading(fixture(), createReadingUiState());

  assert.doesNotMatch(html, /The reading room/);
  assert.doesNotMatch(html, /To read and dropped stay in the library/);
  assert.doesNotMatch(html, /books across five statuses/);
});

test('temporary catalog results keep remote previews instead of entering the local cache', () => {
  const ui = createReadingUiState();
  ui.catalogOpen = true;
  ui.catalogResults = [{
    title: 'Catalog only',
    authors: ['A'],
    coverUrl: 'https://covers.openlibrary.org/b/id/3-M.jpg?default=false',
    source: { provider: 'open_library' },
  }];
  const html = renderReading(fixture(), ui);

  assert.match(html, /src="https:\/\/covers\.openlibrary\.org\/b\/id\/3-M\.jpg\?default=false"/);
});

test('catalog search presents twenty results at a time with a clear continuation action', () => {
  const ui = createReadingUiState();
  ui.catalogOpen = true;
  ui.catalogQuery = 'history';
  ui.catalogPage = 1;
  ui.catalogTotal = 45;
  ui.catalogHasMore = true;
  ui.catalogResults = Array.from({ length: 20 }, (_, index) => ({
    title: `History ${index + 1}`,
    authors: ['A. Historian'],
    source: { provider: 'open_library', workId: `OL${index + 1}W` },
  }));

  const html = renderReading(fixture(), ui);

  assert.match(html, /Showing 20 of 45 matches/);
  assert.match(html, /data-catalog-load-more/);
  assert.match(html, />Load 20 more</);
  assert.equal((html.match(/class="catalog-result"/g) || []).length, 20);
});

test('catalog search makes exact ISBN handling and loading state visible', () => {
  const ui = createReadingUiState();
  ui.catalogOpen = true;
  ui.catalogQuery = '978-0-262-04995-5';
  ui.catalogQueryType = 'isbn';
  ui.catalogPage = 1;
  ui.catalogTotal = 2;
  ui.catalogHasMore = true;
  ui.loadingMore = true;
  ui.catalogResults = [
    { title: 'What Is Intelligence?', authors: ['Blaise Agüera y Arcas'], source: { provider: 'open_library', workId: 'OL1W' } },
  ];

  const html = renderReading(fixture(), ui);

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /class="catalog-query-type">Exact ISBN</);
  assert.match(html, /data-catalog-load-more type="button" aria-disabled="true">Loading…/);
  assert.match(html, /data-catalog-result-index="0" tabindex="-1"/);
});

test('catalog search explains empty and completed result sets', () => {
  const emptyUi = createReadingUiState();
  emptyUi.catalogOpen = true;
  emptyUi.catalogQuery = '978-0-262-04995-5';
  emptyUi.catalogQueryType = 'isbn';
  assert.match(renderReading(fixture(), emptyUi), /No exact ISBN match found/);

  const completeUi = createReadingUiState();
  completeUi.catalogOpen = true;
  completeUi.catalogQuery = 'specific title';
  completeUi.catalogPage = 1;
  completeUi.catalogTotal = 1;
  completeUi.catalogResults = [{ title: 'Specific Title', authors: [], source: { provider: 'open_library', workId: 'OL1W' } }];
  const completeHtml = renderReading(fixture(), completeUi);
  assert.match(completeHtml, /You have reached the end of these results/);
  assert.doesNotMatch(completeHtml, /data-catalog-load-more/);
});
