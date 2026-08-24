export const READING_STATUS_LABELS = {
  to_read: 'To read',
  next_up: 'Next up',
  reading: 'Reading',
  finished: 'Finished',
  dropped: 'Dropped',
};

const BOARD_STATUSES = ['next_up', 'reading', 'finished'];
const ALL_STATUSES = Object.keys(READING_STATUS_LABELS);

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
    searching: false,
    selectedBookId: null,
    deleteBookId: null,
  };
}

export function renderReading(reading, ui) {
  const books = reading?.books || [];
  const summary = reading?.summary || { total: 0, boardTotal: 0, byStatus: {} };
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
          <div class="smallcaps reading-kicker">The reading room</div>
          <h1>Books in motion.</h1>
          <p>One collection, seen as a working queue or a complete visual library.</p>
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
        <span class="reading-view-note smallcaps">${ui.view === 'kanban' ? 'To read and dropped stay in the library' : `${summary.total || 0} books across five statuses`}</span>
        <button class="reading-add-button" data-reading-catalog-toggle type="button">${ui.catalogOpen ? 'Close search' : '+ Add a book'}</button>
      </div>

      ${ui.catalogOpen ? renderCatalogSearch(ui) : ''}
      ${ui.view === 'library' ? renderLibrary(books, summary, ui, tags) : renderKanban(books)}
      ${selected ? renderBookDetail(selected) : ''}
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

function renderCatalogSearch(ui) {
  return `
    <section class="catalog-panel">
      <div class="catalog-intro">
        <div><span class="smallcaps-strong">Search Open Library</span><p>Search results are temporary. LifeOS saves only the book you choose.</p></div>
        <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library ↗</a>
      </div>
      <form class="catalog-search-form" data-reading-catalog-form>
        <input name="query" value="${escapeAttribute(ui.catalogQuery)}" placeholder="Title, author, or ISBN" autocomplete="off" aria-label="Search books">
        <button type="submit" ${ui.searching ? 'disabled' : ''}>${ui.searching ? 'Searching…' : 'Search books'}</button>
      </form>
      ${ui.catalogError ? `<div class="catalog-error">${escapeHtml(ui.catalogError)}</div>` : ''}
      ${ui.catalogResults.length ? `<div class="catalog-results">${ui.catalogResults.map(renderCatalogResult).join('')}</div>` : ui.catalogQuery && !ui.searching && !ui.catalogError ? '<p class="catalog-empty">No matching books found.</p>' : ''}
    </section>
  `;
}

function renderCatalogResult(book, index) {
  return `
    <article class="catalog-result">
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

function renderKanban(books) {
  return `
    <div class="reading-board">
      ${BOARD_STATUSES.map((status) => {
        const items = books.filter((book) => book.status === status);
        return `
          <section class="reading-column status-${status}" data-reading-drop-status="${status}">
            <header class="reading-column-head">
              <div><span class="column-mark"></span><h2>${READING_STATUS_LABELS[status]}</h2></div>
              <span class="column-count">${items.length}</span>
            </header>
            <div class="reading-column-body">
              ${items.length ? items.map(renderBoardCard).join('') : `<div class="reading-column-empty">Drop a book here</div>`}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function renderBoardCard(book) {
  return `
    <article class="reading-card" draggable="true" data-reading-drag-id="${escapeAttribute(book.id)}">
      <button class="reading-card-cover" data-reading-detail="${escapeAttribute(book.id)}" type="button" aria-label="Open ${escapeAttribute(book.title)} details">
        ${renderCover(book, 'board-cover')}
      </button>
      <div class="reading-card-copy">
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(authorLine(book))}</p>
        <div class="reading-card-meta">${escapeHtml(compactMetadata(book) || statusDateLabel(book))}</div>
        ${renderTags(book, 2)}
      </div>
      <div class="reading-card-controls">
        ${statusSelect(book)}
        <span class="order-buttons">
          <button data-reading-reorder="up" data-book-id="${escapeAttribute(book.id)}" type="button" title="Move earlier">↑</button>
          <button data-reading-reorder="down" data-book-id="${escapeAttribute(book.id)}" type="button" title="Move later">↓</button>
        </span>
      </div>
    </article>
  `;
}

function renderLibrary(books, summary, ui, tags) {
  const statusBooks = ui.filter === 'all' ? books : books.filter((book) => book.status === ui.filter);
  const taggedBooks = ui.tagFilter === 'all'
    ? statusBooks
    : statusBooks.filter((book) => (book.tags || []).some((tag) => tag.toLowerCase() === ui.tagFilter.toLowerCase()));
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
          <span>Cover</span><span>Book</span><span>Status</span><span>Edition</span><span>Added</span>
        </div>
        <div class="reading-db-body">
          ${taggedBooks.length ? taggedBooks.map(renderDatabaseRow).join('') : '<div class="reading-db-empty">No books match this status and tag.</div>'}
          ${taggedBooks.length ? '<div class="reading-db-empty" data-reading-filter-empty hidden>No books match this search.</div>' : ''}
        </div>
      </div>
    </section>
  `;
}

function renderDatabaseRow(book) {
  return `
    <article class="reading-db-row" role="row" data-reading-search-text="${escapeAttribute(readingSearchText(book))}">
      <button class="db-cover-button" data-reading-detail="${escapeAttribute(book.id)}" type="button" aria-label="Open ${escapeAttribute(book.title)} details">${renderCover(book, 'database-cover')}</button>
      <div class="db-book-copy"><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(authorLine(book))}</p>${renderTags(book, 4)}${book.description ? `<span>${escapeHtml(book.description)}</span>` : ''}</div>
      <div class="db-status">${statusSelect(book)}</div>
      <div class="db-edition">${escapeHtml(compactMetadata(book) || '—')}</div>
      <div class="db-added">${escapeHtml(formatDate(book.addedAt))}</div>
    </article>
  `;
}

function renderBookDetail(book) {
  return `
    <div class="book-detail-backdrop" data-reading-detail-close>
      <article class="book-detail" role="dialog" aria-modal="true" aria-labelledby="book-detail-title">
        <button class="book-detail-close" data-reading-detail-close type="button" aria-label="Close book details">×</button>
        <div class="book-detail-visual">${renderCover(book, 'detail-cover')}</div>
        <div class="book-detail-copy">
          <span class="smallcaps">${escapeHtml(READING_STATUS_LABELS[book.status])}</span>
          <h2 id="book-detail-title">${escapeHtml(book.title)}</h2>
          ${book.subtitle ? `<p class="book-detail-subtitle">${escapeHtml(book.subtitle)}</p>` : ''}
          <p class="book-detail-author">${escapeHtml(authorLine(book))}</p>
          <div class="book-detail-status">${statusSelect(book)}</div>
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
  return `<span class="book-cover ${className} ${book.coverUrl ? '' : 'cover-missing'}"><span class="book-cover-fallback">${escapeHtml(initial)}</span>${book.coverUrl ? `<img data-reading-cover src="${escapeAttribute(book.coverUrl)}" alt="Cover of ${escapeAttribute(book.title)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}

function renderTags(book, limit) {
  const tags = (book.tags || []).slice(0, limit);
  if (!tags.length) return '';
  const remaining = Math.max(0, (book.tags || []).length - tags.length);
  return `<div class="book-tag-list compact">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}${remaining ? `<em>+${remaining}</em>` : ''}</div>`;
}

function statusSelect(book) {
  return `<select class="reading-status-select" data-reading-status-book="${escapeAttribute(book.id)}" aria-label="Status for ${escapeAttribute(book.title)}">${statusOptions(book.status, ALL_STATUSES)}</select>`;
}

function statusOptions(selected, statuses) {
  return statuses.map((status) => `<option value="${status}" ${status === selected ? 'selected' : ''}>${READING_STATUS_LABELS[status]}</option>`).join('');
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
