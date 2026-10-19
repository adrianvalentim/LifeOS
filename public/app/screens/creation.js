import * as act from '../actions.js';
import { agentName, attachContext } from '../agent-context.js';
import { postJson, run } from '../api.js';
import { cx, html } from '../dom.js';
import { formatDate, IDEA_STATUS, ideaTypeLabel, normalize, plural, relativeDay, timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { ideaMenu } from '../menus.js';
import { navigate } from '../router.js';
import { lookup, render, setPref, setState, store } from '../store.js';
import { beginDrag } from '../ui/dnd.js';
import { confirmDialog, formDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { pickDate, pickFromList } from '../ui/pickers.js';

const STATUSES = Object.keys(IDEA_STATUS);
const SORTS = { manual: 'Board order', title: 'Title', type: 'Type', date: 'Date', updated: 'Last edited' };

export function visibleIdeas() {
  const prefs = store.prefs.creation;
  const needle = normalize(store.ui.filter);
  return store.state.creation.ideas
    .filter((idea) => (prefs.type === 'all' || idea.type === prefs.type) && (prefs.status === 'all' || idea.status === prefs.status) && (!needle || normalize(`${idea.title} ${idea.markdown}`).includes(needle)))
    .sort((a, b) => {
      if (prefs.sort === 'title') return a.title.localeCompare(b.title);
      if (prefs.sort === 'type') return ideaTypeLabel(a.type).localeCompare(ideaTypeLabel(b.type)) || a.sortOrder - b.sortOrder;
      if (prefs.sort === 'date') return (a.date || '9999').localeCompare(b.date || '9999') || a.sortOrder - b.sortOrder;
      if (prefs.sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      return a.sortOrder - b.sortOrder;
    });
}

export function render_() {
  if (store.ui.route.id) return renderEditor(store.ui.route.id);
  const state = store.state;
  const prefs = store.prefs.creation;
  const ideas = state.creation.ideas;
  const types = [...new Set(['short', 'long_video', ...ideas.map((idea) => idea.type)])];
  const visible = visibleIdeas();
  const view = store.ui.route.params.get('view') === 'list' ? 'list' : store.ui.route.params.get('view') === 'board' ? 'board' : prefs.view;
  return html`<div class="${cx('screen creation-screen scroll-y', ideas.length && view === 'board' && 'has-board')}">
    <header class="page-head wide">
      <div class="page-title"><div><h1 class="display-sm">Creation</h1><p>${plural(ideas.length, 'idea')} · ${ideas.filter((idea) => idea.status === 'doing').length} in progress · ${ideas.filter((idea) => idea.status === 'done').length} done</p></div></div>
      <div class="page-tools">
        <label class="filter-field">${icon('search', { size: 14 })}<input type="search" placeholder="Search ideas" value="${store.ui.filter}" data-page-filter aria-label="Search ideas"><kbd>/</kbd></label>
        <button type="button" class="button ghost small" data-action="creation-sort">${icon('sort', { size: 14 })}${SORTS[prefs.sort] || 'Board order'}</button>
        <div class="segmented icons" role="group" aria-label="Layout">
          <button type="button" class="${view === 'board' ? 'is-active' : ''}" data-action="creation-view" data-view="board" title="Board" aria-label="Board">${icon('board', { size: 15 })}</button>
          <button type="button" class="${view === 'list' ? 'is-active' : ''}" data-action="creation-view" data-view="list" title="List" aria-label="List">${icon('table', { size: 15 })}</button>
        </div>
        <button type="button" class="button is-primary small" data-action="creation-new">${icon('plus', { size: 14 })}New idea</button>
      </div>
    </header>
    <div class="chip-row" role="group" aria-label="Filter by type">
      <button type="button" class="${cx('filter-chip', prefs.type === 'all' && 'is-active')}" data-action="creation-type" data-type="all">All <b>${ideas.length}</b></button>
      ${types.map((type) => html`<button type="button" class="${cx('filter-chip', prefs.type === type && 'is-active')}" data-action="creation-type" data-type="${type}">${type === 'short' ? 'Shorts' : type === 'long_video' ? 'Long videos' : type} <b>${ideas.filter((idea) => idea.type === type).length}</b></button>`)}
      ${view === 'list' ? html`<span class="grow"></span><select class="select-small" data-creation-status aria-label="Status"><option value="all">All statuses</option>${STATUSES.map((status) => html`<option value="${status}" ${prefs.status === status ? 'selected' : ''}>${IDEA_STATUS[status]}</option>`)}</select>` : ''}
    </div>
    ${!ideas.length
      ? html`<div class="list-empty"><div class="empty-mark fleuron" aria-hidden="true">❦</div><h3>A place for your next question, story or spark</h3><p>Capture ideas as Shorts or long videos, move them from To do to Done, and write the script right here. A dated Short also appears in Tasks.</p><button type="button" class="button is-primary small" data-action="creation-new">${icon('plus', { size: 14 })}New idea <kbd>N</kbd></button></div>`
      : view === 'list' ? renderList(visible) : renderBoard(visible)}
  </div>`;
}

function renderBoard(ideas) {
  return html`<div class="idea-board">${STATUSES.map((status) => {
    const column = ideas.filter((idea) => idea.status === status);
    return html`<section class="board-column idea-column status-${status}" data-key="ic-${status}" data-idea-drop="${status}">
      <header class="board-head"><span>${IDEA_STATUS[status]}</span><b>${column.length}</b></header>
      <div class="board-cards">${column.map(renderCard)}</div>
      ${store.ui.addingIdeaIn === status
        ? html`<input class="idea-inline-add" data-idea-add="${status}" placeholder="Idea title — Enter to add" maxlength="300" autocomplete="off">`
        : html`<button type="button" class="board-add" data-action="creation-add-in" data-status="${status}">${icon('plus', { size: 13 })}Add idea</button>`}
    </section>`;
  })}</div>`;
}

function excerpt(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\[\]()!|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function renderCard(idea) {
  const today = store.state.meta.today;
  const task = idea.taskId ? lookup.task(idea.taskId) : null;
  const words = idea.markdown.trim() ? idea.markdown.trim().split(/\s+/u).length : 0;
  return html`<article class="idea-card" data-key="idea-${idea.id}" data-idea="${idea.id}" data-draggable="idea" tabindex="0">
    <header><span class="type-badge type-${normalize(idea.type).replace(/ /g, '-')}">${ideaTypeLabel(idea.type)}</span><button type="button" class="row-more" data-action="idea-menu" aria-label="Actions for ${idea.title}">${icon('more', { size: 14 })}</button></header>
    <a class="idea-title" href="/creation/${encodeURIComponent(idea.id)}">${idea.title}</a>
    ${idea.markdown ? html`<p class="idea-excerpt">${excerpt(idea.markdown)}</p>` : ''}
    <footer>
      ${idea.date ? html`<span class="pill ${idea.date < today && !['done', 'dropped'].includes(idea.status) ? 'overdue' : ''}">${icon('calendar', { size: 11 })}${relativeDay(idea.date, today)}</span>` : ''}
      ${task && !task.trashedAt ? html`<span class="pill" title="Linked task ${task.status}">${icon(task.status === 'completed' ? 'check' : 'tasks', { size: 11 })}task</span>` : ''}
      <span class="grow"></span>${words ? html`<span class="muted">${words}w</span>` : ''}
    </footer>
  </article>`;
}

function renderList(ideas) {
  const today = store.state.meta.today;
  if (!ideas.length) return html`<p class="card-empty">No ideas match.</p>`;
  return html`<div class="card table-card"><table class="data-table">
    <thead><tr><th>Idea</th><th>Type</th><th>Status</th><th>Date</th><th>Edited</th><th></th></tr></thead>
    <tbody>${ideas.map((idea) => html`<tr data-key="ir-${idea.id}" data-idea="${idea.id}">
      <td><a class="table-title" href="/creation/${encodeURIComponent(idea.id)}">${idea.title}</a></td>
      <td><span class="type-badge">${ideaTypeLabel(idea.type)}</span></td>
      <td><button type="button" class="status-pill small status-${idea.status}" data-action="idea-status">${IDEA_STATUS[idea.status]}</button></td>
      <td>${idea.date ? formatDate(idea.date, { today }) : html`<span class="muted">—</span>`}</td>
      <td class="muted">${timeAgo(idea.updatedAt)}</td>
      <td><button type="button" class="row-more" data-action="idea-menu" aria-label="Actions">${icon('more', { size: 14 })}</button></td>
    </tr>`)}</tbody></table></div>`;
}

// ——— Editor ——————————————————————————————————————————————————————————————
const TOOLBAR = [
  ['heading', 'heading', 'Heading'], ['bold', 'bold', 'Bold ⌘B'], ['italic', 'italic', 'Italic ⌘I'], ['strike', 'strike', 'Strikethrough'],
  ['quote', 'quote', 'Quote'], ['bullet', 'list', 'Bulleted list'], ['number', 'numbered', 'Numbered list'], ['check', 'checklist', 'Checklist'],
  ['link', 'link', 'Link ⌘K'], ['image', 'image', 'Image'], ['code', 'code', 'Code'], ['block', 'terminal', 'Code block'], ['table', 'table', 'Table'], ['rule', 'divider', 'Divider'],
];

function editorState(id) {
  const idea = lookup.idea(id);
  let editor = store.ui.idea;
  if (!idea) return null;
  if (!editor || editor.id !== id) {
    editor = store.ui.idea = { id, draft: pick(idea), base: idea.updatedAt, dirty: false, saving: false, error: null, revision: 0, pending: null, timer: 0 };
  } else if (!editor.dirty && !editor.saving && idea.updatedAt !== editor.base) {
    editor.draft = pick(idea);
    editor.base = idea.updatedAt;
  }
  return editor;
}

const pick = (idea) => ({ title: idea.title, markdown: idea.markdown, type: idea.type, status: idea.status, date: idea.date });

// ——— The visual editor ———————————————————————————————————————————————————
// Notion-style: the Markdown is rendered where you type it (bold shows bold, a
// "# " becomes a heading) and the idea still stores plain Markdown. The editor
// bundle loads on first use; an idea it could not show faithfully (raw HTML,
// loose lists…) opens as Markdown instead, so no text is ever rewritten.
const PLACEHOLDER = 'Write your idea, outline, research or script…  Type # for a heading, - for a list, [] for a checklist.';
let visual = null; // { id, host, controller, markdown }: the live editor and the Markdown it last held
let opening = null;

const editorMode = (editor) => (editor.sourceOnly || store.prefs.creation.editorMode === 'source' ? 'source' : 'visual');

function releaseVisual() {
  if (!visual) return;
  visual.controller.destroy();
  visual.host.replaceChildren(); // the host can outlive the editor (morphing keeps it between ideas)
  visual = null;
}

// Runs after every paint (see main.js): opens, keeps in step, or closes the editor.
export function mount() {
  fitTitle();
  const host = document.querySelector('.editor-visual');
  const editor = store.ui.route.id ? store.ui.idea : null;
  if (!host || !editor || editor.id !== store.ui.route.id) { releaseVisual(); return; }
  if (visual && (visual.host !== host || visual.id !== editor.id)) releaseVisual();
  if (!visual) { void openVisual(editor, host); return; }
  // The saved text changed under a clean editor (an agent edit, or Load saved version).
  if (editor.draft.markdown !== visual.markdown && !editor.dirty && !editor.saving) {
    visual.markdown = editor.draft.markdown;
    visual.controller.setMarkdown(editor.draft.markdown);
  }
  syncToolbar();
}

// The title is a textarea that grows with its text (a render resets the inline height).
function fitTitle() {
  const title = document.querySelector('.editor-title');
  if (!title) return;
  title.style.height = 'auto';
  title.style.height = `${title.scrollHeight}px`;
}

async function openVisual(editor, host) {
  if (opening === host) return;
  opening = host;
  try {
    const { createEditor } = await import('../../vendor/creation-editor.js');
    // The screen may have moved on while the bundle loaded.
    if (!host.isConnected || store.ui.idea?.id !== editor.id || visual) return;
    const markdown = store.ui.idea.draft.markdown;
    const controller = createEditor(host, { markdown, placeholder: PLACEHOLDER, onChange: onVisualChange, onSelection: syncToolbar, onLink: askLink });
    if (!controller.faithful) {
      controller.destroy();
      store.ui.idea.sourceOnly = true;
      render();
      return;
    }
    visual = { id: editor.id, host, controller, markdown };
    syncToolbar();
  } catch (error) {
    // Without the editor the Markdown is still editable as text.
    editor.sourceOnly = true;
    console.error(error);
    render();
  } finally {
    opening = null;
  }
}

function onVisualChange(markdown) {
  const editor = store.ui.idea;
  if (!editor || !visual || editor.id !== visual.id) return;
  visual.markdown = markdown;
  editor.draft.markdown = markdown;
  markEdited(editor);
}

function syncToolbar() {
  if (!visual) return;
  for (const button of document.querySelectorAll('.format-bar [data-format]')) button.classList.toggle('is-active', visual.controller.isActive(button.dataset.format));
}

const webAddress = (value) => {
  const address = String(value || '').trim();
  return address && !/^[a-z][a-z0-9+.-]*:/i.test(address) ? `https://${address}` : address;
};

async function askLink() {
  const controller = visual?.controller;
  if (!controller) return;
  const current = controller.currentLink();
  const values = await formDialog({
    title: current ? 'Edit link' : 'Add link',
    description: current ? 'Clear the address to remove the link.' : '',
    fields: [{ name: 'url', label: 'Address', type: 'text', value: current, placeholder: 'https://', autofocus: true }],
    submitLabel: current ? 'Update' : 'Add link',
  });
  if (values) controller.setLink(webAddress(values.url));
  else controller.focus();
}

async function askImage() {
  const controller = visual?.controller;
  if (!controller) return;
  const values = await formDialog({
    title: 'Add image',
    fields: [
      { name: 'url', label: 'Image address', type: 'text', placeholder: 'https://', required: true, autofocus: true },
      { name: 'alt', label: 'Description', type: 'text', placeholder: 'What the image shows' },
    ],
    submitLabel: 'Add image',
  });
  if (values) controller.insertImage(webAddress(values.url), values.alt || '');
  else controller.focus();
}

// A toolbar press must not take focus from the writing (or drop its selection).
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (event) => { if (event.target.closest?.('.format-bar')) event.preventDefault(); });
}

function renderEditor(id) {
  const idea = lookup.idea(id);
  const editor = editorState(id);
  if (!idea || !editor) return html`<div class="screen-empty">${icon('creation', { size: 22 })}<h2>Idea not found</h2><p>It may have been deleted.</p><a class="button" href="/creation">All ideas</a></div>`;
  const today = store.state.meta.today;
  const draft = editor.draft;
  const mode = editorMode(editor);
  const words = draft.markdown.trim() ? draft.markdown.trim().split(/\s+/u).length : 0;
  const task = idea.taskId ? lookup.task(idea.taskId) : null;
  const status = editor.saving ? 'Saving…' : editor.error ? 'Not saved' : editor.dirty ? 'Edited' : 'Saved';
  return html`<div class="screen idea-editor mode-${mode}">
    <header class="editor-bar">
      <a class="crumb-back" href="/creation">${icon('chevron-left', { size: 14 })}Creation</a>
      <span class="save-state ${editor.error ? 'is-error' : editor.dirty || editor.saving ? 'is-busy' : ''}" role="status">${status}</span>
      <span class="grow"></span>
      <div class="segmented" role="group" aria-label="Editor mode">
        <button type="button" class="${mode === 'visual' ? 'is-active' : ''}" data-action="editor-mode" data-mode="visual" ${editor.sourceOnly ? html`disabled title="This idea uses Markdown the visual editor cannot show faithfully"` : html`title="Write with the formatting shown as you type"`}>Write</button>
        <button type="button" class="${mode === 'source' ? 'is-active' : ''}" data-action="editor-mode" data-mode="source" title="Edit the Markdown itself">Markdown</button>
      </div>
      <button type="button" class="icon-button" data-action="editor-codex" title="Ask ${agentName()} about this idea">${icon('sparkle', { size: 16 })}</button>
      <button type="button" class="icon-button" data-action="editor-menu" aria-label="More">${icon('more', { size: 16 })}</button>
    </header>
    ${editor.error ? html`<div class="editor-error" role="alert">${icon('warning', { size: 14 })}<span>${editor.error}</span><button type="button" class="button small" data-action="editor-retry">Retry</button><button type="button" class="button small" data-action="editor-reload">Load saved version</button><button type="button" class="button small ghost" data-action="editor-download">Download draft</button></div>` : ''}
    <div class="editor-scroll scroll-y">
      <div class="editor-doc">
        <textarea class="editor-title" data-idea-field="title" rows="1" placeholder="Untitled idea" maxlength="300" aria-label="Idea title">${draft.title}</textarea>
        <div class="editor-props">
          <button type="button" class="status-pill status-${draft.status}" data-action="editor-status">${IDEA_STATUS[draft.status]}${icon('chevron-down', { size: 12 })}</button>
          <button type="button" class="prop-chip" data-action="editor-type">${icon('film', { size: 13 })}${ideaTypeLabel(draft.type)}</button>
          <button type="button" class="prop-chip ${draft.date ? '' : 'is-empty'}" data-action="editor-date">${icon('calendar', { size: 13 })}${draft.date ? `${relativeDay(draft.date, today)} · ${formatDate(draft.date, { today })}` : 'Add date'}</button>
          ${task && !task.trashedAt ? html`<button type="button" class="prop-chip" data-action="editor-task" data-id="${task.id}">${icon(task.status === 'completed' ? 'check' : 'tasks', { size: 13 })}Linked task${task.status === 'completed' ? ' · done' : ''}</button>`
            : draft.type === 'short' ? html`<span class="prop-hint">Date a Short to add it to Tasks</span>` : ''}
        </div>
        <div class="format-bar" role="toolbar" aria-label="Formatting">${TOOLBAR.map(([command, iconName, label]) => html`<button type="button" class="${visual?.controller.isActive(command) && mode === 'visual' ? 'is-active' : ''}" data-action="editor-format" data-format="${command}" title="${label}" aria-label="${label}">${icon(iconName, { size: 15 })}</button>`)}</div>
        ${editor.sourceOnly ? html`<p class="editor-note">${icon('warning', { size: 13 })}This idea uses Markdown the visual editor cannot show faithfully (such as raw HTML or loose lists), so it opens as Markdown to keep your text exactly as written.</p>` : ''}
        ${mode === 'source'
          ? html`<textarea class="editor-body" data-idea-field="markdown" spellcheck="true" maxlength="200000" aria-label="Idea Markdown" placeholder="Write your idea, outline, research or script…  Markdown: # headings, **bold**, - lists, - [ ] checklists, [links](…)">${draft.markdown}</textarea>`
          : html`<div class="editor-visual" data-morph-ignore></div>`}
      </div>
    </div>
    <footer class="editor-foot"><span>${plural(words, 'word')}</span><span>${Math.max(1, Math.round(words / 200))} min read</span><span>Edited ${timeAgo(idea.updatedAt)}</span><span class="grow"></span><span><kbd>⌘</kbd><kbd>S</kbd> save · autosaves as you type</span></footer>
  </div>`;
}

export function onIdeaFieldInput(element) {
  const editor = store.ui.idea;
  if (!editor) return;
  const field = element.dataset.ideaField;
  editor.draft[field] = element.value;
  if (field === 'title') { element.style.height = 'auto'; element.style.height = `${element.scrollHeight}px`; }
  markEdited(editor);
}

// The draft changed: autosave soon, and refresh the word count.
function markEdited(editor) {
  editor.dirty = true;
  editor.revision += 1;
  editor.error = null;
  clearTimeout(editor.timer);
  editor.timer = setTimeout(() => void saveIdea(), 900);
  clearTimeout(editor.previewTimer);
  editor.previewTimer = setTimeout(render, 160);
  const state = document.querySelector('.save-state');
  if (state) state.textContent = 'Edited';
}

function changes(editor) {
  const idea = lookup.idea(editor.id);
  if (!idea) return {};
  const out = {};
  for (const key of ['title', 'markdown', 'type', 'status', 'date']) if ((editor.draft[key] ?? null) !== (idea[key] ?? null)) out[key] = editor.draft[key];
  if (out.title !== undefined && !out.title.trim()) delete out.title;
  return out;
}

export function saveIdea() {
  const editor = store.ui.idea;
  if (!editor) return Promise.resolve(true);
  clearTimeout(editor.timer);
  if (editor.pending) return editor.pending;
  if (!editor.dirty) return Promise.resolve(true);
  editor.saving = true;
  render();
  editor.pending = (async () => {
    // One writer drains edits made while a save is in flight.
    while (editor.dirty) {
      const revision = editor.revision;
      const patch = changes(editor);
      if (!Object.keys(patch).length) { editor.dirty = false; break; }
      try {
        const body = await postJson('/api/run/creation.update?state=1', { ideaId: editor.id, expectedUpdatedAt: editor.base, ...patch });
        if (body.state) setState(body.state);
        editor.base = body.result.idea.updatedAt;
        if (editor.revision === revision) editor.dirty = false;
      } catch (error) {
        editor.error = error.message;
        return false;
      }
    }
    return true;
  })().finally(() => { editor.pending = null; editor.saving = false; render(); });
  return editor.pending;
}

function setDraftField(field, value) {
  const editor = store.ui.idea;
  editor.draft[field] = value;
  editor.dirty = true;
  editor.revision += 1;
  render();
  void saveIdea();
}

export function formatSelection(value, start, end, command) {
  const selection = value.slice(start, end);
  const pairs = { bold: ['**', '**', 'bold text'], italic: ['*', '*', 'italic text'], strike: ['~~', '~~', 'text'], code: ['`', '`', 'code'], link: ['[', '](https://)', 'link text'], image: ['![', '](https://)', 'description'] };
  let before;
  let after;
  let text;
  if (pairs[command]) [before, after, text] = pairs[command];
  else {
    const prefix = { heading: '## ', quote: '> ', bullet: '- ', number: '1. ', check: '- [ ] ' }[command];
    before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    after = '\n';
    text = prefix ? (selection || 'text').split('\n').map((line, index) => `${command === 'number' ? `${index + 1}. ` : prefix}${line}`).join('\n')
      : command === 'block' ? `\`\`\`\n${selection || 'code'}\n\`\`\``
        : command === 'table' ? '| Column | Column |\n| --- | --- |\n| Text | Text |'
          : '---';
  }
  const content = pairs[command] ? selection || text : text;
  return { value: value.slice(0, start) + before + (pairs[command] ? content : content) + after + value.slice(end), start: start + before.length, end: start + before.length + content.length };
}

function applyFormat(command) {
  if (visual) {
    if (command === 'link') void askLink();
    else if (command === 'image') void askImage();
    else visual.controller.run(command);
    return;
  }
  const textarea = document.querySelector('.editor-body');
  if (!textarea) return;
  const next = formatSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd, command);
  textarea.value = next.value;
  textarea.focus();
  textarea.setSelectionRange(next.start, next.end);
  onIdeaFieldInput(textarea);
}

export function onEditorKey(event) {
  if (!event.target.closest('.idea-editor')) return false;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void saveIdea(); return true; }
  if (event.target.matches('.editor-body') && mod && ['b', 'i', 'k'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    applyFormat({ b: 'bold', i: 'italic', k: 'link' }[event.key.toLowerCase()]);
    return true;
  }
  if (event.target.matches('.editor-title') && event.key === 'Enter') {
    event.preventDefault();
    if (visual) visual.controller.focus('start');
    else document.querySelector('.editor-body')?.focus();
    return true;
  }
  return false;
}

export async function leaveEditor() {
  if (!store.ui.idea?.dirty) return true;
  return saveIdea();
}

// ——— Drag on the board ——————————————————————————————————————————————————
export function startIdeaDrag(event, card) {
  const id = card.dataset.idea;
  let indicator = null;
  let target = null;
  const clear = () => { document.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target')); indicator?.remove(); indicator = null; };
  beginDrag(event, {
    source: card,
    onMove: ({ target: element, y }) => {
      clear();
      target = null;
      const column = element?.closest('[data-idea-drop]');
      if (!column) return;
      column.classList.add('is-drop-target');
      const cards = [...column.querySelectorAll('[data-idea]')].filter((node) => node.dataset.idea !== id);
      const before = cards.find((node) => { const rect = node.getBoundingClientRect(); return y < rect.top + rect.height / 2; });
      target = { status: column.dataset.ideaDrop, beforeIdeaId: before?.dataset.idea || null };
      indicator = document.createElement('div');
      indicator.className = 'drop-line card-line';
      const container = column.querySelector('.board-cards');
      const rect = container.getBoundingClientRect();
      const anchor = before?.getBoundingClientRect();
      const last = cards.at(-1)?.getBoundingClientRect();
      indicator.style.top = `${(anchor ? anchor.top - 5 : last ? last.bottom + 3 : rect.top + 4) - rect.top + container.scrollTop}px`;
      container.append(indicator);
    },
    onDrop: () => { clear(); if (target) act.moveIdea(id, target.status, target.beforeIdeaId); },
    onCancel: clear,
  });
}

const ideaId = () => store.ui.route.id;

export const actions = {
  'creation-view': (el) => { setPref('creation.view', el.dataset.view); navigate(`/creation?view=${el.dataset.view}`, { replace: true }); },
  'creation-type': (el) => setPref('creation.type', el.dataset.type),
  'creation-sort': (el) => openMenu({ anchor: el, width: 200, title: 'Sort ideas', items: Object.entries(SORTS).map(([id, label]) => ({ label, checked: (store.prefs.creation.sort || 'manual') === id, run: () => setPref('creation.sort', id) })) }),
  'creation-new': () => import('../ui/capture.js').then(({ openCapture }) => openCapture({ kind: 'idea' })),
  'creation-add-in': (el) => { store.ui.addingIdeaIn = el.dataset.status; render(); requestAnimationFrame(() => document.querySelector('[data-idea-add]')?.focus()); },
  'idea-menu': (el) => ideaMenu(el.closest('[data-idea]').dataset.idea, el),
  'idea-status': (el) => {
    const idea = lookup.idea(el.closest('[data-idea]').dataset.idea);
    pickFromList({ anchor: el, title: 'Status', value: idea.status, options: STATUSES.map((value) => ({ value, label: IDEA_STATUS[value] })), onPick: (status) => act.moveIdea(idea.id, status) });
  },
  'editor-mode': (el) => setPref('creation.editorMode', el.dataset.mode === 'source' ? 'source' : 'visual'),
  'editor-format': (el) => applyFormat(el.dataset.format),
  'editor-status': (el) => pickFromList({ anchor: el, title: 'Status', value: store.ui.idea.draft.status, options: STATUSES.map((value) => ({ value, label: IDEA_STATUS[value] })), onPick: (status) => setDraftField('status', status) }),
  'editor-type': (el) => {
    const types = [...new Set(['short', 'long_video', ...store.state.creation.ideas.map((idea) => idea.type)])];
    openMenu({
      anchor: el, width: 230, title: 'Type',
      search: { placeholder: 'Type or create…', create: (query) => ({ label: `Use “${query}”`, icon: 'plus', run: () => setDraftField('type', query.slice(0, 40)) }) },
      items: types.map((type) => ({ label: ideaTypeLabel(type), checked: store.ui.idea.draft.type === type, run: () => setDraftField('type', type) })),
    });
  },
  'editor-date': (el) => pickDate({ anchor: el, value: store.ui.idea.draft.date, onPick: (date) => setDraftField('date', date) }),
  'editor-task': async (el) => { await saveIdea(); navigate('/tasks', { keepSheet: true }); act.openTask(el.dataset.id); },
  'editor-codex': () => attachContext('idea', ideaId()),
  'editor-menu': (el) => ideaMenu(ideaId(), el),
  'editor-retry': () => { store.ui.idea.error = null; void saveIdea(); },
  'editor-reload': async () => {
    const ok = await confirmDialog({ title: 'Load the saved version?', body: 'Your unsaved changes in this window will be replaced. Download them first if you want to keep them.', confirmLabel: 'Load saved version', danger: true });
    if (!ok) return;
    const { fetchState } = await import('../api.js');
    await fetchState();
    const idea = lookup.idea(ideaId());
    store.ui.idea = idea ? { id: idea.id, draft: pick(idea), base: idea.updatedAt, dirty: false, saving: false, error: null, revision: 0, pending: null, timer: 0 } : null;
    render();
  },
  'editor-download': () => {
    const draft = store.ui.idea.draft;
    const blob = new Blob([`# ${draft.title}\n\n${draft.markdown}`], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${draft.title.replace(/[^\w\- ]+/g, '').trim() || 'idea'}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },
};

export async function submitInlineIdea(input) {
  const title = input.value.trim();
  const status = input.dataset.ideaAdd;
  if (!title) { store.ui.addingIdeaIn = null; render(); return; }
  input.value = '';
  await act.createIdea({ title, status, type: store.prefs.creation.type !== 'all' ? store.prefs.creation.type : 'short' });
  requestAnimationFrame(() => document.querySelector('[data-idea-add]')?.focus());
}

export function presence() {
  const idea = store.ui.route.id ? lookup.idea(store.ui.route.id) : null;
  return idea ? { title: idea.title, selected: { kind: 'idea', id: idea.id, title: idea.title } } : { title: 'Creation' };
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (store.ui.idea?.dirty) { event.preventDefault(); event.returnValue = ''; }
  });
}

export default { id: 'creation', render: render_, actions, presence, mount };
