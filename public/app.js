import {
  createProjectsUiState,
  PROJECT_BOARD_STATUSES,
  projectsWithStatus,
  renderProjects as renderProjectsWorkspace,
} from './projects.js';
import {
  createReadingUiState,
  READING_BOARD_STATUSES,
  readingFinishedInYear,
  readingWithBookPosition,
  readingWithBookStatus,
  renderReading,
} from './reading.js';

const VALID_TABS = ['today', 'projects', 'reading', 'analytics', 'almanac'];
let state = null;
let activeTab = 'projects';
let activeRange = 'week';
let recommendationIndex = 0;
let recommendationDismissed = false;
let pageError = null;
let stateRefreshTimer = null;
let eventSource = null;
let projectPointerDrag = null;
let readingPointerDrag = null;
const projectsUi = createProjectsUiState();
const readingUi = createReadingUiState();

const codex = {
  connection: 'connecting',
  connectionDetail: null,
  account: null,
  threads: [],
  activeThread: null,
  runningTurns: {},
  pendingRequests: [],
  draft: '',
  sending: false,
  opening: false,
  error: null,
  voice: {
    available: false,
    reason: 'Checking whether Codex desktop dictation is available.',
  },
};

const app = document.getElementById('app');
const THREAD_STORAGE_KEY = 'lifeos.codex.threadId';
const RAIL_STORAGE_KEY = 'lifeos.codex.railCollapsed';
const THEME_STORAGE_KEY = 'lifeos.theme';
const THEME_COOKIE = 'lifeosTheme';
let codexRailCollapsed = localStorage.getItem(RAIL_STORAGE_KEY) === 'true';
let activeTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

void init();

async function init() {
  const params = new URLSearchParams(location.search);
  activeRange = ['week', 'month', 'quarter', 'year'].includes(params.get('range')) ? params.get('range') : 'week';
  projectsUi.view = params.get('projectView') === 'kanban' ? 'kanban' : 'list';
  readingUi.view = params.get('view') === 'library' ? 'library' : 'kanban';
  try {
    state = await fetchState(activeRange);
    activeTab = validTab(params.get('tab')) || validTab(state.meta.activeTab) || 'projects';
    render();
    connectEventStream();
    void bootstrapCodex();
  } catch (error) {
    app.innerHTML = `<div class="boot error-boot">${escapeHtml(error.message)}</div>`;
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && projectsUi.selectedProjectId) {
      projectsUi.selectedProjectId = null;
      render();
      return;
    }
    if (event.key === 'Escape' && readingUi.deleteBookId) {
      readingUi.deleteBookId = null;
      render();
      return;
    }
    if (event.key === 'Escape' && readingUi.selectedBookId) {
      readingUi.selectedBookId = null;
      render();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (codexRailCollapsed) setCodexRailCollapsed(false);
      requestAnimationFrame(() => document.querySelector('.chat-input')?.focus());
    }
  });
  window.addEventListener('popstate', async () => {
    const next = new URLSearchParams(location.search);
    activeTab = validTab(next.get('tab')) || 'projects';
    activeRange = ['week', 'month', 'quarter', 'year'].includes(next.get('range')) ? next.get('range') : 'week';
    projectsUi.view = next.get('projectView') === 'kanban' ? 'kanban' : 'list';
    readingUi.view = next.get('view') === 'library' ? 'library' : 'kanban';
    state = await fetchState(activeRange);
    render();
  });
}

async function fetchState(range = activeRange) {
  return apiJson(`/api/state?range=${encodeURIComponent(range)}`);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function render() {
  const focusedProjectId = document.activeElement
    ?.closest?.('[data-project-drag-id]')
    ?.dataset.projectDragId;
  const focusedReadingBookId = document.activeElement
    ?.closest?.('[data-reading-drag-id]')
    ?.dataset.readingDragId;
  cancelProjectPointerDrag();
  cancelReadingPointerDrag();
  app.className = `lifeos${codexRailCollapsed ? ' rail-collapsed' : ''}`;
  app.innerHTML = `
    ${renderMasthead()}
    ${renderTabs()}
    <section class="page" data-view="${activeTab}">
      ${pageError ? `<div class="page-error"><span>${escapeHtml(pageError)}</span><button data-page-error-dismiss type="button">Dismiss</button></div>` : ''}
      ${renderPage()}
    </section>
    ${renderChat()}
  `;
  bindPageEvents();
  bindChatEvents();
  scrollChatToEnd();
  if (focusedProjectId) {
    [...document.querySelectorAll('[data-project-drag-id]')]
      .find((card) => card.dataset.projectDragId === focusedProjectId)
      ?.focus();
  }
  if (focusedReadingBookId) {
    [...document.querySelectorAll('[data-reading-drag-id]')]
      .find((card) => card.dataset.readingDragId === focusedReadingBookId)
      ?.focus();
  }
}

function renderChatRegion() {
  const current = document.querySelector('.chat');
  if (!current) return;
  current.outerHTML = renderChat();
  bindChatEvents();
  scrollChatToEnd();
}

function bindPageEvents() {
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    activeTheme = activeTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = activeTheme;
    localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
    writePreferenceCookie(THEME_COOKIE, activeTheme);
    render();
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab;
      updateLocation();
      render();
    });
  });

  document.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.dataset.range === activeRange) return;
      activeRange = button.dataset.range;
      updateLocation();
      await refreshState();
    });
  });

  document.querySelector('[data-recommendation-alternate]')?.addEventListener('click', () => {
    recommendationIndex = (recommendationIndex + 1) % Math.max(1, state.recommendations.length);
    render();
  });
  document.querySelector('[data-recommendation-dismiss]')?.addEventListener('click', () => {
    recommendationDismissed = true;
    render();
  });
  document.querySelector('[data-recommendation-restore]')?.addEventListener('click', () => {
    recommendationDismissed = false;
    render();
  });
  document.querySelector('[data-session-start]')?.addEventListener('click', async (event) => {
    const rec = visibleRecommendation();
    if (!rec) return;
    await runPageAction(event.currentTarget, async () => {
      state = await apiJson('/api/session/start', jsonRequest({
        projectId: rec.projectId,
        description: rec.action,
        rawInput: `Begin recommendation: ${rec.projectName}`,
      }));
      render();
    });
  });
  document.querySelector('[data-session-stop]')?.addEventListener('click', async (event) => {
    await runPageAction(event.currentTarget, async () => {
      state = await apiJson('/api/session/stop', jsonRequest({}));
      render();
    });
  });
  document.querySelector('[data-page-error-dismiss]')?.addEventListener('click', () => {
    pageError = null;
    render();
  });
  bindProjectEvents();
  bindReadingEvents();
}

function writePreferenceCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Strict`;
}

function bindProjectEvents() {
  if (activeTab !== 'projects') return;

  document.querySelectorAll('[data-project-view]').forEach((button) => {
    button.addEventListener('click', () => {
      projectsUi.view = button.dataset.projectView;
      projectsUi.selectedProjectId = null;
      updateLocation();
      render();
    });
  });
  document.querySelectorAll('[data-project-detail]').forEach((card) => {
    card.addEventListener('click', () => {
      projectsUi.selectedProjectId = card.dataset.projectDetail;
      render();
      document.querySelector('.project-detail-close')?.focus();
    });
    card.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      projectsUi.selectedProjectId = card.dataset.projectDetail;
      render();
      document.querySelector('.project-detail-close')?.focus();
    });
  });
  document.querySelectorAll('[data-project-detail-close]').forEach((control) => {
    control.addEventListener('click', (event) => {
      if (control.classList.contains('project-detail-backdrop') && event.target !== control) return;
      projectsUi.selectedProjectId = null;
      render();
    });
  });
  document.querySelectorAll('[data-project-status-project]').forEach((select) => {
    select.addEventListener('change', () => {
      void changeProjectStatus(select.dataset.projectStatusProject, select.value, { optimistic: true });
    });
  });
  bindProjectDragAndDrop();
}

function bindProjectDragAndDrop() {
  if (projectsUi.view !== 'kanban' || projectsUi.movingProjectId) return;
  document.querySelectorAll('[data-project-drag-id]').forEach((card) => {
    card.addEventListener('pointerdown', (event) => beginProjectPointerDrag(event, card));
    card.addEventListener('keydown', (event) => moveProjectCardWithKeyboard(event, card));
    card.addEventListener('click', (event) => {
      if (card.dataset.projectDragSuppressClick !== 'true') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      delete card.dataset.projectDragSuppressClick;
    }, true);
  });
}

function beginProjectPointerDrag(event, card) {
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
  cancelProjectPointerDrag();

  const drag = {
    projectId: card.dataset.projectDragId,
    card,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    originStatus: card.dataset.projectDragStatus,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    preview: null,
    targetColumn: null,
  };
  drag.move = (moveEvent) => moveProjectPointerDrag(moveEvent, drag);
  drag.end = (endEvent) => endProjectPointerDrag(endEvent, drag, true);
  drag.cancel = (cancelEvent) => endProjectPointerDrag(cancelEvent, drag, false);
  projectPointerDrag = drag;
  window.addEventListener('pointermove', drag.move, { passive: false });
  window.addEventListener('pointerup', drag.end);
  window.addEventListener('pointercancel', drag.cancel);
}

function moveProjectPointerDrag(event, drag) {
  if (projectPointerDrag !== drag || event.pointerId !== drag.pointerId) return;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;

  if (!drag.started) {
    if (drag.pointerType !== 'mouse' && Math.abs(deltaY) > Math.abs(deltaX)) {
      cancelProjectPointerDrag();
      return;
    }
    if (Math.hypot(deltaX, deltaY) < 7) return;
    startProjectPointerDrag(drag);
  }

  event.preventDefault();
  drag.preview.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
  updateProjectDropTarget(drag, event.clientX, event.clientY);
}

function startProjectPointerDrag(drag) {
  drag.started = true;
  drag.card.dataset.projectDragSuppressClick = 'true';
  drag.card.classList.add('dragging');
  drag.card.setPointerCapture?.(drag.pointerId);
  document.body.classList.add('project-drag-active');

  const board = drag.card.closest('.project-board');
  board?.classList.add('is-dragging');
  board?.querySelectorAll('[data-project-drop-status]').forEach((column) => {
    column.classList.add(column.dataset.projectDropStatus === drag.originStatus ? 'drop-current' : 'drop-available');
  });

  const preview = drag.card.cloneNode(true);
  preview.removeAttribute('data-project-drag-id');
  preview.removeAttribute('data-project-detail');
  preview.removeAttribute('aria-busy');
  preview.className = 'project-board-card project-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${drag.card.getBoundingClientRect().width}px`;
  document.body.append(preview);
  drag.preview = preview;
}

function updateProjectDropTarget(drag, clientX, clientY) {
  const hovered = document.elementFromPoint(clientX, clientY)?.closest('[data-project-drop-status]') || null;
  if (drag.targetColumn === hovered) return;
  drag.targetColumn?.classList.remove('drag-over');
  drag.targetColumn = hovered;
  drag.targetColumn?.classList.add('drag-over');
}

function endProjectPointerDrag(event, drag, shouldDrop) {
  if (projectPointerDrag !== drag || event.pointerId !== drag.pointerId) return;
  if (drag.started) event.preventDefault();
  const status = shouldDrop ? drag.targetColumn?.dataset.projectDropStatus : null;
  const { projectId, card } = drag;
  cancelProjectPointerDrag();

  if (drag.started) {
    card.dataset.projectDragSuppressClick = 'true';
    setTimeout(() => {
      if (card.isConnected) delete card.dataset.projectDragSuppressClick;
    }, 0);
  }
  if (status) void changeProjectStatus(projectId, status, { optimistic: true });
}

function cancelProjectPointerDrag() {
  const drag = projectPointerDrag;
  if (!drag) return;
  projectPointerDrag = null;
  window.removeEventListener('pointermove', drag.move);
  window.removeEventListener('pointerup', drag.end);
  window.removeEventListener('pointercancel', drag.cancel);
  drag.targetColumn?.classList.remove('drag-over');
  drag.card.classList.remove('dragging');
  if (drag.card.hasPointerCapture?.(drag.pointerId)) drag.card.releasePointerCapture(drag.pointerId);
  drag.preview?.remove();
  document.body.classList.remove('project-drag-active');
  document.querySelector('.project-board')?.classList.remove('is-dragging');
  document.querySelectorAll('.project-column.drop-current, .project-column.drop-available').forEach((column) => {
    column.classList.remove('drop-current', 'drop-available');
  });
}

function moveProjectCardWithKeyboard(event, card) {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || projectsUi.movingProjectId) return;
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const statusIndex = PROJECT_BOARD_STATUSES.indexOf(card.dataset.projectDragStatus);
  const offset = event.key === 'ArrowLeft' ? -1 : 1;
  const nextStatus = PROJECT_BOARD_STATUSES[statusIndex + offset];
  if (!nextStatus) return;
  event.preventDefault();
  event.stopPropagation();
  void changeProjectStatus(card.dataset.projectDragId, nextStatus, { optimistic: true, restoreFocus: true });
}

async function changeProjectStatus(projectId, status, { optimistic = false, restoreFocus = false } = {}) {
  const current = state.projects.find((project) => project.id === projectId);
  if (current?.status === status || projectsUi.movingProjectId) return;
  pageError = null;
  const previousState = state;
  if (optimistic) {
    projectsUi.movingProjectId = projectId;
    state = projectsWithStatus(state, projectId, status);
    renderProjectMove(projectId, restoreFocus);
  }
  try {
    state = await apiJson('/api/projects/status', jsonRequest({ projectId, status }));
    projectsUi.movingProjectId = null;
    renderProjectMove(projectId, restoreFocus);
  } catch (error) {
    if (optimistic) state = previousState;
    projectsUi.movingProjectId = null;
    pageError = error.message;
    renderProjectMove(projectId, restoreFocus);
  }
}

function renderProjectMove(projectId, restoreFocus) {
  render();
  if (!restoreFocus) return;
  [...document.querySelectorAll('[data-project-drag-id]')]
    .find((card) => card.dataset.projectDragId === projectId)
    ?.focus();
}

function bindReadingEvents() {
  if (activeTab !== 'reading') return;

  document.querySelectorAll('[data-reading-view]').forEach((button) => {
    button.addEventListener('click', () => {
      readingUi.view = button.dataset.readingView;
      readingUi.selectedBookId = null;
      updateLocation();
      render();
    });
  });
  document.querySelector('[data-reading-catalog-toggle]')?.addEventListener('click', () => {
    readingUi.catalogOpen = !readingUi.catalogOpen;
    readingUi.catalogError = null;
    render();
    if (readingUi.catalogOpen) document.querySelector('[data-reading-catalog-form] input')?.focus();
  });
  document.querySelector('[data-reading-catalog-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('query') || '').trim();
    void searchReadingCatalog(query);
  });
  document.querySelectorAll('[data-catalog-add-index]').forEach((button) => {
    button.addEventListener('click', () => void addCatalogBook(Number(button.dataset.catalogAddIndex), button));
  });
  document.querySelectorAll('[data-reading-status-book]').forEach((select) => {
    select.addEventListener('change', () => void changeReadingStatus(select.dataset.readingStatusBook, select.value, select));
  });
  document.querySelectorAll('[data-reading-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      readingUi.filter = button.dataset.readingFilter;
      render();
    });
  });
  document.querySelectorAll('[data-reading-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.readingSort;
      if (readingUi.sortKey === key) {
        readingUi.sortDirection = readingUi.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        readingUi.sortKey = key;
        readingUi.sortDirection = ['cover', 'addedAt', 'finishedAt'].includes(key) ? 'desc' : 'asc';
      }
      render();
    });
  });
  document.querySelector('[data-reading-local-search]')?.addEventListener('input', (event) => {
    readingUi.localQuery = event.target.value;
    applyReadingLocalFilter();
  });
  document.querySelector('[data-reading-tag-filter]')?.addEventListener('change', (event) => {
    readingUi.tagFilter = event.target.value;
    render();
  });
  applyReadingLocalFilter();
  document.querySelectorAll('[data-reading-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      readingUi.selectedBookId = button.dataset.readingDetail;
      render();
      document.querySelector('.book-detail-close')?.focus();
    });
  });
  document.querySelectorAll('[data-reading-detail-close]').forEach((control) => {
    control.addEventListener('click', (event) => {
      if (control.classList.contains('book-detail-backdrop') && event.target !== control) return;
      readingUi.selectedBookId = null;
      render();
    });
  });
  document.querySelectorAll('[data-reading-tag-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const bookId = form.dataset.readingTagForm;
      const book = state.reading.books.find((candidate) => candidate.id === bookId);
      const tag = String(new FormData(form).get('tag') || '').trim();
      if (!book || !tag) return;
      void updateReadingTags(bookId, [...(book.tags || []), tag], form.querySelector('button'));
    });
  });
  document.querySelectorAll('[data-reading-tag-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      const book = state.reading.books.find((candidate) => candidate.id === button.dataset.bookId);
      if (!book) return;
      const normalized = button.dataset.readingTagRemove.toLowerCase();
      void updateReadingTags(book.id, (book.tags || []).filter((tag) => tag.toLowerCase() !== normalized), button);
    });
  });
  document.querySelectorAll('[data-reading-finished-date-book]').forEach((input) => {
    input.addEventListener('change', () => {
      void updateReadingFinishedDate(input.dataset.readingFinishedDateBook, input.value || null, input);
    });
  });
  document.querySelector('[data-reading-delete-request]')?.addEventListener('click', (event) => {
    readingUi.deleteBookId = event.currentTarget.dataset.readingDeleteRequest;
    render();
    document.querySelector('[data-reading-delete-cancel]')?.focus();
  });
  document.querySelector('[data-reading-delete-cancel]')?.addEventListener('click', () => {
    readingUi.deleteBookId = null;
    render();
    document.querySelector('[data-reading-delete-request]')?.focus();
  });
  document.querySelector('[data-reading-delete-confirm]')?.addEventListener('click', (event) => {
    void permanentlyDeleteReadingBook(event.currentTarget.dataset.readingDeleteConfirm, event.currentTarget);
  });
  document.querySelectorAll('[data-reading-cover]').forEach((image) => {
    const markMissing = () => image.closest('.book-cover')?.classList.add('cover-missing');
    image.addEventListener('error', markMissing, { once: true });
    if (image.complete && image.naturalWidth === 0) markMissing();
  });
  bindReadingDragAndDrop();
}

async function searchReadingCatalog(query) {
  readingUi.catalogQuery = query;
  readingUi.catalogError = null;
  readingUi.catalogResults = [];
  if (!query) {
    readingUi.catalogError = 'Enter a title, author, or ISBN.';
    render();
    return;
  }
  readingUi.searching = true;
  render();
  try {
    const body = await apiJson(`/api/books/search?q=${encodeURIComponent(query)}`);
    readingUi.catalogResults = body.results || [];
  } catch (error) {
    readingUi.catalogError = error.message;
  } finally {
    readingUi.searching = false;
    render();
  }
}

async function addCatalogBook(index, button) {
  const book = readingUi.catalogResults[index];
  const status = document.querySelector(`[data-catalog-status-index="${index}"]`)?.value || 'to_read';
  if (!book) return;
  readingUi.catalogError = null;
  button.disabled = true;
  button.textContent = 'Adding…';
  try {
    state = await apiJson('/api/reading/books/import', jsonRequest({ book, status }));
    readingUi.catalogResults.splice(index, 1);
    readingUi.view = status === 'to_read' || status === 'dropped' ? 'library' : readingUi.view;
    updateLocation();
    render();
  } catch (error) {
    readingUi.catalogError = error.message;
    render();
  }
}

async function changeReadingStatus(bookId, status, control = null, { optimistic = false } = {}) {
  const current = state.reading.books.find((book) => book.id === bookId);
  if (current?.status === status || readingUi.movingBookId) return;
  pageError = null;
  const previousState = state;
  if (optimistic) {
    readingUi.movingBookId = bookId;
    state = { ...state, reading: readingWithBookStatus(state.reading, bookId, status) };
    render();
  } else if (control) {
    control.disabled = true;
  }
  try {
    state = await apiJson('/api/reading/books/status', jsonRequest({ bookId, status }));
    readingUi.movingBookId = null;
    render();
  } catch (error) {
    if (optimistic) state = previousState;
    readingUi.movingBookId = null;
    pageError = error.message;
    render();
  }
}

async function updateReadingTags(bookId, tags, control) {
  pageError = null;
  if (control) control.disabled = true;
  try {
    state = await apiJson('/api/reading/books/tags', jsonRequest({ bookId, tags }));
    render();
  } catch (error) {
    pageError = error.message;
    render();
  }
}

async function updateReadingFinishedDate(bookId, date, control) {
  pageError = null;
  readingUi.updatingDateBookId = bookId;
  if (control) control.disabled = true;
  try {
    state = await apiJson('/api/reading/books/finished-date', jsonRequest({ bookId, date }));
    readingUi.updatingDateBookId = null;
    render();
  } catch (error) {
    readingUi.updatingDateBookId = null;
    pageError = error.message;
    render();
  }
}

async function permanentlyDeleteReadingBook(bookId, button) {
  pageError = null;
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    state = await apiJson('/api/reading/books/delete', jsonRequest({ bookId }));
    readingUi.selectedBookId = null;
    readingUi.deleteBookId = null;
    const availableTags = new Set(state.reading.books.flatMap((book) => book.tags || []).map((tag) => tag.toLowerCase()));
    if (readingUi.tagFilter !== 'all' && !availableTags.has(readingUi.tagFilter.toLowerCase())) readingUi.tagFilter = 'all';
    render();
  } catch (error) {
    pageError = error.message;
    render();
  }
}

function applyReadingLocalFilter() {
  const query = readingUi.localQuery.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll('[data-reading-search-text]').forEach((row) => {
    const matches = !query || row.dataset.readingSearchText.includes(query);
    row.hidden = !matches;
    if (matches) visible += 1;
  });
  const empty = document.querySelector('[data-reading-filter-empty]');
  if (empty) empty.hidden = visible > 0;
}

function bindReadingDragAndDrop() {
  if (readingUi.movingBookId) return;
  document.querySelectorAll('[data-reading-drag-id]').forEach((card) => {
    card.addEventListener('pointerdown', (event) => beginReadingPointerDrag(event, card));
    card.addEventListener('keydown', (event) => moveReadingCardWithKeyboard(event, card));
    card.addEventListener('click', (event) => {
      if (card.dataset.readingDragSuppressClick !== 'true') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      delete card.dataset.readingDragSuppressClick;
    }, true);
  });
}

function beginReadingPointerDrag(event, card) {
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
  cancelReadingPointerDrag();

  const drag = {
    bookId: card.dataset.readingDragId,
    card,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    originStatus: card.dataset.readingDragStatus,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    preview: null,
    targetColumn: null,
    targetBeforeCard: null,
    targetColumnBody: null,
    beforeBookId: null,
  };
  drag.move = (moveEvent) => moveReadingPointerDrag(moveEvent, drag);
  drag.end = (endEvent) => endReadingPointerDrag(endEvent, drag, true);
  drag.cancel = (cancelEvent) => endReadingPointerDrag(cancelEvent, drag, false);
  readingPointerDrag = drag;
  window.addEventListener('pointermove', drag.move, { passive: false });
  window.addEventListener('pointerup', drag.end);
  window.addEventListener('pointercancel', drag.cancel);
}

function moveReadingPointerDrag(event, drag) {
  if (readingPointerDrag !== drag || event.pointerId !== drag.pointerId) return;
  const deltaX = event.clientX - drag.startX;
  const deltaY = event.clientY - drag.startY;

  if (!drag.started) {
    if (drag.pointerType !== 'mouse' && Math.abs(deltaY) > Math.abs(deltaX)) {
      cancelReadingPointerDrag();
      return;
    }
    if (Math.hypot(deltaX, deltaY) < 7) return;
    startReadingPointerDrag(drag);
  }

  event.preventDefault();
  drag.preview.style.transform = `translate3d(${event.clientX + 14}px, ${event.clientY + 14}px, 0)`;
  updateReadingDropTarget(drag, event.clientX, event.clientY);
}

function startReadingPointerDrag(drag) {
  drag.started = true;
  drag.card.dataset.readingDragSuppressClick = 'true';
  drag.card.classList.add('dragging');
  drag.card.setPointerCapture?.(drag.pointerId);
  document.body.classList.add('reading-drag-active');

  const board = drag.card.closest('.reading-board');
  board?.classList.add('is-dragging');
  board?.querySelectorAll('[data-reading-drop-status]').forEach((column) => {
    column.classList.add(column.dataset.readingDropStatus === drag.originStatus ? 'drop-current' : 'drop-available');
  });

  const preview = drag.card.cloneNode(true);
  preview.removeAttribute('data-reading-drag-id');
  preview.removeAttribute('aria-busy');
  preview.className = 'reading-card reading-drag-preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.style.width = `${drag.card.getBoundingClientRect().width}px`;
  preview.querySelectorAll('button, select, input, a').forEach((control) => control.setAttribute('tabindex', '-1'));
  document.body.append(preview);
  drag.preview = preview;
}

function updateReadingDropTarget(drag, clientX, clientY) {
  const hovered = document.elementFromPoint(clientX, clientY)?.closest('[data-reading-drop-status]') || null;
  const cards = hovered
    ? [...hovered.querySelectorAll('[data-reading-drag-id]')].filter((card) => card !== drag.card)
    : [];
  const beforeCard = cards.find((card) => {
    const bounds = card.getBoundingClientRect();
    return clientY < bounds.top + bounds.height / 2;
  }) || null;
  const columnBody = hovered?.querySelector('.reading-column-body') || null;
  if (drag.targetColumn === hovered && drag.targetBeforeCard === beforeCard) return;
  drag.targetColumn?.classList.remove('drag-over');
  drag.targetBeforeCard?.classList.remove('drop-before');
  drag.targetColumnBody?.classList.remove('drop-at-end');
  drag.targetColumn = hovered;
  drag.targetBeforeCard = beforeCard;
  drag.targetColumnBody = columnBody;
  drag.beforeBookId = beforeCard?.dataset.readingDragId || null;
  drag.targetColumn?.classList.add('drag-over');
  if (beforeCard) beforeCard.classList.add('drop-before');
  else columnBody?.classList.add('drop-at-end');
}

function endReadingPointerDrag(event, drag, shouldDrop) {
  if (readingPointerDrag !== drag || event.pointerId !== drag.pointerId) return;
  if (drag.started) event.preventDefault();
  const status = shouldDrop ? drag.targetColumn?.dataset.readingDropStatus : null;
  const beforeBookId = shouldDrop ? drag.beforeBookId : null;
  const { bookId, card } = drag;
  cancelReadingPointerDrag();

  if (drag.started) {
    card.dataset.readingDragSuppressClick = 'true';
    setTimeout(() => {
      if (card.isConnected) delete card.dataset.readingDragSuppressClick;
    }, 0);
  }
  if (status) void positionReadingBook(bookId, status, beforeBookId);
}

function cancelReadingPointerDrag() {
  const drag = readingPointerDrag;
  if (!drag) return;
  readingPointerDrag = null;
  window.removeEventListener('pointermove', drag.move);
  window.removeEventListener('pointerup', drag.end);
  window.removeEventListener('pointercancel', drag.cancel);
  drag.targetColumn?.classList.remove('drag-over');
  drag.targetBeforeCard?.classList.remove('drop-before');
  drag.targetColumnBody?.classList.remove('drop-at-end');
  drag.card.classList.remove('dragging');
  if (drag.card.hasPointerCapture?.(drag.pointerId)) drag.card.releasePointerCapture(drag.pointerId);
  drag.preview?.remove();
  document.body.classList.remove('reading-drag-active');
  document.querySelector('.reading-board')?.classList.remove('is-dragging');
  document.querySelectorAll('.reading-column.drop-current, .reading-column.drop-available').forEach((column) => {
    column.classList.remove('drop-current', 'drop-available');
  });
}

function moveReadingCardWithKeyboard(event, card) {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || readingUi.movingBookId) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

  const bookId = card.dataset.readingDragId;
  const status = card.dataset.readingDragStatus;
  const statusIndex = READING_BOARD_STATUSES.indexOf(status);
  let nextStatus = status;
  let beforeBookId = null;

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const offset = event.key === 'ArrowLeft' ? -1 : 1;
    nextStatus = READING_BOARD_STATUSES[statusIndex + offset];
    if (!nextStatus) return;
  } else {
    const siblings = orderedReadingBooks(status);
    const index = siblings.findIndex((book) => book.id === bookId);
    if (event.key === 'ArrowUp') {
      if (index <= 0) return;
      beforeBookId = siblings[index - 1].id;
    } else {
      if (index < 0 || index >= siblings.length - 1) return;
      beforeBookId = siblings[index + 2]?.id || null;
    }
  }

  event.preventDefault();
  event.stopPropagation();
  void positionReadingBook(bookId, nextStatus, beforeBookId, { restoreFocus: true });
}

function orderedReadingBooks(status) {
  const currentYear = String(state.meta.today).slice(0, 4);
  return state.reading.books
    .filter((book) => book.status === status && (
      status !== 'finished'
      || readingFinishedInYear(book, currentYear, state.meta.timezone)
    ))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.title.localeCompare(b.title));
}

async function positionReadingBook(bookId, status, beforeBookId, { restoreFocus = false } = {}) {
  if (readingUi.movingBookId) return;
  const positioned = readingWithBookPosition(state.reading, bookId, status, beforeBookId);
  if (positioned === state.reading) return;

  pageError = null;
  const previousState = state;
  readingUi.movingBookId = bookId;
  state = { ...state, reading: positioned };
  renderReadingPosition(bookId, restoreFocus);
  try {
    state = await apiJson('/api/reading/books/reorder', jsonRequest({ bookId, status, beforeBookId }));
    readingUi.movingBookId = null;
    renderReadingPosition(bookId, restoreFocus);
  } catch (error) {
    state = previousState;
    readingUi.movingBookId = null;
    pageError = error.message;
    renderReadingPosition(bookId, restoreFocus);
  }
}

function renderReadingPosition(bookId, restoreFocus) {
  render();
  if (!restoreFocus) return;
  [...document.querySelectorAll('[data-reading-drag-id]')]
    .find((card) => card.dataset.readingDragId === bookId)
    ?.focus();
}

async function runPageAction(button, action) {
  pageError = null;
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    pageError = error.message;
    render();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function updateLocation() {
  const params = new URLSearchParams();
  if (activeTab !== 'projects') params.set('tab', activeTab);
  if (activeRange !== 'week') params.set('range', activeRange);
  if (activeTab === 'projects' && projectsUi.view !== 'list') params.set('projectView', projectsUi.view);
  if (activeTab === 'reading' && readingUi.view !== 'kanban') params.set('view', readingUi.view);
  const query = params.toString();
  history.pushState(null, '', query ? `?${query}` : location.pathname);
}

function renderMasthead() {
  const date = formatDateLong(state.meta.today);
  return `
    <header class="masthead">
        <div class="masthead-side">
          <span>Week <b>${state.meta.weekNumber}</b></span>
          <span>No. <b>${state.meta.issueNumber}</b></span>
        </div>
      <div class="masthead-name">
        ${escapeHtml(state.meta.appName)}
      </div>
      <div class="masthead-side right">
        <span><b>${date.weekday}</b>, ${date.rest}</span>
        <button class="theme-toggle" data-theme-toggle type="button" aria-label="Switch to ${activeTheme === 'dark' ? 'light' : 'dark'} mode">
          <span class="theme-toggle-mark" aria-hidden="true"></span>
          ${activeTheme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>
    </header>
  `;
}

function renderTabs() {
  const tabs = [
    ['today', 'Today'],
    ['projects', 'Projects'],
    ['analytics', 'Analytics'],
    ['almanac', 'Almanac'],
    ['reading', 'Readings'],
  ];
  const meta = {
    today: state.activeSession ? 'A focused session is running' : 'What now and what has happened',
    projects: `${titleNumber(state.summary.activeCount)} active - ${titleNumber(state.summary.criticalCount)} critical`,
    analytics: 'Where the hours actually went',
    almanac: 'A record of what got done',
  };
  const activeMeta = meta[activeTab];
  return `
    <nav class="tabs" aria-label="LifeOS sections">
      ${tabs.map(([id, label]) => `
        <button class="tab ${id === activeTab ? 'active' : ''}" data-tab="${id}" type="button">${label}</button>
      `).join('')}
      ${activeMeta ? `<div class="tab-meta"><span class="smallcaps">${escapeHtml(activeMeta)}</span></div>` : ''}
    </nav>
  `;
}

function renderPage() {
  if (activeTab === 'today') return renderToday();
  if (activeTab === 'reading') return renderReading(state.reading, readingUi, {
    today: state.meta.today,
    timeZone: state.meta.timezone,
  });
  if (activeTab === 'analytics') return renderAnalytics();
  if (activeTab === 'almanac') return renderAlmanac();
  return renderProjectsWorkspace(state.projects, state.domains, projectsUi);
}

function renderToday() {
  const grouped = groupByActivity(state.todayEntries);
  return `
    <div class="today-layout">
      ${renderRecommendationPanel()}
      <section class="panel">
        <div class="panel-head">
          <span class="smallcaps-strong">The day so far</span>
          <span class="grow"></span>
          <span class="smallcaps">Plan ${formatHours(state.settings.defaultDailyPlanHours)} - ${Math.round(state.summary.todayMinutes / (state.settings.defaultDailyPlanHours * 60) * 100)}%</span>
        </div>
        <div class="total-time">${formatDayTotal(state.summary.todayMinutes)}<span class="of">across ${state.todayEntries.length} entries</span></div>
        <div class="activity-bar">
          ${Object.entries(grouped).map(([type, minutes]) => `<i class="activity-seg" style="--minutes:${minutes};--domain:${activityColor(type)}"></i>`).join('')}
        </div>
        <div class="entries">
          ${state.todayEntries.length ? state.todayEntries.map(renderEntry).join('') : '<p class="empty-copy">No time logged today.</p>'}
        </div>
      </section>
    </div>
  `;
}

function renderRecommendationPanel() {
  if (state.activeSession) {
    const project = state.projects.find((candidate) => candidate.id === state.activeSession.projectId);
    const domain = project ? state.domains[project.domain] : state.domains.personal;
    return `
      <section class="panel active-session" style="--domain:${domain.color}">
        <div class="panel-head"><span class="smallcaps-strong">Session running</span><span class="smallcaps">Started ${escapeHtml(formatClock(state.activeSession.startedAt))}</span></div>
        <div class="pull-project">${escapeHtml(project?.name || 'General work')}.</div>
        <div class="pull-sub">${escapeHtml(state.activeSession.description)}</div>
        <div class="context-line"><span class="context-swatch"></span><span class="smallcaps-strong">${escapeHtml(state.activeSession.activityType.replace('_', ' '))}</span></div>
        <div class="actions"><button class="action-btn" data-session-stop type="button">Stop and log</button></div>
        <p class="callout-text" style="margin-top:24px">LifeOS will calculate the elapsed time and create a real time entry.</p>
      </section>
    `;
  }
  if (recommendationDismissed) {
    return `
      <section class="panel dismissed-recommendation">
        <div class="panel-head"><span class="smallcaps-strong">What now</span></div>
        <div class="pull-sub">Recommendation dismissed for this visit.</div>
        <div class="actions"><button class="action-btn secondary" data-recommendation-restore type="button">Restore</button></div>
      </section>
    `;
  }
  const rec = visibleRecommendation();
  if (!rec) return '<section class="panel"><p class="empty-copy">No active project recommendation is available.</p></section>';
  const domain = state.domains[rec.domain];
  return `
    <section class="panel" style="--domain:${domain.color}">
      <div class="panel-head"><span class="smallcaps-strong">What now</span><span class="smallcaps">Now - ${formatMinutes(rec.durationMinutes)} - ${Math.round(rec.confidence * 100)}%</span></div>
      <div class="pull-project">${escapeHtml(rec.projectName)}.</div>
      <div class="pull-sub">${escapeHtml(rec.action)}</div>
      <div class="context-line"><span class="context-swatch"></span><span class="smallcaps-strong">${escapeHtml(domain.label)}</span><span class="smallcaps" style="color:var(--critical)">${escapeHtml(rec.reasonShort)}</span></div>
      <div class="actions">
        <button class="action-btn" data-session-start type="button">Begin - ${formatMinutes(rec.durationMinutes)}</button>
        <button class="action-btn secondary" data-recommendation-alternate type="button">Alternate</button>
        <button class="action-btn text" data-recommendation-dismiss type="button">Dismiss</button>
      </div>
      <p class="callout-text" style="margin-top:24px">${escapeHtml(rec.reasonLong)}</p>
    </section>
  `;
}

function visibleRecommendation() {
  if (!state.recommendations?.length) return null;
  return state.recommendations[recommendationIndex % state.recommendations.length];
}

function renderEntry(entry) {
  const project = state.projects.find((candidate) => candidate.id === entry.projectId);
  return `
    <div class="entry-row">
      <span class="entry-time">${escapeHtml(entry.time || '-')}</span>
      <span class="entry-desc"><span class="entry-type">${escapeHtml(entry.activityType.replace('_', ' '))}${project ? ` - ${escapeHtml(project.name)}` : ''}</span>${escapeHtml(entry.description)}</span>
      <span class="entry-duration">${entry.durationMinutes}m</span>
    </div>
  `;
}

function renderAnalytics() {
  const ratioDelta = Math.round((state.summary.deepRatio - state.settings.deepTarget) * 100);
  return `
    <div class="analytics-layout">
      <header class="analytics-header">
        <div class="range-tabs">
          ${Object.entries(state.analytics.labels).map(([range, label]) => `<button class="range-tab ${range === activeRange ? 'active' : ''}" data-range="${range}" type="button">${escapeHtml(label)}</button>`).join('')}
        </div>
        <div class="kpis">
          ${renderKpi('Time tracked', state.summary.totalRangeLabel, `of ${state.summary.plannedRangeLabel} plan`)}
          ${renderKpi('Deep ratio', `${Math.round(state.summary.deepRatio * 100)}%`, `${ratioDelta >= 0 ? '+' : ''}${ratioDelta} pts vs target`)}
          ${renderKpi('On plan', `${state.summary.onPlan}%`, state.summary.onPlan >= 100 ? 'ahead' : `short ${100 - state.summary.onPlan} pts`)}
        </div>
      </header>
      <div class="analytics-row">${renderHeatmap()}${renderDomainBreakdown()}</div>
      <div class="analytics-row bottom">${renderProjectTrends()}${renderComposition()}</div>
    </div>
  `;
}

function renderKpi(label, number, sub) {
  return `<div class="kpi"><span class="kpi-label">${escapeHtml(label)}</span><span class="kpi-number">${escapeHtml(number)}</span><span class="smallcaps">${escapeHtml(sub)}</span></div>`;
}

function renderHeatmap() {
  const dayCodes = state.rhythmHeatmap.dates.map((date) => new Intl.DateTimeFormat('en-US', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)));
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Daily rhythm</h3><span class="grow"></span><span class="smallcaps">Last 14 days - 00-24h</span></div>
      <div class="heatmap">
        <div></div>
        <div class="hour-axis">${Array.from({ length: 24 }, (_, hour) => `<span>${hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}</span>`).join('')}</div>
        <div class="day-axis">${dayCodes.map((day) => `<span>${day}</span>`).join('')}</div>
        <div class="matrix">${state.rhythmHeatmap.values.flatMap((row) => row.map((value) => `<i class="heat-cell" style="background:${heatmapColor(value)}"></i>`)).join('')}</div>
      </div>
    </section>
  `;
}

function renderDomainBreakdown() {
  const weeklyPlanTotal = Object.values(state.settings.weeklyPlanByDomain).reduce((sum, value) => sum + Number(value), 0);
  const planScale = weeklyPlanTotal ? state.summary.plannedRangeHours / weeklyPlanTotal : 1;
  const values = Object.keys(state.domains).map((key) => ({
    key,
    actual: state.analytics.actualByDomain[key] || 0,
    planned: (state.settings.weeklyPlanByDomain[key] || 0) * planScale,
  }));
  const max = Math.max(1, ...values.flatMap((item) => [item.actual, item.planned]));
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Domain breakdown</h3><span class="grow"></span><span class="smallcaps">Plan marker</span></div>
      <div class="domain-rows">
        ${values.map(({ key, actual, planned }) => {
          const domain = state.domains[key];
          const delta = Math.round((actual - planned) * 10) / 10;
          return `
            <div class="domain-row" style="--domain:${domain.color};--actual:${actual / max * 100}%;--planned:${planned / max * 100}%">
              <span class="domain-label">${escapeHtml(domain.label)}</span><span class="domain-bar"><i class="domain-bar-fill"></i><i class="domain-plan"></i></span>
              <span class="domain-value">${actual ? formatHours(actual) : '-'}</span><span class="domain-delta" style="color:${delta >= 0 ? 'var(--healthy)' : 'var(--critical)'}">${delta >= 0 ? '+' : ''}${delta.toFixed(1)}</span>
            </div>`;
        }).join('')}
      </div>
    </section>
  `;
}

function renderProjectTrends() {
  const projects = [...state.projects].sort((a, b) => b.weekHours - a.weekHours);
  const max = Math.max(1, ...projects.flatMap((project) => project.weekHistory));
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Project trends</h3><span class="grow"></span><span class="smallcaps">Hours / week - last 8</span></div>
      <div class="trend-rows">
        ${projects.map((project) => {
          const domain = state.domains[project.domain];
          const current = project.weekHistory.at(-1) || 0;
          const previous = project.weekHistory.at(-2) || 0;
          const delta = current - previous;
          return `<div class="trend-row" style="--domain:${domain.color}"><span class="trend-name"><i></i>${escapeHtml(project.name)}</span><span class="spark">${project.weekHistory.map((value, index) => `<i style="height:${Math.max(2, value / max * 100)}%;opacity:${index === project.weekHistory.length - 1 ? 1 : 0.55}"></i>`).join('')}</span><span class="trend-current">${current ? formatHours(current) : '-'}</span><span class="trend-delta" style="color:${delta > 0.1 ? 'var(--healthy)' : delta < -0.1 ? 'var(--critical)' : 'var(--ink-faint)'}">${delta > 0.1 ? 'up' : delta < -0.1 ? 'dn' : '-'}</span></div>`;
        }).join('')}
      </div>
    </section>
  `;
}

function renderComposition() {
  const comp = state.analytics.composition;
  const total = Math.max(0.0001, comp.deep + comp.shallow + comp.admin);
  const pc = state.analytics.productionConsumption;
  return `
    <section class="chart-card">
      <div class="chart-head"><h3>Composition</h3><span class="grow"></span><span class="smallcaps">Deep target ${Math.round(state.settings.deepTarget * 100)}%</span></div>
      <div class="smallcaps-strong">Deep - Shallow - Admin</div>
      <div class="composition-bar">
        <span class="composition-seg" style="flex:${comp.deep || 0.001};background:var(--ink)">Deep ${Math.round(comp.deep / total * 100)}%</span>
        <span class="composition-seg" style="flex:${comp.shallow || 0.001};background:var(--ink-dim)">Shallow ${Math.round(comp.shallow / total * 100)}%</span>
        <span class="composition-seg" style="flex:${comp.admin || 0.001};background:var(--ink-faint);color:var(--ink)">Admin ${Math.round(comp.admin / total * 100)}%</span>
      </div>
      <div class="smallcaps-strong" style="margin-top:18px">Production - Consumption</div>
      <div class="composition-bar">
        <span class="composition-seg" style="flex:${pc.productionPct || 0.001};background:${state.domains.filmmaking.color}">Production ${pc.productionPct}%</span>
        <span class="composition-seg" style="flex:${pc.consumptionPct || 0.001};background:${state.domains.research.color}">Consumption ${pc.consumptionPct}%</span>
      </div>
      <div class="support-note smallcaps">Support work: ${formatHours(pc.supportHours)}</div>
      <div class="callout"><div class="callout-kicker">Computed weekly note</div><div class="callout-text">${escapeHtml(state.analytics.note)}</div></div>
    </section>
  `;
}

function renderAlmanac() {
  const challenge = state.challenge;
  const deep = state.analytics.deepWork;
  return `
    <div class="almanac-layout">
      <div class="almanac-column">
        ${challenge ? `<section class="challenge"><div class="challenge-kicker">Weekly challenge</div><div class="challenge-text">"${escapeHtml(challenge.text)}"</div><div class="pips">${Array.from({ length: challenge.target }, (_, index) => `<i class="pip ${index < challenge.progress ? 'on' : ''}"></i>`).join('')}<span class="smallcaps">${challenge.progress} of ${challenge.target} - ${challenge.daysLeft} days remaining</span></div></section>` : ''}
        <section class="almanac-card">
          <div class="almanac-card-head"><h3>Deep work</h3></div>
          <div class="counter-grid"><div><span class="smallcaps">${escapeHtml(state.analytics.labels.month)}</span><div class="counter-big">${formatMinutes(deep.monthMinutes)}</div></div><div><span class="smallcaps">YTD ${state.meta.today.slice(0, 4)}</span><div class="counter-big" style="color:var(--accent)">${formatMinutes(deep.yearMinutes)}</div></div></div>
        </section>
        <section class="almanac-card"><div class="almanac-card-head"><h3>Streaks</h3><span class="grow"></span><span class="smallcaps">${state.projects.filter((project) => project.streak > 0).length} active</span></div>${renderStreaks()}</section>
      </div>
      <section class="almanac-card"><div class="almanac-card-head"><h3>This fortnight</h3><span class="grow"></span><span class="smallcaps">${state.milestones.length} entries</span></div>${state.milestones.map((milestone) => `<div class="milestone-row"><span class="milestone-date">${escapeHtml(formatMilestoneDate(milestone.date))}</span><span class="milestone-text">${escapeHtml(milestone.text)}</span></div>`).join('')}</section>
    </div>
  `;
}

function renderStreaks() {
  const projects = state.projects.filter((project) => project.streak > 0).sort((a, b) => b.streak - a.streak);
  if (!projects.length) return '<p class="empty-copy">No active 30-minute streaks yet.</p>';
  return projects.map((project) => {
    const domain = state.domains[project.domain];
    return `<div class="streak-row" style="--domain:${domain.color}"><span class="streak-name">${escapeHtml(project.name)}</span><span class="stat-v">${project.streak}d</span><span class="streak-pips">${Array.from({ length: 12 }, (_, index) => `<i class="${index >= project.streak ? 'cold' : ''}"></i>`).join('')}</span></div>`;
  }).join('');
}

function renderChat() {
  const account = codex.account?.account;
  const subscriptionReady = account?.type === 'chatgpt';
  const activeThread = codex.activeThread;
  const busy = activeThread?.turns?.some((turn) => turn.status === 'inProgress') || Boolean(codex.runningTurns[activeThread?.id]);
  const statusLabel = subscriptionReady ? account.email || `ChatGPT ${account.planType || ''}` : codex.connection;
  return `
    <aside class="chat${codexRailCollapsed ? ' is-collapsed' : ''}" aria-label="Codex assistant">
      <button
        class="rail-toggle"
        data-codex-rail-toggle
        type="button"
        aria-controls="codex-rail-content"
        aria-expanded="${codexRailCollapsed ? 'false' : 'true'}"
        aria-label="${codexRailCollapsed ? 'Open Codex panel' : 'Collapse Codex panel'}"
        title="${codexRailCollapsed ? 'Open Codex' : 'Collapse Codex'}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
        <span class="rail-toggle-label">Codex</span>
      </button>
      <div class="chat-panel" id="codex-rail-content" ${codexRailCollapsed ? 'hidden' : ''}>
        <div class="chat-top">
          <div class="chat-name">Codex</div>
          <div class="chat-sub"><span class="online-dot ${codex.connection === 'connected' ? '' : 'offline'}"></span><span>${escapeHtml(statusLabel)}</span><span>-</span><span>LifeOS</span></div>
        </div>
        <div class="chat-taskbar">
          <select class="thread-select" aria-label="Codex task" ${codex.opening ? 'disabled' : ''}>
            <option value="">${codex.threads.length ? 'Choose a task' : 'No LifeOS tasks yet'}</option>
            ${codex.threads.map((thread) => `<option value="${escapeAttribute(thread.id)}" ${thread.id === activeThread?.id ? 'selected' : ''}>${escapeHtml(threadTitle(thread))}</option>`).join('')}
          </select>
          <button class="chat-tool-button" data-codex-new type="button" ${!subscriptionReady || codex.opening ? 'disabled' : ''}>New</button>
          <button class="chat-tool-button" data-codex-refresh type="button" ${codex.opening ? 'disabled' : ''}>↻</button>
        </div>
        <div class="chat-body">
          ${renderChatBody(subscriptionReady)}
          ${codex.pendingRequests.map(renderServerRequest).join('')}
        </div>
        ${codex.error ? `<div class="chat-error"><span>${escapeHtml(codex.error)}</span><button data-codex-error-dismiss type="button">Dismiss</button></div>` : ''}
        <form class="chat-form">
          <div class="voice-strip">
            <button class="voice-button" type="button" disabled title="${escapeAttribute(codex.voice.reason)}">Voice unavailable</button>
            <span class="voice-status">${escapeHtml(codex.voice.reason)}</span>
          </div>
          <div class="chat-field">
            <span class="chat-caret">›</span>
            <textarea class="chat-input" name="message" rows="1" placeholder="Ask Codex to log, analyze, or change LifeOS…" ${!subscriptionReady || busy || codex.sending ? 'disabled' : ''}>${escapeHtml(codex.draft)}</textarea>
            ${busy ? '<button class="send-button stop" data-codex-stop type="button">Stop</button>' : `<button class="send-button" type="submit" ${!subscriptionReady || codex.sending ? 'disabled' : ''}>${codex.sending ? 'Sending' : 'Send'}</button>`}
          </div>
          <div class="hint-row"><span>Local app server - no API key</span><span>⌘K</span></div>
        </form>
      </div>
    </aside>
  `;
}

function renderChatBody(subscriptionReady) {
  if (codex.connection === 'connecting') return '<div class="chat-welcome"><b>Connecting to installed Codex…</b><span>Your signed-in account and LifeOS tasks will appear here.</span></div>';
  if (!subscriptionReady) {
    const message = codex.account
      ? 'Codex is not using a ChatGPT account. Sign in with the installed Codex application, then refresh.'
      : 'Could not reach the installed Codex application. Start Codex or configure CODEX_EXECUTABLE.';
    return `<div class="chat-welcome"><b>Codex account required</b><span>${escapeHtml(message)}</span></div>`;
  }
  if (!codex.activeThread) return '<div class="chat-welcome"><b>One project, another doorway.</b><span>Start a LifeOS task or open an existing one. Codex already has the workspace and its compact instructions.</span></div>';
  const items = codex.activeThread.turns?.flatMap((turn) => turn.items || []) || [];
  if (!items.length) return '<div class="chat-welcome"><b>What should Codex do here?</b><span>Log time, inspect the data, or ask for a deliberate app change.</span></div>';
  return items.map(renderCodexItem).join('');
}

function renderCodexItem(item) {
  if (item.type === 'userMessage') {
    const text = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    return `<article class="message user"><div class="message-meta"><b>You</b></div><div class="message-body">${escapeHtml(text)}</div></article>`;
  }
  if (item.type === 'agentMessage') {
    return `<article class="message assistant"><div class="message-meta"><b>Codex</b></div><div class="message-body">${escapeHtml(item.text || '…')}</div></article>`;
  }
  if (item.type === 'commandExecution') return renderActivity(`Command - ${item.status || 'running'}`, [item.command, item.aggregatedOutput].filter(Boolean).join('\n\n'));
  if (item.type === 'fileChange') return renderActivity(`Files - ${item.status || 'changed'}`, (item.changes || []).map((change) => `${change.kind}: ${change.path}\n${change.diff || ''}`).join('\n\n'));
  if (item.type === 'plan') return renderActivity('Plan', item.text || '');
  if (item.type === 'reasoning') return renderActivity('Reasoning', (item.summary || []).join('\n'));
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return renderActivity(`Tool - ${item.server ? `${item.server}/` : ''}${item.tool || 'call'}`, stringifyCompact(item.result || item.error || item.arguments));
  if (item.type === 'contextCompaction') return '<div class="chat-divider">Context compacted</div>';
  return '';
}

function renderActivity(label, body) {
  const compact = String(body || '').slice(0, 6_000);
  return `<details class="chat-activity"><summary>${escapeHtml(label)}</summary>${compact ? `<pre>${escapeHtml(compact)}</pre>` : ''}</details>`;
}

function renderServerRequest(request, index) {
  const params = request.params || {};
  if (request.method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    return `
      <form class="request-card request-input-form" data-request-index="${index}">
        <div class="request-kicker">Codex is asking</div>
        ${questions.map((question) => `<fieldset><legend>${escapeHtml(question.question || question.header || 'Input required')}</legend>${Array.isArray(question.options) ? question.options.map((option, optionIndex) => `<label class="request-option"><input type="radio" name="${escapeAttribute(question.id)}" value="${escapeAttribute(option.label)}" ${optionIndex === 0 ? 'checked' : ''}><span><b>${escapeHtml(option.label)}</b><small>${escapeHtml(option.description || '')}</small></span></label>`).join('') : `<input class="request-text" name="${escapeAttribute(question.id)}" type="${question.isSecret ? 'password' : 'text'}">`}</fieldset>`).join('')}
        <div class="request-actions"><button type="submit">Answer</button></div>
      </form>`;
  }
  const command = params.command || params.reason || (params.grantRoot ? `Write access: ${params.grantRoot}` : 'Codex needs permission to continue.');
  return `
    <section class="request-card">
      <div class="request-kicker">Codex needs approval</div>
      <pre>${escapeHtml(command)}</pre>
      <div class="request-actions">
        <button data-request-index="${index}" data-request-decision="decline" type="button">Decline</button>
        <button data-request-index="${index}" data-request-decision="acceptForSession" type="button">Allow session</button>
        <button data-request-index="${index}" data-request-decision="accept" type="button">Allow once</button>
      </div>
    </section>`;
}

function bindChatEvents() {
  document.querySelector('[data-codex-rail-toggle]')?.addEventListener('click', () => {
    setCodexRailCollapsed(!codexRailCollapsed, { focusToggle: true });
  });
  const input = document.querySelector('.chat-input');
  input?.addEventListener('input', () => {
    codex.draft = input.value;
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, input.scrollHeight)}px`;
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendCodexMessage();
    }
  });
  document.querySelector('.chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendCodexMessage();
  });
  document.querySelector('[data-codex-new]')?.addEventListener('click', () => void newCodexThread());
  document.querySelector('[data-codex-refresh]')?.addEventListener('click', () => void refreshCodexThreads());
  document.querySelector('.thread-select')?.addEventListener('change', (event) => {
    if (event.target.value) void openCodexThread(event.target.value);
  });
  document.querySelector('[data-codex-stop]')?.addEventListener('click', () => void interruptCodexTurn());
  document.querySelector('[data-codex-error-dismiss]')?.addEventListener('click', () => {
    codex.error = null;
    renderChatRegion();
  });
  document.querySelectorAll('[data-request-decision]').forEach((button) => {
    button.addEventListener('click', () => void resolveApproval(Number(button.dataset.requestIndex), button.dataset.requestDecision));
  });
  document.querySelectorAll('.request-input-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const request = codex.pendingRequests[Number(form.dataset.requestIndex)];
      if (!request) return;
      const data = new FormData(form);
      const answers = Object.fromEntries((request.params.questions || []).map((question) => [question.id, { answers: [String(data.get(question.id) || '')] }]));
      void respondToCodexRequest(request, { answers });
    });
  });
}

function setCodexRailCollapsed(collapsed, { focusToggle = false } = {}) {
  codexRailCollapsed = collapsed;
  localStorage.setItem(RAIL_STORAGE_KEY, String(collapsed));
  app.classList.toggle('rail-collapsed', collapsed);

  const chat = document.querySelector('.chat');
  const panel = document.querySelector('#codex-rail-content');
  const toggle = document.querySelector('[data-codex-rail-toggle]');
  chat?.classList.toggle('is-collapsed', collapsed);
  if (panel) panel.hidden = collapsed;
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Open Codex panel' : 'Collapse Codex panel');
    toggle.title = collapsed ? 'Open Codex' : 'Collapse Codex';
  }
  if (focusToggle) requestAnimationFrame(() => toggle?.focus());
}

async function bootstrapCodex() {
  codex.connection = 'connecting';
  renderChatRegion();
  try {
    const body = await apiJson('/api/codex/bootstrap');
    codex.connection = body.connection.status;
    codex.connectionDetail = body.connection.executable;
    codex.account = body.account;
    codex.threads = body.threads || [];
    codex.voice = body.voice || codex.voice;
    codex.pendingRequests = body.pendingRequests || [];
    const stored = localStorage.getItem(THREAD_STORAGE_KEY);
    const selected = codex.threads.find((thread) => thread.id === stored) || codex.threads[0];
    if (selected) await openCodexThread(selected.id, { quiet: true });
  } catch (error) {
    codex.connection = 'error';
    codex.error = error.message;
  }
  renderChatRegion();
}

async function refreshCodexThreads() {
  codex.opening = true;
  codex.error = null;
  renderChatRegion();
  try {
    const body = await apiJson('/api/codex/bootstrap');
    codex.connection = body.connection.status;
    codex.account = body.account;
    codex.threads = body.threads || [];
    codex.voice = body.voice || codex.voice;
  } catch (error) {
    codex.error = error.message;
  } finally {
    codex.opening = false;
    renderChatRegion();
  }
}

async function openCodexThread(threadId, options = {}) {
  codex.opening = true;
  codex.error = null;
  if (!options.quiet) renderChatRegion();
  try {
    const body = await apiJson('/api/codex/thread/read', jsonRequest({ threadId }));
    codex.activeThread = body.thread;
    localStorage.setItem(THREAD_STORAGE_KEY, body.thread.id);
    const running = [...(body.thread.turns || [])].reverse().find((turn) => turn.status === 'inProgress');
    if (running) codex.runningTurns[body.thread.id] = running.id;
    else delete codex.runningTurns[body.thread.id];
  } catch (error) {
    codex.error = error.message;
  } finally {
    codex.opening = false;
    renderChatRegion();
  }
}

async function newCodexThread() {
  codex.opening = true;
  codex.error = null;
  renderChatRegion();
  try {
    const body = await apiJson('/api/codex/thread/start', jsonRequest({}));
    codex.activeThread = body.thread;
    codex.threads = [body.thread, ...codex.threads.filter((thread) => thread.id !== body.thread.id)];
    localStorage.setItem(THREAD_STORAGE_KEY, body.thread.id);
    return body.thread;
  } catch (error) {
    codex.error = error.message;
    return null;
  } finally {
    codex.opening = false;
    renderChatRegion();
  }
}

async function sendCodexMessage(explicitText = null) {
  const text = String(explicitText ?? codex.draft).trim();
  if (!text || codex.sending) return;
  codex.sending = true;
  codex.error = null;
  const previousDraft = codex.draft;
  codex.draft = '';
  renderChatRegion();
  try {
    const thread = codex.activeThread || await newCodexThread();
    if (!thread) throw new Error('Could not start a Codex task.');
    const body = await apiJson('/api/codex/turn/start', jsonRequest({ threadId: thread.id, message: text }));
    codex.activeThread = upsertTurn(codex.activeThread || thread, body.turn);
    codex.runningTurns[thread.id] = body.turn.id;
  } catch (error) {
    codex.error = error.message;
    codex.draft = previousDraft || text;
  } finally {
    codex.sending = false;
    renderChatRegion();
  }
}

async function interruptCodexTurn() {
  const threadId = codex.activeThread?.id;
  const turnId = threadId ? codex.runningTurns[threadId] || [...(codex.activeThread.turns || [])].reverse().find((turn) => turn.status === 'inProgress')?.id : null;
  if (!threadId || !turnId) return;
  try {
    await apiJson('/api/codex/turn/interrupt', jsonRequest({ threadId, turnId }));
  } catch (error) {
    codex.error = error.message;
    renderChatRegion();
  }
}

async function resolveApproval(index, decision) {
  const request = codex.pendingRequests[index];
  if (!request) return;
  if (request.method === 'item/permissions/requestApproval') {
    const permissions = Object.fromEntries(Object.entries(request.params.permissions || {}).filter(([, value]) => value !== null));
    const result = decision === 'decline' ? { permissions: {}, scope: 'turn' } : { permissions, scope: decision === 'acceptForSession' ? 'session' : 'turn' };
    await respondToCodexRequest(request, result);
    return;
  }
  await respondToCodexRequest(request, { decision });
}

async function respondToCodexRequest(request, result) {
  try {
    await apiJson('/api/codex/request/respond', jsonRequest({ id: request.id, result }));
    codex.pendingRequests = codex.pendingRequests.filter((candidate) => candidate.id !== request.id);
  } catch (error) {
    codex.error = error.message;
  }
  renderChatRegion();
}

function connectEventStream() {
  eventSource?.close();
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('codex', (event) => {
    try {
      handleCodexEvent(JSON.parse(event.data));
    } catch (error) {
      codex.error = `Could not read a Codex event: ${error.message}`;
      renderChatRegion();
    }
  });
  eventSource.addEventListener('lifeos', () => scheduleStateRefresh());
  eventSource.addEventListener('error', () => {
    if (eventSource.readyState === EventSource.CLOSED) {
      codex.connection = 'disconnected';
      renderChatRegion();
    }
  });
}

function handleCodexEvent(event) {
  if (event.type === 'connection') {
    codex.connection = event.status;
    codex.connectionDetail = event.detail || codex.connectionDetail;
    if (event.status === 'error') codex.error = event.detail || 'Codex connection failed.';
    renderChatRegion();
    return;
  }
  if (event.type === 'serverRequest') {
    if (!codex.pendingRequests.some((request) => request.id === event.request.id)) codex.pendingRequests.push(event.request);
    renderChatRegion();
    return;
  }
  if (event.type !== 'notification') return;
  const { method, params } = event;
  const threadId = typeof params.threadId === 'string' ? params.threadId : null;
  if (method === 'turn/started' && threadId && params.turn) {
    codex.runningTurns[threadId] = params.turn.id;
    if (codex.activeThread?.id === threadId) codex.activeThread = upsertTurn(codex.activeThread, params.turn);
  } else if ((method === 'item/started' || method === 'item/completed') && threadId && params.turnId && params.item) {
    if (codex.activeThread?.id === threadId) codex.activeThread = upsertItem(codex.activeThread, params.turnId, params.item);
  } else if ((method === 'item/agentMessage/delta' || method === 'item/commandExecution/outputDelta') && threadId && params.turnId && params.itemId && typeof params.delta === 'string') {
    if (codex.activeThread?.id === threadId) codex.activeThread = appendItemDelta(codex.activeThread, params.turnId, params.itemId, method === 'item/agentMessage/delta' ? 'text' : 'aggregatedOutput', params.delta);
  } else if (method === 'turn/completed' && threadId && params.turn) {
    delete codex.runningTurns[threadId];
    if (codex.activeThread?.id === threadId) codex.activeThread = upsertTurn(codex.activeThread, params.turn);
    scheduleStateRefresh();
    void refreshThreadsQuietly();
  } else if (method === 'serverRequest/resolved' && params.requestId !== undefined) {
    codex.pendingRequests = codex.pendingRequests.filter((request) => request.id !== params.requestId);
  } else if (method === 'error') {
    codex.error = params.error?.message || 'Codex reported an error.';
  }
  renderChatRegion();
}

async function refreshThreadsQuietly() {
  try {
    const body = await apiJson('/api/codex/bootstrap');
    codex.threads = body.threads || codex.threads;
    renderChatRegion();
  } catch {
    // A completed turn is still visible even if the history refresh briefly fails.
  }
}

function scheduleStateRefresh() {
  clearTimeout(stateRefreshTimer);
  stateRefreshTimer = setTimeout(() => void refreshState(), 100);
}

async function refreshState() {
  try {
    state = await fetchState(activeRange);
    pageError = null;
    recommendationIndex = Math.min(recommendationIndex, Math.max(0, state.recommendations.length - 1));
    render();
  } catch (error) {
    pageError = error.message;
    render();
  }
}

function upsertTurn(thread, turn) {
  const turns = [...(thread.turns || [])];
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  if (index === -1) turns.push(turn);
  else turns[index] = turn;
  return { ...thread, turns };
}

function upsertItem(thread, turnId, item) {
  const turn = (thread.turns || []).find((candidate) => candidate.id === turnId);
  if (!turn) return upsertTurn(thread, { id: turnId, items: [item], status: 'inProgress', error: null });
  const items = [...(turn.items || [])];
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) items.push(item);
  else items[index] = item;
  return upsertTurn(thread, { ...turn, items });
}

function appendItemDelta(thread, turnId, itemId, field, delta) {
  const turn = (thread.turns || []).find((candidate) => candidate.id === turnId);
  const current = turn?.items?.find((candidate) => candidate.id === itemId);
  const item = current
    ? { ...current, [field]: `${String(current[field] || '')}${delta}` }
    : { id: itemId, type: field === 'text' ? 'agentMessage' : 'commandExecution', [field]: delta };
  return upsertItem(thread, turnId, item);
}

function scrollChatToEnd() {
  const scroll = () => {
    const body = document.querySelector('.chat-body');
    if (body) body.scrollTop = body.scrollHeight;
  };
  scroll();
  requestAnimationFrame(() => {
    scroll();
    setTimeout(scroll, 50);
  });
}

function jsonRequest(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function threadTitle(thread) {
  return String(thread.name || thread.preview || 'Untitled LifeOS task').trim();
}

function groupByActivity(entries) {
  return entries.reduce((acc, entry) => {
    acc[entry.activityType] = (acc[entry.activityType] || 0) + entry.durationMinutes;
    return acc;
  }, {});
}

function activityColor(type) {
  const colors = {
    research: state.domains.research.color,
    creative: state.domains.filmmaking.color,
    communication: state.domains.content.color,
    shallow_work: 'var(--ink-faint)',
    admin: 'var(--ink-ghost)',
    deep_work: 'var(--ink)',
  };
  return colors[type] || 'var(--accent)';
}

function cssHealth(health) {
  if (health === 'critical') return 'var(--critical)';
  if (health === 'attention') return 'var(--attention)';
  return 'var(--healthy)';
}

function formatDayTotal(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  return `${hours}h <span style="color:var(--ink-dim)">${mins}</span>`;
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}`;
}

function formatHours(hours) {
  return formatMinutes(Math.round(Number(hours || 0) * 60));
}

function formatDateLong(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date).toUpperCase();
  const day = new Intl.DateTimeFormat('en-GB', { day: '2-digit', timeZone: 'UTC' }).format(date);
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date).toUpperCase();
  return { weekday, rest: `${day} ${month} ${date.getUTCFullYear()}` };
}

function formatMilestoneDate(dateString) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(`${dateString}T12:00:00Z`));
}

function formatClock(isoString) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(isoString));
}

function titleNumber(value) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[value] || String(value);
}

function validTab(value) {
  return VALID_TABS.includes(value) ? value : null;
}

function heatmapColor(value) {
  if (value < 0.04) return '#eee7d6';
  const t = Math.pow(Math.min(1, value), 0.7);
  const r = Math.round(0xee + (0xa4 - 0xee) * t);
  const g = Math.round(0xe7 + (0x4a - 0xe7) * t);
  const b = Math.round(0xd6 + (0x26 - 0xd6) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function stringifyCompact(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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
