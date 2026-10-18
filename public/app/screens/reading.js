import * as act from '../actions.js';
import { agentName, attachContext } from '../agent-context.js';
import { postJson, run } from '../api.js';
import { cx, escapeHtml, html } from '../dom.js';
import { formatDate, normalize, plural, READING_STATUS, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { bookMenu } from '../menus.js';
import { navigate } from '../router.js';
import { lookup, render, setPref, store } from '../store.js';
import { beginDrag } from '../ui/dnd.js';
import { formDialog } from '../ui/dialog.js';
import { pickDate, pickFromList, pickTags } from '../ui/pickers.js';
import { toast } from '../ui/toast.js';

const BOARD = ['next_up', 'reading', 'finished'];

export function coverUrl(book) {
  if (book?.id && book.source?.provider === 'open_library' && book.coverUrl) return `/api/reading/books/${encodeURIComponent(book.id)}/cover`;
  return book?.coverUrl || null;
}

export function renderCover(book, className = '') {
  const url = coverUrl(book);
  return html`<span class="${cx('book-cover', className, !url && 'is-missing')}" style="--hue:${hue(book.title)}"><span class="cover-fallback"><b>${book.title}</b><small>${book.authors?.[0] || ''}</small></span>${url ? html`<img data-cover src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false">` : ''}</span>`;
}

function hue(text) {
  let value = 0;
  for (const char of String(text)) value = (value * 31 + char.charCodeAt(0)) % 360;
  return value;
}

function localDate(iso, timeZone) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function finishedInYear(book, year, timeZone) {
  return book.status === 'finished' && localDate(book.finishedAt, timeZone).slice(0, 4) === String(year);
}

export function render_() {
  const state = store.state;
  const view = store.ui.route.params.get('view') === 'library' ? 'library' : store.ui.route.params.get('view') === 'board' ? 'board' : store.prefs.reading.view;
  const books = state.reading.books;
  const year = state.meta.today.slice(0, 4);
  const finishedThisYear = books.filter((book) => finishedInYear(book, year, state.meta.timezone)).length;
  return html`<div class="screen reading-screen scroll-y">
    <header class="page-head wide">
      <div class="page-title"><div><h1 class="display-sm">Reading</h1><p>${state.reading.summary.byStatus.reading} reading now · ${finishedThisYear} finished in ${year} · ${plural(books.length, 'book')} in the library</p></div></div>
      <div class="page-tools">
        ${view === 'library' ? html`<label class="filter-field">${icon('search', { size: 14 })}<input type="search" placeholder="Filter library" value="${store.ui.filter}" data-page-filter aria-label="Filter library"><kbd>/</kbd></label>` : ''}
        <div class="segmented" role="group" aria-label="Layout">
          <button type="button" class="${view === 'board' ? 'is-active' : ''}" data-action="reading-view" data-view="board">Shelf</button>
          <button type="button" class="${view === 'library' ? 'is-active' : ''}" data-action="reading-view" data-view="library">Library</button>
        </div>
        <button type="button" class="button is-primary small" data-action="reading-add">${icon('plus', { size: 14 })}Add book</button>
      </div>
    </header>
    ${view === 'library' ? renderLibrary() : renderBoard(year)}
  </div>`;
}

function renderBoard(year) {
  const state = store.state;
  return html`<div class="book-board">${BOARD.map((status) => {
    const books = state.reading.books.filter((book) => book.status === status && (status !== 'finished' || finishedInYear(book, year, state.meta.timezone)));
    return html`<section class="board-column book-column status-${status}" data-key="bc-${status}" data-book-drop="${status}">
      <header class="board-head"><span>${status === 'finished' ? `Finished in ${year}` : READING_STATUS[status]}</span><b>${books.length}</b></header>
      <div class="board-cards">${books.map((book) => html`<article class="book-card" data-key="book-${book.id}" data-book="${book.id}" data-draggable="book" tabindex="0">
        <button type="button" class="book-card-cover" data-action="book-open">${renderCover(book, 'small')}</button>
        <div class="book-card-body">
          <button type="button" class="book-title" data-action="book-open">${book.title}</button>
          <span class="book-author">${book.authors.join(', ')}</span>
          <span class="book-meta">${status === 'finished' && book.finishedAt ? `Read ${formatDate(localDate(book.finishedAt, state.meta.timezone), { today: state.meta.today })}` : book.pageCount ? `${book.pageCount} pages` : ''}${status === 'reading' && book.startedAt ? `Started ${timeAgo(book.startedAt)}` : ''}</span>
          ${book.tags.length ? html`<span class="book-tags">${book.tags.slice(0, 3).map((tag) => html`<span class="tag-chip small">${tag}</span>`)}</span>` : ''}
        </div>
        <button type="button" class="row-more" data-action="book-menu" aria-label="Actions">${icon('more', { size: 14 })}</button>
      </article>`)}${books.length ? '' : html`<p class="board-empty">${status === 'next_up' ? 'Queue your next book here' : 'Drag a book here'}</p>`}</div>
    </section>`;
  })}</div>
  <p class="list-foot">The shelf shows what’s next, what you’re reading and this year’s finished books. The Library has everything, including To read and Dropped.</p>`;
}

const COLUMNS = [['title', 'Book'], ['status', 'Status'], ['tags', 'Tags'], ['pages', 'Pages'], ['addedAt', 'Added'], ['finishedAt', 'Read']];

function renderLibrary() {
  const state = store.state;
  const prefs = store.prefs.reading;
  const needle = normalize(store.ui.filter);
  const tags = [...new Set(state.reading.books.flatMap((book) => book.tags))].sort();
  const sort = prefs.sort || { key: 'status', dir: 'asc' };
  const order = { to_read: 0, next_up: 1, reading: 2, finished: 3, dropped: 4 };
  const value = (book) => ({ title: normalize(book.title), status: order[book.status] * 1e6 + book.sortOrder, tags: book.tags.join(','), pages: book.pageCount ?? null, addedAt: book.addedAt || null, finishedAt: book.finishedAt || null }[sort.key]);
  const books = state.reading.books
    .filter((book) => (prefs.status === 'all' || book.status === prefs.status) && (prefs.tag === 'all' || book.tags.includes(prefs.tag)))
    .filter((book) => !needle || normalize(`${book.title} ${book.authors.join(' ')} ${book.tags.join(' ')}`).includes(needle))
    .sort((a, b) => {
      const x = value(a); const y = value(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * (sort.dir === 'desc' ? -1 : 1);
    });
  return html`<div class="chip-row">
      <button type="button" class="${cx('filter-chip', prefs.status === 'all' && 'is-active')}" data-action="reading-status" data-status="all">All <b>${state.reading.books.length}</b></button>
      ${Object.entries(READING_STATUS).map(([status, label]) => html`<button type="button" class="${cx('filter-chip', prefs.status === status && 'is-active')}" data-action="reading-status" data-status="${status}">${label} <b>${state.reading.summary.byStatus[status]}</b></button>`)}
      ${tags.length ? html`<span class="grow"></span><select class="select-small" data-reading-tag aria-label="Tag"><option value="all">All tags</option>${tags.map((tag) => html`<option value="${tag}" ${prefs.tag === tag ? 'selected' : ''}>${tag}</option>`)}</select>` : ''}
    </div>
    <div class="card table-card"><table class="data-table library-table">
      <thead><tr><th class="cover-col"></th>${COLUMNS.map(([key, label]) => html`<th><button type="button" class="sort-head ${sort.key === key ? 'is-sorted' : ''}" data-action="reading-sort" data-key="${key}">${label}${sort.key === key ? icon(sort.dir === 'asc' ? 'chevron-up' : 'chevron-down', { size: 12 }) : ''}</button></th>`)}<th></th></tr></thead>
      <tbody>${books.map((book) => html`<tr data-key="lb-${book.id}" data-book="${book.id}">
        <td class="cover-col"><button type="button" data-action="book-open">${renderCover(book, 'tiny')}</button></td>
        <td><button type="button" class="table-title" data-action="book-open">${book.title}</button><small class="table-sub">${book.authors.join(', ')}</small></td>
        <td><button type="button" class="status-pill small status-${book.status}" data-action="book-status">${READING_STATUS[book.status]}</button></td>
        <td>${book.tags.map((tag) => html`<span class="tag-chip small">${tag}</span>`)}</td>
        <td class="num">${book.pageCount ?? html`<span class="muted">—</span>`}</td>
        <td class="muted">${book.addedAt ? formatDate(book.addedAt.slice(0, 10), { today: state.meta.today }) : '—'}</td>
        <td>${book.status === 'finished' ? html`<button type="button" class="prop-value small" data-action="book-finished-date">${book.finishedAt ? formatDate(localDate(book.finishedAt, state.meta.timezone), { today: state.meta.today, year: true }) : 'Set date'}</button>` : html`<span class="muted">—</span>`}</td>
        <td><button type="button" class="row-more" data-action="book-menu" aria-label="Actions">${icon('more', { size: 14 })}</button></td>
      </tr>`)}</tbody>
    </table>${books.length ? '' : html`<p class="card-empty">No books match.</p>`}</div>`;
}

// ——— Book sheet ——————————————————————————————————————————————————————————
export function renderBookSheet(id) {
  const state = store.state;
  const book = lookup.book(id);
  if (!book) return html`<div class="sheet-empty">This book is no longer in your library.</div>`;
  const meta = [
    ['Publisher', book.publisher], ['Published', book.publishedYear], ['Pages', book.pageCount], ['Language', book.language],
    ['ISBN-13', book.isbn13], ['ISBN-10', book.isbn10],
  ].filter(([, value]) => value);
  return html`<div class="sheet-inner book-sheet">
    <header class="sheet-bar"><div class="sheet-crumbs"><span class="crumb">${icon('reading', { size: 13 })}${READING_STATUS[book.status]}</span></div>
      <div class="sheet-tools"><button type="button" class="icon-button" data-action="book-sheet-menu" aria-label="More">${icon('more', { size: 16 })}</button><button type="button" class="icon-button" data-action="sheet-close" aria-label="Close">${icon('x', { size: 16 })}</button></div></header>
    <div class="sheet-scroll scroll-y">
      <div class="book-hero">${renderCover(book, 'large')}
        <div>
          <h2 class="book-sheet-title">${book.title}</h2>
          ${book.subtitle ? html`<p class="book-sheet-sub">${book.subtitle}</p>` : ''}
          <p class="book-sheet-authors">${book.authors.join(', ') || 'Unknown author'}</p>
          <div class="book-sheet-actions">
            <button type="button" class="status-pill status-${book.status}" data-action="book-sheet-status">${READING_STATUS[book.status]}${icon('chevron-down', { size: 12 })}</button>
            ${book.status === 'finished' ? html`<button type="button" class="prop-chip" data-action="book-sheet-finished">${icon('calendar', { size: 13 })}${book.finishedAt ? `Read ${formatDate(localDate(book.finishedAt, state.meta.timezone), { today: state.meta.today, year: true })}` : 'Set date read'}</button>` : ''}
          </div>
        </div>
      </div>
      <dl class="props">
        <div class="prop"><dt>${icon('hash', { size: 14 })}Tags</dt><dd class="prop-tags">${book.tags.map((tag) => html`<span class="tag-chip">${tag}</span>`)}<button type="button" class="prop-value is-empty" data-action="book-sheet-tags">${book.tags.length ? 'Edit' : 'Add tags'}</button></dd></div>
        ${book.startedAt ? html`<div class="prop"><dt>${icon('play', { size: 14 })}Started</dt><dd><span class="prop-static">${formatDate(localDate(book.startedAt, state.meta.timezone), { today: state.meta.today, year: true })}</span></dd></div>` : ''}
        <div class="prop"><dt>${icon('plus', { size: 14 })}Added</dt><dd><span class="prop-static">${book.addedAt ? timeAgo(book.addedAt) : '—'}</span></dd></div>
      </dl>
      ${book.description ? html`<section class="sheet-section"><h4>About</h4><p class="book-description">${book.description}</p></section>` : ''}
      ${meta.length ? html`<section class="sheet-section"><h4>Edition</h4><dl class="meta-grid">${meta.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl></section>` : ''}
      ${book.source?.url ? html`<p class="sheet-meta"><a class="link" href="${book.source.url}" target="_blank" rel="noopener noreferrer">${icon('external', { size: 12 })}View on Open Library</a></p>` : ''}
    </div>
    <footer class="sheet-actions">
      <button type="button" class="button ghost" data-action="book-sheet-edit">${icon('pen', { size: 14 })}Edit details</button>
      <button type="button" class="button ghost" data-action="book-sheet-codex">${icon('sparkle', { size: 14 })}Ask ${agentName()}</button>
      <span class="grow"></span>
      <button type="button" class="icon-button" data-action="book-sheet-delete" aria-label="Remove from library">${icon('trash', { size: 15 })}</button>
    </footer>
  </div>`;
}

// ——— Add book dialog (Open Library search + manual) ————————————————————————
export function openBookSearch(query = '', { manualTitle = null } = {}) {
  if (manualTitle !== null) { void addManually(manualTitle); return; }
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog book-search';
  const state = { query, page: 1, results: [], total: 0, loading: false, error: null, hasMore: false };
  dialog.innerHTML = `<div class="dialog-inner">
    <header class="dialog-head"><h2>Add a book</h2><button type="button" class="icon-button" data-close aria-label="Close">${icon('x', { size: 15 }).value}</button></header>
    <form class="book-search-form"><div class="filter-field large">${icon('search', { size: 16 }).value}<input name="q" placeholder="Title, author or ISBN" value="${escapeHtml(query)}" autocomplete="off" required></div><button class="button is-primary" type="submit">Search</button></form>
    <div class="book-results" role="list"></div>
    <footer class="dialog-actions"><span class="muted small">Searches Open Library only when you press Search.</span><span class="grow"></span><button type="button" class="button ghost" data-manual>Add manually</button></footer>
  </div>`;
  document.body.append(dialog);
  const results = dialog.querySelector('.book-results');
  const paint = () => {
    if (state.loading && !state.results.length) { results.innerHTML = '<p class="muted pad">Searching…</p>'; return; }
    if (state.error) { results.innerHTML = `<p class="error pad">${escapeHtml(state.error)}</p>`; return; }
    if (!state.results.length) { results.innerHTML = state.query ? '<p class="muted pad">No results yet — try another spelling or the ISBN.</p>' : '<p class="muted pad">Find a book to add it to your library.</p>'; return; }
    results.innerHTML = `<p class="muted small pad">${state.total.toLocaleString()} matches</p>${state.results.map((book, index) => {
      const exists = store.state.reading.books.some((item) => (book.source?.workId && item.source?.workId === book.source.workId) || (book.isbn13 && item.isbn13 === book.isbn13));
      return `<div class="book-result" role="listitem">
        ${renderCover(book, 'tiny').value}
        <div class="book-result-body"><b>${escapeHtml(book.title)}</b><small>${escapeHtml(book.authors.join(', '))}${book.publishedYear ? ` · ${book.publishedYear}` : ''}</small></div>
        ${exists ? '<span class="muted small">In library</span>' : `<div class="book-result-add"><button type="button" class="button small" data-add="${index}" data-status="to_read">To read</button><button type="button" class="button small ghost" data-add="${index}" data-status="next_up">Next</button><button type="button" class="button small ghost" data-add="${index}" data-status="reading">Reading</button></div>`}
      </div>`;
    }).join('')}${state.hasMore ? '<button type="button" class="button ghost load-more" data-more>Load 20 more</button>' : ''}`;
  };
  const search = async (append = false) => {
    state.loading = true; state.error = null;
    if (!append) { state.results = []; state.page = 1; }
    paint();
    try {
      const body = await postJson('/api/run/reading.searchCatalog', { query: state.query, page: state.page });
      const found = body.result;
      state.results = append ? [...state.results, ...found.results] : found.results;
      state.total = found.total ?? state.results.length;
      state.hasMore = Boolean(found.hasMore ?? found.nextPage);
    } catch (error) {
      state.error = error.message;
    } finally {
      state.loading = false;
      paint();
    }
  };
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.query = event.currentTarget.q.value.trim();
    if (state.query) void search();
  });
  dialog.addEventListener('click', async (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) { dialog.close(); return; }
    if (event.target.closest('[data-more]')) { state.page += 1; void search(true); return; }
    if (event.target.closest('[data-manual]')) { dialog.close(); void addManually(dialog.querySelector('input[name=q]').value.trim()); return; }
    const add = event.target.closest('[data-add]');
    if (add) {
      add.disabled = true;
      add.textContent = 'Adding…';
      try {
        const result = await run('reading.add', { catalogBook: state.results[Number(add.dataset.add)], status: add.dataset.status });
        paint();
        if (result?.book) toast(`Added to ${READING_STATUS[add.dataset.status]}`, { tone: 'quiet', action: { label: 'Open', run: () => { dialog.close(); navigate('/reading', { keepSheet: true }); act.openBook(result.book.id); } } });
      } catch { add.disabled = false; add.textContent = 'Retry'; }
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  paint();
  if (query) void search();
  dialog.querySelector('input[name=q]').focus();
}

async function addManually(title = '') {
  const values = await formDialog({
    title: 'Add a book manually',
    submitLabel: 'Add book',
    fields: [
      { name: 'title', label: 'Title', value: title, required: true, autofocus: true },
      { name: 'authors', label: 'Authors', placeholder: 'Comma-separated' },
      { name: 'pageCount', label: 'Pages', type: 'number', min: 1 },
      { name: 'status', label: 'Shelf', type: 'select', value: 'to_read', options: Object.entries(READING_STATUS).map(([value, label]) => ({ value, label })) },
    ],
  });
  if (!values) return;
  await run('reading.add', { title: values.title, authors: values.authors.split(',').map((author) => author.trim()).filter(Boolean), ...(values.pageCount ? { pageCount: values.pageCount } : {}), status: values.status }).catch(() => undefined);
}

async function editBook(id) {
  const book = lookup.book(id);
  const values = await formDialog({
    title: 'Edit book',
    submitLabel: 'Save',
    fields: [
      { name: 'title', label: 'Title', value: book.title, required: true, autofocus: true },
      { name: 'subtitle', label: 'Subtitle', value: book.subtitle || '' },
      { name: 'authors', label: 'Authors', value: book.authors.join(', '), hint: 'Comma-separated' },
      { name: 'publishedYear', label: 'Published', type: 'number', value: book.publishedYear ?? '' },
      { name: 'pageCount', label: 'Pages', type: 'number', value: book.pageCount ?? '' },
      { name: 'publisher', label: 'Publisher', value: book.publisher || '' },
      { name: 'description', label: 'Description', type: 'textarea', value: book.description || '', rows: 5 },
    ],
  });
  if (!values) return;
  await run('reading.update', {
    bookId: id, title: values.title, subtitle: values.subtitle || null,
    authors: values.authors.split(',').map((author) => author.trim()).filter(Boolean),
    publishedYear: values.publishedYear || null, pageCount: values.pageCount || null,
    publisher: values.publisher || null, description: values.description || null,
  }).catch(() => undefined);
}

// ——— Drag on the shelf ———————————————————————————————————————————————————
export function startBookDrag(event, card) {
  const id = card.dataset.book;
  let target = null;
  let indicator = null;
  const clear = () => { document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target')); indicator?.remove(); indicator = null; };
  beginDrag(event, {
    source: card,
    onMove: ({ target: element, y }) => {
      clear();
      target = null;
      const column = element?.closest('[data-book-drop]');
      if (!column) return;
      column.classList.add('is-drop-target');
      const cards = [...column.querySelectorAll('[data-book]')].filter((node) => node.dataset.book !== id);
      const before = cards.find((node) => { const rect = node.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
      target = { status: column.dataset.bookDrop, beforeBookId: before?.dataset.book || null };
      const container = column.querySelector('.board-cards');
      indicator = document.createElement('div');
      indicator.className = 'drop-line card-line';
      const rect = container.getBoundingClientRect();
      const anchor = before?.getBoundingClientRect();
      const last = cards.at(-1)?.getBoundingClientRect();
      indicator.style.top = `${(anchor ? anchor.top - 5 : last ? last.bottom + 3 : rect.top + 4) - rect.top + container.scrollTop}px`;
      container.append(indicator);
    },
    onDrop: () => { clear(); if (target) act.moveBook(id, target.status, target.beforeBookId); },
    onCancel: clear,
  });
}

const cardId = (el) => el.closest('[data-book]')?.dataset.book;
const sheetBook = () => store.ui.sheet?.id;
const finishedPicker = (el, id) => {
  const book = lookup.book(id);
  pickDate({ anchor: el, title: 'Date read', value: book.finishedAt ? localDate(book.finishedAt, store.state.meta.timezone) : null, onPick: (date) => {
    if (date && date > store.state.meta.today) { toast('The date read can’t be in the future.', { tone: 'error' }); return; }
    run('reading.setFinishedDate', { bookId: id, date }, { quiet: true }).catch(() => undefined);
  } });
};

export const actions = {
  'reading-view': (el) => { setPref('reading.view', el.dataset.view); navigate(`/reading?view=${el.dataset.view}`, { replace: true, keepSheet: true }); },
  'reading-add': () => openBookSearch(''),
  'reading-status': (el) => setPref('reading.status', el.dataset.status),
  'reading-sort': (el) => {
    const current = store.prefs.reading.sort || { key: 'status', dir: 'asc' };
    setPref('reading.sort', { key: el.dataset.key, dir: current.key === el.dataset.key && current.dir === 'asc' ? 'desc' : 'asc' });
  },
  'book-open': (el) => act.openBook(cardId(el)),
  'book-menu': (el) => bookMenu(cardId(el), el),
  'book-status': (el) => { const book = lookup.book(cardId(el)); pickFromList({ anchor: el, title: 'Shelf', value: book.status, options: Object.entries(READING_STATUS).map(([value, label]) => ({ value, label })), onPick: (status) => act.setBookStatus(book.id, status) }); },
  'book-finished-date': (el) => finishedPicker(el, cardId(el)),
  'book-sheet-menu': (el) => bookMenu(sheetBook(), el),
  'book-sheet-status': (el) => { const book = lookup.book(sheetBook()); pickFromList({ anchor: el, title: 'Shelf', value: book.status, options: Object.entries(READING_STATUS).map(([value, label]) => ({ value, label })), onPick: (status) => act.setBookStatus(book.id, status) }); },
  'book-sheet-finished': (el) => finishedPicker(el, sheetBook()),
  'book-sheet-tags': (el) => { const book = lookup.book(sheetBook()); pickTags({ anchor: el, value: book.tags, max: 24, known: [...new Set(store.state.reading.books.flatMap((item) => item.tags))], onChange: (tags) => run('reading.setTags', { bookId: book.id, tags }, { quiet: true }).catch(() => undefined) }); },
  'book-sheet-edit': () => editBook(sheetBook()),
  'book-sheet-codex': () => attachContext('book', sheetBook()),
  'book-sheet-delete': () => act.deleteBook(sheetBook()),
};

export function onReadingTag(value) {
  setPref('reading.tag', value);
}

export function presence() {
  const book = store.ui.sheet?.kind === 'book' ? lookup.book(store.ui.sheet.id) : null;
  return book ? { title: 'Reading', selected: { kind: 'book', id: book.id, title: book.title } } : { title: 'Reading' };
}

export default { id: 'reading', render: render_, actions, presence };
