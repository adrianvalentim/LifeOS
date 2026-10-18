import { renderMarkdown } from './vendor/creation-markdown.js';

export const CREATION_STATUS_LABELS = { to_do: 'To do', next_up: 'Next up', doing: 'Doing', done: 'Done', dropped: 'Dropped' };
export const creationTypeLabel = type => ({ short: 'Short', long_video: 'Long video' }[type] || type);
const statuses = Object.keys(CREATION_STATUS_LABELS);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const options = (values, selected, labels = {}) => values.map(value => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(labels[value] || value)}</option>`).join('');
const typeValues = ideas => [...new Set(['short', 'long_video', ...ideas.map(idea => idea.type)])];

export function createCreationUiState() {
  return { view: 'kanban', type: 'all', status: 'all', query: '', sort: 'manual', selectedId: null,
    draft: null, dirty: false, saving: false, error: null, preview: false, revision: 0, timer: null, pending: null, adding: false, creating: false, addDraft: null };
}

export function visibleCreationIdeas(ideas, ui) {
  const query = ui.query.trim().toLocaleLowerCase();
  return ideas.filter(idea => (ui.type === 'all' || idea.type === ui.type)
    && (ui.status === 'all' || idea.status === ui.status)
    && (!query || `${idea.title}\n${idea.markdown}`.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      if (ui.sort === 'title') return a.title.localeCompare(b.title);
      if (ui.sort === 'type') return creationTypeLabel(a.type).localeCompare(creationTypeLabel(b.type)) || a.sortOrder - b.sortOrder;
      if (ui.sort === 'date') return (a.date || '9999').localeCompare(b.date || '9999') || a.sortOrder - b.sortOrder;
      if (ui.sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      return a.sortOrder - b.sortOrder;
    });
}

export function renderCreation(creation = { ideas: [] }, ui, tasks = { items: [] }) {
  const ideas = creation.ideas;
  if (ui.selectedId) {
    const current = ideas.find(idea => idea.id === ui.selectedId);
    if (!ui.draft || ui.draft.id !== ui.selectedId || (!ui.dirty && !ui.saving && current && current.updatedAt !== ui.draft.updatedAt)) {
      const saved = ideas.find(idea => idea.id === ui.selectedId);
      if (saved) ui.draft = { ...saved };
    }
    return ui.draft ? renderIdeaPage(ui, ideas, tasks) : `<div class="creation-workspace"><button data-creation-back type="button">← All ideas</button><p>This idea is no longer available.</p></div>`;
  }
  const visible = visibleCreationIdeas(ideas, ui);
  const types = typeValues(ideas);
  return `<section class="creation-workspace">
    <header class="reading-hero creation-hero"><div><span class="smallcaps">Infinitamente</span><h1>Creation</h1></div>
      <div class="reading-totals">${[[ideas.length, 'Ideas'], [ideas.filter(i => i.type === 'short').length, 'Shorts'], [ideas.filter(i => i.type === 'long_video').length, 'Long videos'], [ideas.filter(i => i.status === 'done').length, 'Done']].map(([count, label]) => `<div><b>${count}</b><span>${label}</span></div>`).join('')}</div>
    </header>
    <div class="reading-toolbar creation-toolbar"><div class="reading-view-switch" aria-label="Creation view">${['kanban', 'list'].map(view => `<button class="reading-view-button ${ui.view === view ? 'active' : ''}" data-creation-view="${view}" aria-pressed="${ui.view === view}" type="button">${view === 'kanban' ? 'Kanban' : 'List'}</button>`).join('')}</div>
      <label class="creation-search"><span class="sr-only">Search ideas</span><input data-creation-query data-creation-focus="query" type="search" value="${esc(ui.query)}" placeholder="Search ideas…"></label>
      <label><span class="sr-only">Sort ideas</span><select data-creation-sort aria-label="Sort ideas">${options(['manual', 'title', 'type', 'date', 'updated'], ui.sort, { manual: 'Idea order', title: 'Title A–Z', type: 'Type', date: 'Date · earliest', updated: 'Last edited' })}</select></label>
      <button class="reading-add-button" data-creation-add type="button">+ New idea</button>
    </div>
    <div class="creation-filters"><div class="creation-types" aria-label="Filter by type"><button data-creation-type="all" class="${ui.type === 'all' ? 'active' : ''}" aria-pressed="${ui.type === 'all'}" type="button">All types <b>${ideas.length}</b></button>${types.map(type => `<button data-creation-type="${esc(type)}" class="${ui.type === type ? 'active' : ''}" aria-pressed="${ui.type === type}" type="button">${esc(type === 'short' ? 'Shorts' : type === 'long_video' ? 'Long videos' : type)} <b>${ideas.filter(i => i.type === type).length}</b></button>`).join('')}</div>
      <select data-creation-status-filter aria-label="Filter by status">${options(['all', ...statuses], ui.status, { all: 'All statuses', ...CREATION_STATUS_LABELS })}</select><span class="smallcaps">${visible.length} shown</span>
    </div>
    ${ui.error ? `<p class="creation-error" role="alert">${esc(ui.error)}</p>` : ''}
    ${ui.adding ? renderAdd(ui, ideas) : ''}
    ${ui.view === 'kanban' ? `<div class="creation-board">${statuses.map(status => `<section class="creation-column status-${status}" data-creation-drop="${status}" aria-label="${CREATION_STATUS_LABELS[status]}"><header><span>${CREATION_STATUS_LABELS[status]}</span><b>${visible.filter(i => i.status === status).length}</b></header><div class="creation-column-body">${visible.filter(i => i.status === status).map(renderCard).join('') || '<p class="creation-empty-lane">No ideas here yet</p>'}</div><button data-creation-add="${status}" type="button" class="creation-lane-add">+ Add idea</button></section>`).join('')}</div>` : renderList(visible)}
    ${!ideas.length ? '<p class="creation-hint">A place for your next question, story, or spark. Add your first idea to begin.</p>' : '<p class="creation-hint">Double-click an idea to open its page. Drag cards between columns, or use their status menu.</p>'}
  </section>`;
}

function renderAdd(ui, ideas) {
  const draft = ui.addDraft || {};
  return `<form data-creation-create class="creation-add-form"><label>Idea<input name="title" data-creation-focus="new-title" placeholder="What are you curious about?" maxlength="300" required value="${esc(draft.title || '')}"></label><label>Type<input name="type" list="creation-types" maxlength="40" required value="${esc(draft.type || 'Short')}"></label>${typeDatalist(ideas)}<label>Status<select name="status">${options(statuses, draft.status || 'to_do', CREATION_STATUS_LABELS)}</select></label><label>Date<input name="date" type="date" value="${esc(draft.date || '')}"></label><button type="submit" ${ui.creating ? 'disabled' : ''}>${ui.creating ? 'Adding…' : 'Add idea'}</button><button data-creation-cancel-add type="button">Cancel</button><small>A dated Short also appears in Tasks.</small></form>`;
}
function typeDatalist(ideas) { return `<datalist id="creation-types">${typeValues(ideas).map(type => `<option value="${esc(creationTypeLabel(type))}"></option>`).join('')}</datalist>`; }
function renderCard(idea) {
  return `<article class="creation-card" data-creation-open="${esc(idea.id)}" draggable="true" tabindex="0" aria-label="${esc(idea.title)}, ${esc(creationTypeLabel(idea.type))}. Double-click or press Enter to open."><span class="creation-type">${esc(creationTypeLabel(idea.type))}</span><h2>${esc(idea.title)}</h2>${idea.markdown ? `<p>${esc(idea.markdown.replace(/[#*_\x60>\[\]]/g, '').slice(0, 130))}</p>` : ''}<footer>${idea.date ? `<time datetime="${esc(idea.date)}">${esc(formatDate(idea.date))}</time>` : '<span>No date</span>'}<select data-creation-status="${esc(idea.id)}" aria-label="Status for ${esc(idea.title)}">${options(statuses, idea.status, CREATION_STATUS_LABELS)}</select></footer></article>`;
}
function renderList(ideas) {
  return `<div class="creation-list-wrap"><table class="creation-list"><thead><tr><th>Idea</th><th>Type</th><th>Status</th><th>Date</th><th><span class="sr-only">Open</span></th></tr></thead><tbody>${ideas.map(idea => `<tr data-creation-open="${esc(idea.id)}" tabindex="0"><td><strong>${esc(idea.title)}</strong></td><td><span class="creation-type">${esc(creationTypeLabel(idea.type))}</span></td><td><select data-creation-status="${esc(idea.id)}" aria-label="Status for ${esc(idea.title)}">${options(statuses, idea.status, CREATION_STATUS_LABELS)}</select></td><td>${idea.date ? esc(formatDate(idea.date)) : '—'}</td><td><button data-creation-page="${esc(idea.id)}" aria-label="Open ${esc(idea.title)}" type="button">↗</button></td></tr>`).join('') || '<tr><td colspan="5" class="creation-empty-lane">No ideas match these filters.</td></tr>'}</tbody></table></div>`;
}
const toolbar = [['heading', 'H2', 'Heading'], ['bold', 'B', 'Bold · ⌘B'], ['italic', 'I', 'Italic · ⌘I'], ['strike', 'S̶', 'Strikethrough'], ['quote', '❞', 'Quote'], ['bullet', '•', 'Bullet list'], ['number', '1.', 'Numbered list'], ['check', '☑', 'Checklist'], ['link', '↗', 'Link · ⌘K'], ['image', '▧', 'Image'], ['code', '</>', 'Inline code'], ['block', '{ }', 'Code block'], ['table', '▦', 'Table'], ['rule', '—', 'Divider']];
function renderIdeaPage(ui, ideas, tasks) {
  const idea = ui.draft;
  const task = tasks.items.find(item => item.id === idea.taskId);
  const linked = task && !task.trashedAt;
  return `<section class="creation-workspace creation-idea-page"><header class="creation-page-bar"><button data-creation-back type="button">← All ideas</button><span class="smallcaps">Infinitamente / ${esc(creationTypeLabel(idea.type))}</span><span class="grow"></span><span data-creation-save-state role="status">${ui.saving ? 'Saving…' : ui.error ? 'Not saved' : ui.dirty ? 'Unsaved changes' : 'All changes saved'}</span><button data-creation-save type="button" ${ui.saving ? 'disabled' : ''}>Save</button></header>
    ${ui.error ? `<div class="creation-error" role="alert">${esc(ui.error)} <button data-creation-reload type="button">Reload saved version</button><button data-creation-download type="button">Download draft</button></div>` : ''}
    <div class="creation-document"><input class="creation-title" data-creation-field="title" data-creation-focus="title" aria-label="Idea title" placeholder="Untitled idea" maxlength="300" value="${esc(idea.title)}">
    <div class="creation-properties"><label>Status<select data-creation-field="status">${options(statuses, idea.status, CREATION_STATUS_LABELS)}</select></label><label>Type<input data-creation-field="type" list="creation-types" maxlength="40" value="${esc(creationTypeLabel(idea.type))}" aria-label="Idea type"></label>${typeDatalist(ideas)}<label>Date<input data-creation-field="date" type="date" value="${esc(idea.date || '')}"></label></div>
    <div class="creation-task-note">${linked ? `<button data-creation-task="${esc(task.id)}" type="button">↗ ${task.status === 'completed' ? 'Completed task' : 'Open linked task'} · ${esc(task.schedule.dueDate || 'No date')}</button>` : idea.type === 'short' ? 'Add a date to include this short in Tasks.' : 'Dates on long videos and other types stay in Creation.'}</div>
    <div class="creation-editor-bar"><div class="creation-formatting" role="toolbar" aria-label="Markdown formatting">${toolbar.map(([id, label, title]) => `<button data-creation-format="${id}" title="${title}" aria-label="${title}" type="button" ${ui.preview ? 'disabled' : ''}>${label}</button>`).join('')}</div><button data-creation-preview type="button" aria-pressed="${ui.preview}">${ui.preview ? 'Edit Markdown' : 'Preview'}</button></div>
    ${ui.preview ? `<article class="creation-markdown" data-creation-preview-body>${renderMarkdown(idea.markdown) || '<p class="creation-hint">Your story starts here.</p>'}</article>` : `<textarea class="creation-editor" data-creation-field="markdown" data-creation-focus="markdown" aria-label="Idea Markdown" spellcheck="true" maxlength="200000" placeholder="Write your idea, outline, research, or script…&#10;&#10;Markdown supports headings, lists, checkboxes, links, images, tables, and code.">${esc(idea.markdown)}</textarea>`}
    <footer class="creation-document-footer"><span>Markdown</span><span>${idea.markdown.trim() ? idea.markdown.trim().split(/\s+/u).length : 0} words</span><span>⌘S to save</span></footer></div></section>`;
}
function formatDate(value) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)); }

export function formatMarkdownSelection(value, start, end, command) {
  const selection = value.slice(start, end);
  const pairs = { bold: ['**', '**', 'bold text'], italic: ['*', '*', 'italic text'], strike: ['~~', '~~', 'text'], code: ['`', '`', 'code'], link: ['[', '](https://)', 'link text'], image: ['![', '](https://)', 'description'] };
  let before, after, text;
  if (pairs[command]) [before, after, text] = pairs[command];
  else {
    const prefix = { heading: '## ', quote: '> ', bullet: '- ', number: '1. ', check: '- [ ] ' }[command];
    before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    after = '\n';
    text = prefix ? (selection || 'text').split('\n').map((line, i) => `${command === 'number' ? `${i + 1}. ` : prefix}${line}`).join('\n')
      : command === 'block' ? `\x60\x60\x60\n${selection || 'code'}\n\x60\x60\x60`
      : command === 'table' ? '| Column | Column |\n| --- | --- |\n| Text | Text |'
      : '---';
  }
  const content = pairs[command] ? selection || text : text;
  return { value: value.slice(0, start) + before + content + after + value.slice(end), start: start + before.length, end: start + before.length + content.length };
}

export function createCreationController({ getState, setState, render, request, fetchState, updateLocation, openTask }) {
  const ui = createCreationUiState();
  try {
    const saved = JSON.parse(localStorage.getItem('lifeos.creation.preferences') || '{}');
    for (const key of ['view', 'type', 'status', 'sort']) if (typeof saved[key] === 'string') ui[key] = saved[key];
    if (!['kanban', 'list'].includes(ui.view)) ui.view = 'kanban';
    if (!['manual', 'title', 'type', 'date', 'updated'].includes(ui.sort)) ui.sort = 'manual';
    if (!['all', ...statuses].includes(ui.status)) ui.status = 'all';
  } catch { /* Defaults also work when browser storage is unavailable. */ }
  const persist = () => {
    try { localStorage.setItem('lifeos.creation.preferences', JSON.stringify({ view: ui.view, type: ui.type, status: ui.status, sort: ui.sort })); } catch { /* Optional preference. */ }
  };
  const saveLabel = () => {
    const label = document.querySelector('[data-creation-save-state]');
    if (label) label.textContent = ui.saving ? 'Saving…' : ui.error ? 'Not saved' : ui.dirty ? 'Unsaved changes' : 'All changes saved';
  };
  function save() {
    clearTimeout(ui.timer);
    if (ui.pending) return ui.pending;
    if (!ui.dirty || !ui.draft) return Promise.resolve(true);
    ui.saving = true; ui.error = null; saveLabel();
    ui.pending = (async () => {
      // One writer drains edits made while a save is in flight. A later input or
      // explicit Save joins this promise rather than racing the conflict token.
      while (ui.dirty) {
        const draft = { ...ui.draft }, revision = ui.revision;
        try {
          const response = await request('/api/creation/update', { ideaId: draft.id, expectedUpdatedAt: draft.updatedAt,
            title: draft.title, type: draft.type, status: draft.status, date: draft.date, markdown: draft.markdown });
          setState(response.state);
          if (ui.revision === revision) { ui.draft = { ...response.idea }; ui.dirty = false; }
          else { ui.draft.updatedAt = response.idea.updatedAt; ui.draft.taskId = response.idea.taskId; }
        } catch (error) { ui.error = error.message; return false; }
      }
      return true;
    })().finally(() => { ui.pending = null; ui.saving = false; clearTimeout(ui.timer); render(); });
    return ui.pending;
  }
  function changed(field, value) {
    ui.draft[field] = field === 'date' ? value || null : value;
    ui.dirty = true; ui.revision++; ui.error = null;
    clearTimeout(ui.timer); ui.timer = setTimeout(() => void save(), 900);
    saveLabel();
    const count = document.querySelector('.creation-document-footer span:nth-child(2)');
    if (count) count.textContent = `${ui.draft.markdown.trim() ? ui.draft.markdown.trim().split(/\s+/u).length : 0} words`;
  }
  async function open(id) {
    if (!(await save())) return;
    ui.selectedId = id; ui.draft = null; ui.error = null; ui.preview = false;
    updateLocation(); render();
    document.querySelector('[data-creation-field="markdown"]')?.focus();
  }
  async function move(id, status) {
    if (ui.saving) return;
    const idea = getState().creation.ideas.find(item => item.id === id);
    if (!idea || idea.status === status) return;
    try {
      const response = await request('/api/creation/update', { ideaId: id, expectedUpdatedAt: idea.updatedAt, status });
      setState(response.state); ui.error = null;
    } catch (error) { ui.error = error.message; }
    render();
  }
  function format(command) {
    const editor = document.querySelector('[data-creation-field="markdown"]');
    if (!editor) return;
    const formatted = formatMarkdownSelection(editor.value, editor.selectionStart, editor.selectionEnd, command);
    editor.focus();
    // insertText participates in the native undo stack in desktop WebKit/Chromium.
    editor.setSelectionRange(0, editor.value.length);
    if (!document.execCommand('insertText', false, formatted.value)) editor.value = formatted.value;
    editor.setSelectionRange(formatted.start, formatted.end);
    changed('markdown', editor.value);
  }
  function bind() {
    document.querySelectorAll('[data-creation-view]').forEach(button => button.addEventListener('click', () => { ui.view = button.dataset.creationView; persist(); updateLocation(); render(); }));
    document.querySelectorAll('[data-creation-type]').forEach(button => button.addEventListener('click', () => { ui.type = button.dataset.creationType; persist(); render(); }));
    document.querySelector('[data-creation-query]')?.addEventListener('input', event => { ui.query = event.target.value; render(); });
    for (const [selector, key] of [['[data-creation-sort]', 'sort'], ['[data-creation-status-filter]', 'status']]) {
      document.querySelector(selector)?.addEventListener('change', event => { ui[key] = event.target.value; persist(); render(); });
    }
    document.querySelectorAll('[data-creation-add]').forEach(button => button.addEventListener('click', () => {
      ui.adding = true; ui.error = null; ui.addDraft = { id: crypto.randomUUID(), title: '', type: creationTypeLabel(ui.type === 'all' ? 'short' : ui.type), status: button.dataset.creationAdd || 'to_do', date: '' };
      render(); document.querySelector('[name="title"]')?.focus();
    }));
    document.querySelector('[data-creation-cancel-add]')?.addEventListener('click', () => { ui.adding = false; ui.addDraft = null; render(); });
    const form = document.querySelector('[data-creation-create]');
    form?.addEventListener('input', () => { ui.addDraft = { ...ui.addDraft, ...Object.fromEntries(new FormData(form)) }; });
    form?.addEventListener('submit', async event => {
      event.preventDefault(); if (ui.creating) return;
      ui.creating = true; ui.addDraft = { ...ui.addDraft, ...Object.fromEntries(new FormData(form)) }; render();
      try {
        const response = await request('/api/creation/create', ui.addDraft);
        setState(response.state); ui.adding = false; ui.addDraft = null; ui.error = null;
        ui.selectedId = response.idea.id; ui.draft = { ...response.idea }; updateLocation();
      } catch (error) { ui.error = error.message; }
      finally { ui.creating = false; render(); }
      document.querySelector('[data-creation-field="markdown"]')?.focus();
    });
    document.querySelectorAll('[data-creation-open]').forEach(card => {
      card.addEventListener('dblclick', event => { if (!event.target.closest('button,select')) void open(card.dataset.creationOpen); });
      card.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target === card) { event.preventDefault(); void open(card.dataset.creationOpen); } });
      card.addEventListener('dragstart', event => { if (event.target.closest('select,button')) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-lifeos-idea', card.dataset.creationOpen); event.dataTransfer.effectAllowed = 'move'; });
    });
    document.querySelectorAll('[data-creation-page]').forEach(button => button.addEventListener('click', () => void open(button.dataset.creationPage)));
    document.querySelectorAll('[data-creation-status]').forEach(select => select.addEventListener('change', () => void move(select.dataset.creationStatus, select.value)));
    document.querySelectorAll('[data-creation-drop]').forEach(column => {
      column.addEventListener('dragover', event => { if (!event.dataTransfer.types.includes('application/x-lifeos-idea')) return; event.preventDefault(); column.classList.add('is-drop-target'); event.dataTransfer.dropEffect = 'move'; });
      column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('is-drop-target'); });
      column.addEventListener('drop', event => { event.preventDefault(); column.classList.remove('is-drop-target'); void move(event.dataTransfer.getData('application/x-lifeos-idea'), column.dataset.creationDrop); });
    });
    document.querySelector('[data-creation-back]')?.addEventListener('click', async () => { if (!(await save())) return; ui.selectedId = null; ui.draft = null; ui.preview = false; updateLocation(); render(); });
    document.querySelectorAll('[data-creation-field]').forEach(field => {
      field.addEventListener(field.matches('select,input[type="date"]') ? 'change' : 'input', () => changed(field.dataset.creationField, field.value));
    });
    document.querySelector('[data-creation-save]')?.addEventListener('click', () => void save());
    document.querySelector('[data-creation-preview]')?.addEventListener('click', () => { ui.preview = !ui.preview; render(); });
    document.querySelectorAll('[data-creation-format]').forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => format(button.dataset.creationFormat));
    });
    document.querySelector('[data-creation-reload]')?.addEventListener('click', async () => {
      if (ui.dirty && !window.confirm('Replace your unsaved draft with the saved version? Download the draft first if you want to keep it.')) return;
      try {
        const latest = await fetchState(); setState(latest);
        ui.draft = { ...latest.creation.ideas.find(idea => idea.id === ui.selectedId) }; ui.dirty = false; ui.error = null; clearTimeout(ui.timer);
      } catch (error) { ui.error = error.message; }
      render();
    });
    document.querySelector('[data-creation-download]')?.addEventListener('click', () => {
      const blob = new Blob([`# ${ui.draft.title}\n\n${ui.draft.markdown}`], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'creation-draft.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.querySelector('[data-creation-task]')?.addEventListener('click', async event => { const id = event.currentTarget.dataset.creationTask; if (await save()) openTask(id); });
    document.querySelector('.creation-idea-page')?.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return; }
      if (event.target.matches('[data-creation-field="markdown"]')) {
        const command = { b: 'bold', i: 'italic', k: 'link' }[event.key.toLowerCase()];
        if (command) { event.preventDefault(); event.stopPropagation(); format(command); }
      }
    });
    document.querySelectorAll('.creation-markdown a').forEach(link => { link.target = '_blank'; link.rel = 'noopener noreferrer'; });
  }
  window.addEventListener('beforeunload', event => { if (ui.dirty || ui.saving || ui.creating) { event.preventDefault(); event.returnValue = ''; } });
  function captureFocus() {
    const field = document.activeElement;
    if (!document.querySelector('.creation-workspace')) return null;
    const key = field?.closest('.creation-workspace') && (field.dataset.creationFocus || field.dataset.creationField || field.name);
    return { key, start: field?.selectionStart, end: field?.selectionEnd, scroll: field?.scrollTop,
      pageScroll: document.querySelector('.page')?.scrollTop || 0 };
  }
  function restoreFocus(focus) {
    if (!focus) return;
    const field = focus.key ? [...document.querySelectorAll('.creation-workspace input,.creation-workspace textarea,.creation-workspace select')].find(item => (item.dataset.creationFocus || item.dataset.creationField || item.name) === focus.key) : null;
    field?.focus({ preventScroll: true });
    if (field && typeof focus.start === 'number') field.setSelectionRange(focus.start, focus.end);
    if (field) field.scrollTop = focus.scroll;
    const page = document.querySelector('.page[data-view="creation"]');
    if (page) page.scrollTop = focus.pageScroll;
  }
  return { ui, bind, save, captureFocus, restoreFocus,
    readLocation(params) { ui.selectedId = params.get('idea'); if (params.has('creationView')) ui.view = params.get('creationView') === 'list' ? 'list' : 'kanban'; },
    writeLocation(params) { if (ui.selectedId) params.set('idea', ui.selectedId); if (ui.view !== 'kanban') params.set('creationView', ui.view); },
  };
}
