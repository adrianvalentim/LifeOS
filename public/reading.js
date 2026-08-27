import { renderCodexContextButton } from './codex-context.js';

export const READING_STATUS_LABELS = {
  to_read: 'To read',
  next_up: 'Next up',
  reading: 'Reading',
  finished: 'Finished',
  dropped: 'Dropped',
};

export const READING_BOARD_STATUSES = ['next_up', 'reading', 'finished'];
const ALL_STATUSES = Object.keys(READING_STATUS_LABELS);
const READING_SORT_KEYS = ['cover', 'book', 'status', 'edition', 'addedAt', 'finishedAt'];

export function createReadingUiState() {
  return {
    view: 'kanban',
    filter: 'all',
    localQuery: '',
    tagFilter: 'all',
    catalogOpen: false,
    catalogQuery: '',
    catalogResults: [],
    catalogError: null,
    catalogLoadError: null,
    catalogPage: 0,
    catalogPageSize: 20,
    catalogTotal: 0,
    catalogHasMore: false,
    catalogQueryType: 'text',
    searching: false,
    loadingMore: false,
    selectedBookId: null,
    deleteBookId: null,
    movingBookId: null,
    updatingDateBookId: null,
    sortKey: null,
    sortDirection: 'asc',
  };
}

export function sortReadingBooks(books, key, direction = 'asc') {
  if (!READING_SORT_KEYS.includes(key)) return books;
  const multiplier = direction === 'desc' ? -1 : 1;
  return books
    .map((book, index) => ({ book, index }))
    .sort((left, right) => {
      const comparison = compareReadingSortValues(left.book, right.book, key, multiplier);
      return comparison || left.index - right.index;
    })
    .map(({ book }) => book);
}

export function readingFinishedInYear(book, year, timeZone = 'UTC') {
  return book?.status === 'finished'
    && formatDateInput(book.finishedAt, timeZone).slice(0, 4) === String(year);
}

export function readingWithBookStatus(reading, bookId, status) {
  const current = reading?.books?.find((book) => book.id === bookId);
  if (!current || current.status === status || !ALL_STATUSES.includes(status)) return reading;

  return readingWithBookPosition(reading, bookId, status, null);
}

export function readingWithBookPosition(reading, bookId, status, beforeBookId = null) {
  const current = reading?.books?.find((book) => book.id === bookId);
  if (!current || !ALL_STATUSES.includes(status)) return reading;

  const targetBooks = reading.books
    .filter((book) => book.status === status && book.id !== bookId)
    .sort(compareReadingBooks);
  const targetIndex = beforeBookId === null
    ? targetBooks.length
    : targetBooks.findIndex((book) => book.id === beforeBookId);
  if (targetIndex < 0) return reading;

  targetBooks.splice(targetIndex, 0, { ...current, status });
  const targetOrder = new Map(targetBooks.map((book, index) => [book.id, index + 1]));
  const currentOrder = reading.books
    .filter((book) => book.status === status)
    .sort(compareReadingBooks)
    .map((book) => book.id);
  const nextOrder = targetBooks.map((book) => book.id);
  if (current.status === status && currentOrder.every((id, index) => id === nextOrder[index])) return reading;

  const books = reading.books.map((book) => {
    if (book.id === bookId) return { ...book, status, sortOrder: targetOrder.get(book.id) };
    if (book.status === status) return { ...book, sortOrder: targetOrder.get(book.id) };
    return book;
  });
  const byStatus = {
    ...(reading.summary?.byStatus || {}),
  };
  if (current.status !== status) {
    byStatus[current.status] = Math.max(0, Number(reading.summary?.byStatus?.[current.status]) - 1 || 0);
    byStatus[status] = Number(reading.summary?.byStatus?.[status] || 0) + 1;
  }

  return {
    ...reading,
    books,
    summary: {
      ...reading.summary,
      byStatus,
      boardTotal: READING_BOARD_STATUSES.reduce((total, boardStatus) => total + Number(byStatus[boardStatus] || 0), 0),
    },
  };
}

export function renderReading(reading, ui, calendar = {}) {
  const books = reading?.books || [];
  const summary = reading?.summary || { total: 0, boardTotal: 0, byStatus: {} };
  const currentYear = String(calendar.today || new Date().toISOString()).slice(0, 4);
  const timeZone = calendar.timeZone || 'UTC';
  const selected = books.find((book) => book.id === ui.selectedBookId);
  const deleteTarget = books.find((book) => book.id === ui.deleteBookId);
  const tagMap = new Map();
  for (const tag of books.flatMap((book) => book.tags || [])) {
    if (!tagMap.has(tag.toLowerCase())) tagMap.set(tag.toLowerCase(), tag);
  }
  const tags = [...tagMap.values()].sort((a, b) => a.localeCompare(b));
  return `
    <div class="reading-workspace">
      <header class="reading-hero">
        <div>
          <h1>Readings</h1>
          <p>Let us read and let us dance.</p>
        </div>
        <div class="reading-totals" aria-label="Reading summary">
          ${summaryBlock(summary.byStatus.reading || 0, 'Reading')}
          ${summaryBlock(summary.byStatus.next_up || 0, 'Next up')}
          ${summaryBlock(summary.byStatus.finished || 0, 'Finished')}
          ${summaryBlock(summary.total || 0, 'Total')}
        </div>
      </header>

      <div class="reading-toolbar">
        <div class="reading-view-switch" role="group" aria-label="Reading view">
          <button class="reading-view-button ${ui.view === 'kanban' ? 'active' : ''}" data-reading-view="kanban" type="button">Kanban</button>
          <button class="reading-view-button ${ui.view === 'library' ? 'active' : ''}" data-reading-view="library" type="button">Library</button>
        </div>
        <button class="reading-add-button" data-reading-catalog-toggle type="button">${ui.catalogOpen ? 'Close search' : '+ Add a book'}</button>
      </div>

      ${ui.catalogOpen ? renderCatalogSearch(ui) : ''}
      ${ui.view === 'library' ? renderLibrary(books, summary, ui, tags, timeZone) : renderKanban(books, ui, currentYear, timeZone)}
      ${selected ? renderBookDetail(selected, ui, timeZone) : ''}
      ${deleteTarget ? renderDeleteConfirmation(deleteTarget) : ''}
    </div>
  `;
}

export function readingSearchText(book) {
  return [book.title, book.subtitle, ...(book.authors || []), book.publisher, book.isbn10, book.isbn13, ...(book.tags || []), ...(book.subjects || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function readingCoverUrl(book) {
  if (book?.id && book.source?.provider === 'open_library' && book.coverUrl) {
    return `/api/reading/books/${encodeURIComponent(book.id)}/cover`;
  }
  return book?.coverUrl || null;
}

function renderCatalogSearch(ui) {
  const busy = ui.searching || ui.loadingMore;
  return `
    <section class="catalog-panel" ${busy ? 'aria-busy="true"' : ''}>
      <div class="catalog-intro">
        <div><span class="smallcaps-strong">Search Open Library</span><p id="catalog-search-hint">Search by title or author. Paste an ISBN for an exact lookup; LifeOS saves only what you add.</p></div>
        <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library ↗</a>
      </div>
      <form class="catalog-search-form" data-reading-catalog-form>
        <input type="search" name="query" value="${escapeAttribute(ui.catalogQuery)}" placeholder="Title, author, or ISBN" autocomplete="off" enterkeyhint="search" aria-label="Search books" aria-describedby="catalog-search-hint">
        <button type="submit" ${busy ? 'disabled' : ''}>${ui.searching ? 'Searching…' : 'Search books'}</button>
      </form>
      ${ui.catalogError ? `<div class="catalog-error">${escapeHtml(ui.catalogError)}</div>` : ''}
      ${ui.searching ? '<p class="catalog-searching" role="status">Searching Open Library…</p>' : renderCatalogResults(ui)}
    </section>
  `;
}

function renderCatalogResults(ui) {
  if (!ui.catalogResults.length) {
    if (!ui.catalogQuery || ui.catalogError) return '';
    return `<p class="catalog-empty">${ui.catalogQueryType === 'isbn' ? 'No exact ISBN match found.' : 'No matching books found. Try an ISBN or a more specific title and author.'}</p>`;
  }
  const shown = ui.catalogResults.length;
  const total = Math.max(shown, Number(ui.catalogTotal) || 0);
  const summary = total > shown
    ? `Showing ${shown} of ${total} matches`
    : `${shown} ${shown === 1 ? 'result' : 'results'}`;
  const remaining = Math.max(0, total - shown);
  const nextCount = remaining ? Math.min(Number(ui.catalogPageSize) || 20, remaining) : Number(ui.catalogPageSize) || 20;
  return `
    <div class="catalog-results-head">
      <p class="catalog-results-summary" role="status" aria-live="polite" tabindex="-1" data-catalog-results-summary>${escapeHtml(summary)}</p>
      ${ui.catalogQueryType === 'isbn' ? '<span class="catalog-query-type">Exact ISBN</span>' : ''}
    </div>
    <div class="catalog-results">${ui.catalogResults.map(renderCatalogResult).join('')}</div>
    <div class="catalog-results-footer">
      <p>${ui.catalogHasMore ? 'Not there yet? Continue through Open Library without losing these results.' : 'You have reached the end of these results.'}</p>
      ${ui.catalogHasMore ? `<button data-catalog-load-more type="button" aria-disabled="${ui.loadingMore ? 'true' : 'false'}">${ui.loadingMore ? 'Loading…' : `Load ${nextCount} more`}</button>` : ''}
    </div>
    ${ui.catalogLoadError ? `<div class="catalog-load-error" role="alert">${escapeHtml(ui.catalogLoadError)}</div>` : ''}
  `;
}

function renderCatalogResult(book, index) {
  return `
    <article class="catalog-result" data-catalog-result-index="${index}" tabindex="-1">
      ${renderCover(book, 'catalog-cover')}
      <div class="catalog-result-copy">
        <h3>${escapeHtml(book.title)}</h3>
        <p class="book-byline">${escapeHtml(authorLine(book))}</p>
        <p class="catalog-meta">${escapeHtml(compactMetadata(book) || 'Edition details unavailable')}</p>
        ${book.subjects?.length ? `<p class="catalog-subjects">${escapeHtml(book.subjects.slice(0, 3).join(' · '))}</p>` : ''}
      </div>
      <div class="catalog-add-controls">
        <select data-catalog-status-index="${index}" aria-label="Add ${escapeAttribute(book.title)} as">
          ${statusOptions('to_read', ['to_read', 'next_up', 'reading', 'finished'])}
        </select>
        <button data-catalog-add-index="${index}" type="button">Add</button>
      </div>
    </article>
  `;
}

function renderKanban(books, ui, currentYear, timeZone) {
  return `
    <div class="reading-board ${ui.movingBookId ? 'is-saving' : ''}" aria-describedby="reading-board-instructions" ${ui.movingBookId ? 'aria-busy="true"' : ''}>
      <p class="reading-board-instructions" id="reading-board-instructions">Drag books to position them. Keyboard users can focus a card and press Control plus an arrow key.</p>
      ${READING_BOARD_STATUSES.map((status) => {
        const items = books
          .filter((book) => book.status === status && (
            status !== 'finished'
            || ui.movingBookId === book.id
            || readingFinishedInYear(book, currentYear, timeZone)
          ))
          .sort(compareReadingBooks);
        return `
          <section class="reading-column status-${status}" data-reading-drop-status="${status}" data-reading-drop-label="${READING_STATUS_LABELS[status]}">
            <header class="reading-column-head">
              <div><span class="column-mark"></span><h2>${READING_STATUS_LABELS[status]}</h2>${status === 'finished' ? `<span class="reading-column-period">${escapeHtml(currentYear)}</span>` : ''}</div>
              <span class="column-count">${items.length}</span>
            </header>
            <div class="reading-column-body">
              ${items.length ? items.map((book) => renderBoardCard(book, ui)).join('') : `<div class="reading-column-empty">${status === 'finished' ? `No books finished in ${escapeHtml(currentYear)}` : 'Drop a book here'}</div>`}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function renderBoardCard(book, ui) {
  const moving = ui.movingBookId === book.id;
  return `
    <article class="reading-card ${moving ? 'is-saving' : ''}" data-reading-drag-id="${escapeAttribute(book.id)}" data-reading-drag-status="${book.status}" data-reading-sort-order="${Number(book.sortOrder) || 0}" tabindex="0" aria-roledescription="sortable book" aria-label="${escapeAttribute(book.title)}. ${escapeAttribute(READING_STATUS_LABELS[book.status])}." ${moving ? 'aria-busy="true"' : ''}>
      <span class="reading-drag-grip" aria-hidden="true">⠿</span>
      <button class="reading-card-cover" data-reading-detail="${escapeAttribute(book.id)}" type="button" aria-label="Open ${escapeAttribute(book.title)} details">
        ${renderCover(book, 'board-cover')}
      </button>
      <div class="reading-card-copy">
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(authorLine(book))}</p>
        <div class="reading-card-meta">${escapeHtml(compactMetadata(book) || statusDateLabel(book))}</div>
        ${renderTags(book, 2)}
      </div>
    </article>
  `;
}

function renderLibrary(books, summary, ui, tags, timeZone) {
  const statusBooks = ui.filter === 'all' ? books : books.filter((book) => book.status === ui.filter);
  const taggedBooks = ui.tagFilter === 'all'
    ? statusBooks
    : statusBooks.filter((book) => (book.tags || []).some((tag) => tag.toLowerCase() === ui.tagFilter.toLowerCase()));
  const sortedBooks = sortReadingBooks(taggedBooks, ui.sortKey, ui.sortDirection);
  return `
    <section class="reading-library">
      <div class="library-controls">
        <div class="library-filters" role="group" aria-label="Filter reading library">
          ${filterButton('all', 'All', summary.total || 0, ui.filter)}
          ${ALL_STATUSES.map((status) => filterButton(status, READING_STATUS_LABELS[status], summary.byStatus[status] || 0, ui.filter)).join('')}
        </div>
        <div class="library-query-controls">
          <label class="library-tag-filter"><span>Tag</span><select data-reading-tag-filter aria-label="Filter by tag"><option value="all">All tags</option>${tags.map((tag) => `<option value="${escapeAttribute(tag)}" ${tag === ui.tagFilter ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('')}</select></label>
          <label class="library-search"><span>⌕</span><input data-reading-local-search value="${escapeAttribute(ui.localQuery)}" placeholder="Filter this library" aria-label="Filter this library"></label>
        </div>
      </div>
      <div class="reading-database" role="table" aria-label="All books">
        <div class="reading-db-head" role="row">
          ${sortableHeader('cover', 'Cover', ui, 'cover availability')}
          ${sortableHeader('book', 'Book', ui, 'book title')}
          ${sortableHeader('status', 'Status', ui)}
          ${sortableHeader('edition', 'Edition', ui, 'publication year')}
          ${sortableHeader('addedAt', 'Added', ui, 'date added')}
          ${sortableHeader('finishedAt', 'Date read', ui)}
        </div>
        <div class="reading-db-body">
          ${sortedBooks.length ? sortedBooks.map((book) => renderDatabaseRow(book, ui, timeZone)).join('') : '<div class="reading-db-empty">No books match this status and tag.</div>'}
          ${sortedBooks.length ? '<div class="reading-db-empty" data-reading-filter-empty hidden>No books match this search.</div>' : ''}
        </div>
      </div>
    </section>
  `;
}

function renderDatabaseRow(book, ui, timeZone) {
  return `
    <article class="reading-db-row" role="row" data-reading-search-text="${escapeAttribute(readingSearchText(book))}">
      <button class="db-cover-button" data-reading-detail="${escapeAttribute(book.id)}" type="button" aria-label="Open ${escapeAttribute(book.title)} details">${renderCover(book, 'database-cover')}</button>
      <div class="db-book-copy"><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(authorLine(book))}</p>${renderTags(book, 4)}${book.description ? `<span>${escapeHtml(book.description)}</span>` : ''}</div>
      <div class="db-status">${statusSelect(book)}</div>
      <div class="db-edition">${escapeHtml(compactMetadata(book) || '—')}</div>
      <div class="db-added">${escapeHtml(formatDate(book.addedAt))}</div>
      <div class="db-finished">${finishedDateControl(book, ui.updatingDateBookId === book.id, timeZone)}</div>
    </article>
  `;
}

function renderBookDetail(book, ui, timeZone) {
  return `
    <div class="book-detail-backdrop" data-reading-detail-close>
      <article class="book-detail" role="dialog" aria-modal="true" aria-labelledby="book-detail-title">
        ${renderCodexContextButton('book', book.id, book.title)}
        <button class="book-detail-close" data-reading-detail-close type="button" aria-label="Close book details">×</button>
        <div class="book-detail-visual">${renderCover(book, 'detail-cover')}</div>
        <div class="book-detail-copy">
          <span class="smallcaps">${escapeHtml(READING_STATUS_LABELS[book.status])}</span>
          <h2 id="book-detail-title">${escapeHtml(book.title)}</h2>
          ${book.subtitle ? `<p class="book-detail-subtitle">${escapeHtml(book.subtitle)}</p>` : ''}
          <p class="book-detail-author">${escapeHtml(authorLine(book))}</p>
          <div class="book-detail-reading-state">
            <div class="book-detail-status">${statusSelect(book)}</div>
            ${book.status === 'finished' ? `<label class="book-detail-finished-date"><span>Date read</span>${finishedDateControl(book, ui.updatingDateBookId === book.id, timeZone)}</label>` : ''}
          </div>
          <div class="book-detail-metadata">${detailMetadata(book).map(([label, value]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`).join('')}</div>
          <div class="book-about"><span class="smallcaps-strong">About the book</span><p>${escapeHtml(book.description || 'No description was available from the catalog. The imported metadata remains editable in the local record.')}</p></div>
          <section class="book-tag-editor">
            <span class="smallcaps-strong">Tags</span>
            <div class="book-tag-list editable">${book.tags?.length ? book.tags.map((tag) => `<span>${escapeHtml(tag)}<button data-reading-tag-remove="${escapeAttribute(tag)}" data-book-id="${escapeAttribute(book.id)}" type="button" aria-label="Remove tag ${escapeAttribute(tag)}">×</button></span>`).join('') : '<em>No tags yet.</em>'}</div>
            <form class="book-tag-form" data-reading-tag-form="${escapeAttribute(book.id)}"><input name="tag" maxlength="40" placeholder="Add a tag" aria-label="New tag" required><button type="submit">Add tag</button></form>
          </section>
          ${book.subjects?.length ? `<div class="book-subject-list">${book.subjects.map((subject) => `<span>${escapeHtml(subject)}</span>`).join('')}</div>` : ''}
          ${book.source?.url ? `<a class="book-source-link" href="${escapeAttribute(book.source.url)}" target="_blank" rel="noreferrer">View source on Open Library ↗</a>` : ''}
          <section class="book-danger-zone"><span class="smallcaps">Permanent action</span><button data-reading-delete-request="${escapeAttribute(book.id)}" type="button">Delete from library</button></section>
        </div>
      </article>
    </div>
  `;
}

function renderDeleteConfirmation(book) {
  return `
    <div class="book-delete-backdrop">
      <section class="book-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-book-title">
        <span class="smallcaps">Permanent deletion</span>
        <h2 id="delete-book-title">Delete “${escapeHtml(book.title)}”?</h2>
        <p>This removes the book, its tags, status, and reading dates from the LifeOS library. It cannot be undone inside the app.</p>
        <div class="book-delete-actions"><button data-reading-delete-cancel type="button">Cancel</button><button class="danger" data-reading-delete-confirm="${escapeAttribute(book.id)}" type="button">Delete permanently</button></div>
      </section>
    </div>
  `;
}

function renderCover(book, className) {
  const initial = String(book.title || '?').trim().slice(0, 1).toUpperCase();
  const coverUrl = readingCoverUrl(book);
  return `<span class="book-cover ${className} ${coverUrl ? '' : 'cover-missing'}"><span class="book-cover-fallback">${escapeHtml(initial)}</span>${coverUrl ? `<img data-reading-cover src="${escapeAttribute(coverUrl)}" alt="Cover of ${escapeAttribute(book.title)}" loading="lazy" referrerpolicy="no-referrer" draggable="false">` : ''}</span>`;
}

function renderTags(book, limit) {
  const tags = (book.tags || []).slice(0, limit);
  if (!tags.length) return '';
  const remaining = Math.max(0, (book.tags || []).length - tags.length);
  return `<div class="book-tag-list compact">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}${remaining ? `<em>+${remaining}</em>` : ''}</div>`;
}

function statusSelect(book, disabled = false) {
  return `<select class="reading-status-select" data-reading-status-book="${escapeAttribute(book.id)}" aria-label="Status for ${escapeAttribute(book.title)}" ${disabled ? 'disabled' : ''}>${statusOptions(book.status, ALL_STATUSES)}</select>`;
}

function finishedDateControl(book, disabled = false, timeZone = 'UTC') {
  if (book.status !== 'finished') return '<span aria-label="Not finished">—</span>';
  return `<input type="date" value="${escapeAttribute(formatDateInput(book.finishedAt, timeZone))}" data-reading-finished-date-book="${escapeAttribute(book.id)}" aria-label="Date read for ${escapeAttribute(book.title)}" ${disabled ? 'disabled' : ''}>`;
}

function compareReadingBooks(a, b) {
  const orderDelta = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  return orderDelta || String(a.title || '').localeCompare(String(b.title || ''));
}

function statusOptions(selected, statuses) {
  return statuses.map((status) => `<option value="${status}" ${status === selected ? 'selected' : ''}>${READING_STATUS_LABELS[status]}</option>`).join('');
}

function sortableHeader(key, label, ui, sortLabel = label.toLowerCase()) {
  const active = ui.sortKey === key;
  const direction = active && ui.sortDirection === 'desc' ? 'descending' : 'ascending';
  const indicator = active ? (ui.sortDirection === 'desc' ? '↓' : '↑') : '↕';
  return `<span role="columnheader" aria-sort="${active ? direction : 'none'}"><button class="reading-sort-button ${active ? 'active' : ''}" data-reading-sort="${key}" type="button" aria-label="Sort by ${escapeAttribute(sortLabel)}${active ? `, currently ${direction}` : ''}">${escapeHtml(label)}<i aria-hidden="true">${indicator}</i></button></span>`;
}

function compareReadingSortValues(a, b, key, multiplier) {
  const [aValue, bValue] = readingSortValues(a, b, key);
  const aMissing = aValue === null || aValue === undefined || aValue === '';
  const bMissing = bValue === null || bValue === undefined || bValue === '';
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return compareText(a.title, b.title);
    return aMissing ? 1 : -1;
  }
  const comparison = typeof aValue === 'number'
    ? aValue - bValue
    : compareText(aValue, bValue);
  return comparison * multiplier || compareText(a.title, b.title);
}

function readingSortValues(a, b, key) {
  if (key === 'cover') return [a.coverUrl ? 1 : 0, b.coverUrl ? 1 : 0];
  if (key === 'book') return [a.title, b.title];
  if (key === 'status') return [ALL_STATUSES.indexOf(a.status), ALL_STATUSES.indexOf(b.status)];
  if (key === 'edition') return [a.publishedYear, b.publishedYear];
  if (key === 'addedAt') return [dateSortValue(a.addedAt), dateSortValue(b.addedAt)];
  return [dateSortValue(a.finishedAt), dateSortValue(b.finishedAt)];
}

function dateSortValue(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'en', { sensitivity: 'base', numeric: true });
}

function filterButton(id, label, count, selected) {
  return `<button class="library-filter ${id === selected ? 'active' : ''}" data-reading-filter="${id}" type="button"><span>${escapeHtml(label)}</span><b>${count}</b></button>`;
}

function summaryBlock(value, label) {
  return `<div><b>${value}</b><span>${escapeHtml(label)}</span></div>`;
}

function authorLine(book) {
  return book.authors?.length ? book.authors.join(', ') : 'Unknown author';
}

function compactMetadata(book) {
  return [book.publishedYear, book.language?.toUpperCase(), book.pageCount ? `${book.pageCount} pages` : null].filter(Boolean).join(' · ');
}

function detailMetadata(book) {
  return [
    ['Published', book.publishedYear || '—'],
    ['Language', book.language?.toUpperCase() || '—'],
    ['Pages', book.pageCount || '—'],
    ['Publisher', book.publisher || '—'],
    ['ISBN', book.isbn13 || book.isbn10 || '—'],
    ['Added', formatDate(book.addedAt)],
  ];
}

function statusDateLabel(book) {
  return book.status === 'finished' && book.finishedAt ? `Finished ${formatDate(book.finishedAt)}` : `Added ${formatDate(book.addedAt)}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatDateInput(value, timeZone = 'UTC') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
