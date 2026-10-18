// Settings: how LifeOS is arranged (workspace), how it plans (settings,
// domains, categories), saved views, agent access and storage. Every control
// saves immediately through the same commands agents use, so each change is
// journaled and undoable.
import { request, run } from '../api.js';
import { cx, html } from '../dom.js';
import { timeAgo } from '../format.js';
import { icon } from '../icons.js';
import { render, setPref, store } from '../store.js';
import { SHORTCUTS } from '../commands-ui.js';
import { confirmDialog, formDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

const PAGES = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'sidebar', label: 'Sidebar', icon: 'sidebar' },
  { id: 'planning', label: 'Planning', icon: 'target' },
  { id: 'views', label: 'Saved views', icon: 'list' },
  { id: 'agents', label: 'Agents & automation', icon: 'sparkle' },
  { id: 'data', label: 'Data & backups', icon: 'database' },
  { id: 'shortcuts', label: 'Keyboard', icon: 'keyboard' },
];

const SECTION_LABELS = { today: 'Today', tasks: 'Tasks', projects: 'Projects', creation: 'Creation', reading: 'Reading', insights: 'Insights', almanac: 'Almanac' };
const ACCENTS = [null, '#b4502c', '#a23c6b', '#5e4a9c', '#3a6b85', '#2f7a68', '#5e7d2c', '#9c7720'];
const local = { commands: null, storage: null, mcp: null, commandFilter: '', loading: false };

function page() {
  const id = store.ui.route.id;
  return PAGES.some((item) => item.id === id) ? id : 'general';
}

export function render_() {
  const current = page();
  const body = {
    general: renderGeneral, appearance: renderAppearance, sidebar: renderSidebar, planning: renderPlanning,
    views: renderViews, agents: renderAgents, data: renderData, shortcuts: renderShortcuts,
  }[current]();
  return html`<div class="screen settings-screen">
    <nav class="settings-nav scroll-y" aria-label="Settings sections">
      <h1 class="settings-title">Settings</h1>
      ${PAGES.map((item) => html`<a class="${cx('list-link', current === item.id && 'is-active')}" href="/settings/${item.id}" ${current === item.id ? html`aria-current="page"` : ''}><span class="list-icon">${icon(item.icon, { size: 15 })}</span><span class="list-label">${item.label}</span></a>`)}
    </nav>
    <section class="settings-body scroll-y" aria-label="${PAGES.find((item) => item.id === current).label}">${body}</section>
  </div>`;
}

function group(title, description, content) {
  return html`<section class="settings-group"><header><h2>${title}</h2>${description ? html`<p>${description}</p>` : ''}</header><div class="settings-rows">${content}</div></section>`;
}

function row(label, hint, control) {
  return html`<div class="settings-row"><div class="settings-label"><b>${label}</b>${hint ? html`<span>${hint}</span>` : ''}</div><div class="settings-control">${control}</div></div>`;
}

function segmented(name, value, options) {
  return html`<div class="segmented" role="radiogroup">${options.map(([id, label, iconName]) => html`<button type="button" role="radio" class="${value === id ? 'is-active' : ''}" aria-checked="${value === id ? 'true' : 'false'}" data-action="settings-choose" data-name="${name}" data-value="${id}">${iconName ? icon(iconName, { size: 14 }) : ''}${label}</button>`)}</div>`;
}

// ——— General ——————————————————————————————————————————————————————————
function renderGeneral() {
  const state = store.state;
  const workspace = state.workspace;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [state.meta.timezone];
  return html`
    ${group('Identity', 'The name and line shown in the sidebar masthead.', html`
      ${row('Name', null, html`<input class="input" data-setting="appName" value="${state.meta.appName}" maxlength="40" aria-label="App name">`)}
      ${row('Tagline', null, html`<input class="input" data-setting="tagline" value="${state.meta.tagline}" maxlength="80" aria-label="Tagline">`)}
    `)}
    ${group('Time', 'Days, streaks and “today” follow this time zone.', html`
      ${row('Time zone', null, html`<select class="input" data-setting="timezone" aria-label="Time zone">${zones.map((zone) => html`<option value="${zone}" ${zone === state.meta.timezone ? 'selected' : ''}>${zone.replace(/_/g, ' ')}</option>`)}</select>`)}
    `)}
    ${group('Start screen', 'What LifeOS opens to.', html`
      ${row('Open to', null, html`<select class="input" data-workspace="startScreen" aria-label="Start screen">${Object.entries(SECTION_LABELS).map(([id, label]) => html`<option value="${id}" ${workspace.startScreen === id ? 'selected' : ''}>${label}</option>`)}</select>`)}
    `)}`;
}

// ——— Appearance ———————————————————————————————————————————————————————
function renderAppearance() {
  const workspace = store.state.workspace;
  const accent = workspace.theme.accent;
  return html`
    ${group('Theme', 'Warm paper by day, ink by night — or follow the system.', html`
      ${row('Mode', null, segmented('theme', workspace.theme.mode, [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]))}
      ${row('Accent', 'Used for focus, selection and primary actions.', html`<div class="swatches">
        ${ACCENTS.map((color) => html`<button type="button" class="${cx('swatch', (accent || null) === color && 'is-active')}" style="${color ? `--swatch:${color}` : ''}" data-action="settings-accent" data-value="${color || ''}" aria-label="${color ? `Accent ${color}` : 'Default accent'}" title="${color || 'Default'}">${color ? '' : icon('check', { size: 11 })}</button>`)}
        <label class="swatch is-custom" title="Custom color"><input type="color" value="${accent || '#b4502c'}" data-accent-custom aria-label="Custom accent color">${icon('plus', { size: 12 })}</label>
      </div>`)}
    `)}
    ${group('Density', 'Compact fits more rows on screen; comfortable gives them room.', html`
      ${row('Rows', null, segmented('density', workspace.density, [['comfortable', 'Comfortable'], ['compact', 'Compact']]))}
    `)}`;
}

// ——— Sidebar ——————————————————————————————————————————————————————————
function renderSidebar() {
  const nav = store.state.workspace.nav;
  return html`${group('Sections', 'Reorder or hide sidebar sections. Hidden sections stay reachable from ⌘K and links.', html`
    <ol class="nav-editor">${nav.map((item, index) => html`<li data-key="nav-${item.id}" class="${item.hidden ? 'is-hidden' : ''}">
      <span class="list-icon">${icon(item.id, { size: 15 })}</span><span class="grow">${SECTION_LABELS[item.id]}</span>
      <button type="button" class="icon-button tiny" data-action="settings-nav-move" data-id="${item.id}" data-delta="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${SECTION_LABELS[item.id]} up">${icon('chevron-up', { size: 14 })}</button>
      <button type="button" class="icon-button tiny" data-action="settings-nav-move" data-id="${item.id}" data-delta="1" ${index === nav.length - 1 ? 'disabled' : ''} aria-label="Move ${SECTION_LABELS[item.id]} down">${icon('chevron-down', { size: 14 })}</button>
      <label class="switch" title="${item.hidden ? 'Show' : 'Hide'}"><input type="checkbox" ${item.hidden ? '' : 'checked'} data-action="settings-nav-toggle" data-id="${item.id}" aria-label="Show ${SECTION_LABELS[item.id]}"><i></i></label>
    </li>`)}</ol>
  `)}
  ${group('Pinned', 'Pin projects, views and tags from their menus for one-click access.', html`
    ${store.state.workspace.pinned.length ? html`<ul class="settings-list">${store.state.workspace.pinned.map((pin) => html`<li><span class="grow">${pinLabel(pin)}</span><small class="muted">${pin.kind}</small><button type="button" class="icon-button tiny" data-action="settings-unpin" data-kind="${pin.kind}" data-id="${pin.id}" aria-label="Unpin">${icon('x', { size: 13 })}</button></li>`)}</ul>` : html`<p class="muted small">Nothing pinned yet.</p>`}
  `)}`;
}

function pinLabel(pin) {
  if (pin.kind === 'project') return store.state.projects.find((project) => project.id === pin.id)?.name || pin.id;
  if (pin.kind === 'view') return store.state.workspace.views.find((view) => view.id === pin.id)?.name || pin.id;
  return `#${pin.id}`;
}

// ——— Planning —————————————————————————————————————————————————————————
function renderPlanning() {
  const state = store.state;
  const settings = state.settings;
  const domains = Object.entries(state.domains);
  const weekly = settings.weeklyPlanByDomain || {};
  const total = domains.reduce((sum, [id]) => sum + Number(weekly[id] || 0), 0);
  const categories = Object.entries(state.categories || {});
  return html`
    ${group('Daily rhythm', 'Targets used by Today, Insights and recommendations.', html`
      ${row('Daily plan', 'Hours you intend to work on a typical day.', html`<span class="unit-input"><input class="input" type="number" min="0.5" max="24" step="0.5" data-setting="defaultDailyPlanHours" value="${settings.defaultDailyPlanHours}" aria-label="Daily plan hours"><span>h</span></span>`)}
      ${row('Deep work target', 'Share of tracked time that should be focused work.', html`<span class="unit-input"><input class="input" type="number" min="0" max="100" step="5" data-setting="deepTarget" data-scale="100" value="${Math.round(settings.deepTarget * 100)}" aria-label="Deep work target"><span>%</span></span>`)}
      ${row('Needs attention after', 'Days without activity before a project is flagged.', html`<span class="unit-input"><input class="input" type="number" min="0.5" max="60" step="0.5" data-setting="health.attentionInactiveDays" value="${settings.health.attentionInactiveDays}" aria-label="Attention after days"><span>days</span></span>`)}
      ${row('Critical after', null, html`<span class="unit-input"><input class="input" type="number" min="1" max="120" step="0.5" data-setting="health.criticalInactiveDays" value="${settings.health.criticalInactiveDays}" aria-label="Critical after days"><span>days</span></span>`)}
    `)}
    ${group('Domains', html`Areas of your life and work. Weekly hours drive the plan-vs-actual charts — currently <b>${total}h</b> a week.`, html`
      <ul class="domain-editor">${domains.map(([id, domain]) => html`<li data-key="domain-${id}">
        <label class="color-dot" style="--dot:${domain.color}" title="Color"><input type="color" value="${domain.color}" data-domain="${id}" data-domain-field="color" aria-label="${domain.label} color"></label>
        <input class="input grow" value="${domain.label}" data-domain="${id}" data-domain-field="label" maxlength="40" aria-label="Domain name">
        <input class="input short" value="${domain.short || ''}" data-domain="${id}" data-domain-field="short" maxlength="8" aria-label="Short label" placeholder="ABBR">
        <span class="unit-input"><input class="input" type="number" min="0" max="168" step="1" value="${weekly[id] ?? 0}" data-domain="${id}" data-domain-field="weeklyHours" aria-label="${domain.label} weekly hours"><span>h/wk</span></span>
        <button type="button" class="icon-button tiny" data-action="settings-domain-delete" data-id="${id}" aria-label="Delete ${domain.label}">${icon('trash', { size: 13 })}</button>
      </li>`)}</ul>
      <button type="button" class="button ghost small" data-action="settings-domain-add">${icon('plus', { size: 14 })}Add domain</button>
    `)}
    ${group('Categories', 'Reusable labels shared across projects. Renaming updates every project at once.', html`
      ${categories.length ? html`<ul class="settings-list">${categories.map(([id, category]) => html`<li data-key="cat-${id}">
        <input class="input grow" value="${category.label}" data-category="${id}" maxlength="60" aria-label="Category name">
        <small class="muted">${state.projects.filter((project) => project.categoryIds?.includes(id)).length} projects</small>
        <button type="button" class="icon-button tiny" data-action="settings-category-delete" data-id="${id}" aria-label="Delete ${category.label}">${icon('trash', { size: 13 })}</button>
      </li>`)}</ul>` : html`<p class="muted small">No categories yet.</p>`}
      <form class="inline-add" data-category-add><input class="input" name="label" placeholder="New category" maxlength="60" autocomplete="off"><button type="submit" class="button small">Add</button></form>
    `)}`;
}

// ——— Views ————————————————————————————————————————————————————————————
function renderViews() {
  const views = store.state.workspace.views;
  return html`${group('Saved task views', 'Smart lists that filter tasks by project, tag, priority, date and text. They appear under Tasks and in ⌘K.', html`
    ${views.length ? html`<ul class="settings-list">${views.map((view) => html`<li data-key="view-${view.id}">
      <span class="list-icon">${icon(view.icon || 'list', { size: 15 })}</span>
      <a class="grow" href="/tasks?list=view:${encodeURIComponent(view.id)}">${view.name}</a>
      <button type="button" class="button ghost small" data-action="settings-view-edit" data-id="${view.id}">Edit</button>
      <button type="button" class="icon-button tiny" data-action="settings-view-delete" data-id="${view.id}" aria-label="Delete ${view.name}">${icon('trash', { size: 13 })}</button>
    </li>`)}</ul>` : html`<p class="muted small">No saved views yet. Filter a task list and choose “Save view”, or create one here.</p>`}
    <button type="button" class="button small" data-action="settings-view-new">${icon('plus', { size: 14 })}New view</button>
  `)}`;
}

// ——— Agents ———————————————————————————————————————————————————————————
function renderAgents() {
  ensureAgentInfo();
  const commands = local.commands || [];
  const needle = local.commandFilter.trim().toLowerCase();
  const shown = needle ? commands.filter((command) => `${command.name} ${command.title} ${command.description}`.toLowerCase().includes(needle)) : commands;
  const mcpPath = local.mcp?.args?.at(-1) || '<LifeOS>/scripts/lifeos-mcp.mjs';
  const root = local.mcp?.cwd || '<LifeOS>';
  const reads = commands.filter((command) => command.kind === 'read').length;
  const writes = commands.filter((command) => command.kind === 'write').length;
  const ui = commands.length - reads - writes;
  const presence = store.state.workspace;
  return html`
    <div class="agents-hero">
      <div class="agents-mark">${icon('sparkle', { size: 22 })}</div>
      <div><h2>Everything you can do here, an agent can do too.</h2>
      <p>LifeOS exposes ${commands.length || 'all its'} commands${commands.length ? ` — ${reads} reads, ${writes} journaled writes and ${ui} window controls —` : ''} through MCP, a CLI, a JavaScript SDK and local HTTP. Agent changes show up live in this window, appear in Activity with their name, and can be undone like yours. Codex and Claude Code can also work right here in the rail.</p></div>
    </div>
    ${group('Connect an MCP client', 'Runs locally over stdio against this workspace’s store. No account or network access is involved.', html`
      ${snippet('Claude Code', `claude mcp add lifeos -- node "${mcpPath}"`)}
      ${snippet('Codex', `codex mcp add lifeos -- node "${mcpPath}"`)}
      ${snippet('Any MCP client (JSON config)', JSON.stringify({ mcpServers: { lifeos: { command: 'node', args: [mcpPath] } } }, null, 2))}
      <p class="muted small">This folder also ships a project <code>.mcp.json</code>, so agents started inside <code>${root}</code> find LifeOS automatically.</p>
    `)}
    ${group('Code and shell', 'For scripts, cron jobs and agents that prefer code.', html`
      ${snippet('CLI', 'npm run lifeos -- run tasks.create --title "Draft Act III" --projectId portia --priority high\nnpm run lifeos -- commands   # list every command with its schema')}
      ${snippet('JavaScript SDK', `import { createLifeOS } from '${root}/src/sdk.mjs';\nconst lifeos = createLifeOS({ actor: 'my-script' });\nawait lifeos.tasks.create({ title: 'Call the lab', dueDate: 'tomorrow' });\nawait lifeos.ui.navigate({ to: '/tasks?list=today' }); // drives this window`)}
      ${snippet('HTTP (loopback only)', `curl -s -X POST http://127.0.0.1:${location.port || 80}/api/run/tasks.list \\\n  -H 'content-type: application/json' -H 'x-lifeos-actor: my-script' -d '{"list":"today"}'`)}
    `)}
    ${group('Agents can drive this window', 'ui.* commands navigate, open records, show toasts and start capture here — the window reports what it shows so agents can ask with ui.view.', html`
      <p class="muted small">Theme, sidebar, saved views and pins live in the workspace file, so an agent can rearrange LifeOS around a new need (“add a Writing view for #script tasks due this week and pin it”). ${presence.views.length} views and ${presence.pinned.length} pins configured.</p>
    `)}
    ${group(`Command reference${commands.length ? ` · ${commands.length}` : ''}`, null, html`
      <label class="filter-field wide">${icon('search', { size: 14 })}<input type="search" placeholder="Search commands" value="${local.commandFilter}" data-command-filter aria-label="Search commands"></label>
      ${local.commands ? html`<div class="command-ref">${shown.map((command) => html`<details data-key="cmd-${command.name}" data-keep-open>
        <summary><code>${command.name}</code><span>${command.title}</span><small class="${cx('kind', command.kind)}">${command.kind}</small></summary>
        <p>${command.description}</p>
        ${command.inputSchema?.properties && Object.keys(command.inputSchema.properties).length ? html`<dl class="schema">${Object.entries(command.inputSchema.properties).map(([key, schema]) => html`<div><dt>${key}${command.inputSchema.required?.includes(key) ? html`<b>*</b>` : ''}</dt><dd>${schemaHint(schema)}</dd></div>`)}</dl>` : html`<p class="muted small">No input.</p>`}
      </details>`)}</div>` : html`<p class="muted small">Loading…</p>`}
    `)}`;
}

function schemaHint(schema) {
  if (!schema) return '';
  if (schema.enum) return schema.enum.join(' | ');
  if (schema.anyOf) return schema.anyOf.map(schemaHint).filter(Boolean).join(' | ');
  if (schema.type === 'array') return `${schemaHint(schema.items)}[]`;
  return [schema.type, schema.description].filter(Boolean).join(' — ');
}

function snippet(label, code) {
  return html`<div class="snippet"><div class="snippet-head"><span>${label}</span><button type="button" class="button ghost tiny" data-action="settings-copy">${icon('copy', { size: 12 })}Copy</button></div><pre><code>${code}</code></pre></div>`;
}

async function ensureAgentInfo() {
  if (local.commands || local.loading) return;
  local.loading = true;
  try {
    const body = await request('/api/commands');
    local.commands = body.commands;
    local.mcp = body.mcp || null;
  } catch (error) {
    local.commands = [];
    toast(error.message, { tone: 'error' });
  } finally {
    local.loading = false;
    render();
  }
}

// ——— Data —————————————————————————————————————————————————————————————
function renderData() {
  ensureStorage();
  const storage = local.storage;
  const authority = store.state.tasks.authority;
  return html`
    ${group('This Mac', 'Your records live in one local JSON file, written atomically with a recovery copy beside it.', html`
      ${storage ? html`${row('Data folder', null, html`<code class="path">${storage.dataDirectory}</code>`)}
        ${row('Store', null, html`<code class="path">${storage.storePath}</code>`)}` : html`<p class="muted small">Loading…</p>`}
      ${row('Change journal', 'Every change by you or an agent, with exact before/after values for undo.', html`<button type="button" class="button ghost small" data-action="settings-activity">${icon('activity', { size: 14 })}Open Activity</button>`)}
    `)}
    ${group('Cloud snapshot', 'A secondary copy written after successful saves to one folder you choose. A failed snapshot never blocks a local save.', html`
      ${storage ? storage.backupConfigured ? html`
        ${row('Folder', null, html`<code class="path">${storage.backupDirectory}</code>`)}
        ${row('Latest snapshot', storage.lastBackup?.error ? html`<span class="warn">${storage.lastBackup.error}</span>` : null, html`<span>${storage.latestSnapshotAt ? timeAgo(storage.latestSnapshotAt) : 'Never'}</span><button type="button" class="button small" data-action="settings-backup">${icon('download', { size: 14 })}Back up now</button>`)}
      ` : html`<p class="muted small">No snapshot folder is configured. Choose one explicitly from a terminal:</p>${snippet('Configure', 'npm run lifeos -- storage configure-backup --path "/path/to/Google Drive/My Drive/LifeOS Backups"')}` : ''}
    `)}
    ${authority ? group('Tasks', 'Tasks are coordinated by the shared task store.', html`
      ${row('Mode', null, html`<span>${authority.mode === 'online' ? `Online · ${authority.phase}` : authority.mode}${authority.online === false ? html` · <span class="warn">offline</span>` : ''}</span>`)}
      <p class="muted small">While the shared store is active, deleted tasks go to Trash and permanent deletion is disabled.</p>
    `) : ''}`;
}

async function ensureStorage() {
  if (local.storage || local.loadingStorage) return;
  local.loadingStorage = true;
  try {
    local.storage = await run('storage.status', {}, { quiet: true, silentError: true });
  } catch {
    local.storage = null;
  } finally {
    local.loadingStorage = false;
    render();
  }
}

// ——— Shortcuts ————————————————————————————————————————————————————————
function renderShortcuts() {
  return html`${SHORTCUTS.map((section) => group(section.group, null, html`<dl class="shortcut-list">${section.items.map(([keys, label]) => html`<div><dt>${keys.split('  ').map((part, index) => html`${index ? html`<span class="muted">·</span>` : ''}${part.split(' ').map((key) => (['then', 'or'].includes(key) ? html`<span class="muted">${key}</span>` : html`<kbd>${key}</kbd>`))}`)}</dt><dd>${label}</dd></div>`)}</dl>`))}`;
}

// ——— Saving ———————————————————————————————————————————————————————————
const pendingSaves = new Map();

function saveSoon(key, fn, delay = 500) {
  clearTimeout(pendingSaves.get(key));
  pendingSaves.set(key, setTimeout(() => { pendingSaves.delete(key); fn(); }, delay));
}

export function onSettingInput(element, { commit = false } = {}) {
  if (element.matches('[data-command-filter]')) { local.commandFilter = element.value; render(); return; }
  if (element.matches('[data-setting]')) {
    const path = element.dataset.setting;
    let value = element.type === 'number' ? Number(element.value) : element.value;
    if (element.type === 'number' && (!Number.isFinite(value) || element.value === '')) return;
    if (element.dataset.scale) value /= Number(element.dataset.scale);
    if (typeof value === 'string' && path !== 'tagline' && !value.trim()) return;
    const input = path.startsWith('health.') ? { health: { [path.slice(7)]: value } } : { [path]: value };
    saveSoon(path, () => run('settings.update', input, { quiet: true }).catch(() => undefined), commit ? 0 : 600);
    return;
  }
  if (element.matches('[data-workspace]')) {
    run('workspace.update', { [element.dataset.workspace]: element.value }, { quiet: true }).catch(() => undefined);
    return;
  }
  if (element.matches('[data-accent-custom]')) {
    saveSoon('accent', () => run('workspace.update', { theme: { accent: element.value } }, { quiet: true }).catch(() => undefined), commit ? 0 : 250);
    return;
  }
  if (element.matches('[data-domain]')) {
    const id = element.dataset.domain;
    const field = element.dataset.domainField;
    if (field === 'weeklyHours') {
      const hours = Number(element.value);
      if (!Number.isFinite(hours) || element.value === '') return;
      saveSoon(`domain:${id}:hours`, () => run('settings.update', { weeklyPlanByDomain: { ...store.state.settings.weeklyPlanByDomain, [id]: hours } }, { quiet: true }).catch(() => undefined), commit ? 0 : 600);
      return;
    }
    const value = element.value.trim();
    if (field === 'label' && !value) return;
    saveSoon(`domain:${id}:${field}`, () => run('domains.update', { domainId: id, [field]: value }, { quiet: true }).catch(() => undefined), commit || field === 'color' ? 150 : 600);
    return;
  }
  if (element.matches('[data-category]')) {
    const label = element.value.trim();
    if (!label) return;
    saveSoon(`category:${element.dataset.category}`, () => run('categories.update', { categoryId: element.dataset.category, label }, { quiet: true }).catch(() => undefined), commit ? 0 : 700);
  }
}

export async function submitCategory(form) {
  const input = form.querySelector('input');
  const label = input.value.trim();
  if (!label) return;
  input.value = '';
  await run('categories.create', { label }).catch(() => { input.value = label; });
}

function moveNav(id, delta) {
  const nav = store.state.workspace.nav.map((item) => ({ ...item }));
  const index = nav.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= nav.length) return;
  [nav[index], nav[target]] = [nav[target], nav[index]];
  run('workspace.update', { nav }, { quiet: true }).catch(() => undefined);
}

export const actions = {
  'settings-choose': (el) => {
    const { name, value } = el.dataset;
    if (name === 'theme') run('workspace.update', { theme: { mode: value } }, { quiet: true }).catch(() => undefined);
    if (name === 'density') run('workspace.update', { density: value }, { quiet: true }).catch(() => undefined);
  },
  'settings-accent': (el) => run('workspace.update', { theme: { accent: el.dataset.value || null } }, { quiet: true }).catch(() => undefined),
  'settings-nav-move': (el) => moveNav(el.dataset.id, Number(el.dataset.delta)),
  'settings-nav-toggle': (el) => {
    const nav = store.state.workspace.nav.map((item) => (item.id === el.dataset.id ? { ...item, hidden: !el.checked } : item));
    if (nav.every((item) => item.hidden)) { el.checked = true; toast('Keep at least one section visible.', { tone: 'info' }); return; }
    run('workspace.update', { nav }, { quiet: true }).catch(() => undefined);
  },
  'settings-unpin': (el) => run('pins.set', { kind: el.dataset.kind, id: el.dataset.id, pinned: false }).catch(() => undefined),
  'settings-domain-add': async () => {
    const values = await formDialog({
      title: 'New domain',
      fields: [
        { name: 'label', label: 'Name', required: true, autofocus: true, placeholder: 'Health' },
        { name: 'short', label: 'Short label', placeholder: 'HLTH' },
        { name: 'color', label: 'Color', type: 'color', value: '#2f7a68' },
        { name: 'weeklyHours', label: 'Weekly hours', type: 'number', value: 0, min: 0, max: 168 },
      ],
    });
    if (values) run('domains.create', { label: values.label, short: values.short || undefined, color: values.color, weeklyHours: Number(values.weeklyHours) || 0 }).catch(() => undefined);
  },
  'settings-domain-delete': async (el) => {
    const domain = store.state.domains[el.dataset.id];
    const used = store.state.projects.filter((project) => project.domain === el.dataset.id).length;
    if (used) { toast(`${domain.label} still has ${used} project${used === 1 ? '' : 's'}. Move them to another domain first.`, { tone: 'info' }); return; }
    const ok = await confirmDialog({ title: `Delete ${domain.label}?`, body: 'Its weekly plan is removed. You can undo right after.', confirmLabel: 'Delete domain', danger: true });
    if (ok) run('domains.delete', { domainId: el.dataset.id }).catch(() => undefined);
  },
  'settings-category-delete': async (el) => {
    const category = store.state.categories[el.dataset.id];
    const ok = await confirmDialog({ title: `Delete “${category.label}”?`, body: 'It is removed from every project. Logged time keeps its history. You can undo right after.', confirmLabel: 'Delete category', danger: true });
    if (ok) run('categories.delete', { categoryId: el.dataset.id }).catch(() => undefined);
  },
  'settings-view-new': () => import('./tasks.js').then(({ editView }) => editView()),
  'settings-view-edit': (el) => import('./tasks.js').then(({ editView }) => editView(store.state.workspace.views.find((view) => view.id === el.dataset.id))),
  'settings-view-delete': (el) => import('./tasks.js').then(({ deleteView }) => deleteView(store.state.workspace.views.find((view) => view.id === el.dataset.id))),
  'settings-copy': (el) => {
    const code = el.closest('.snippet').querySelector('code').textContent;
    navigator.clipboard?.writeText(code).then(() => toast('Copied', { tone: 'quiet', timeout: 1600 })).catch(() => toast('Copy failed — select the text instead.', { tone: 'error' }));
  },
  'settings-backup': () => run('storage.backupNow', {}, { quiet: true }).then(() => { local.storage = null; toast('Snapshot written', { tone: 'quiet' }); render(); }).catch(() => undefined),
  'settings-activity': () => { setPref('railOpen', true); setPref('railTab', 'activity'); },
};

export function presence() {
  return { title: `Settings — ${PAGES.find((item) => item.id === page()).label}` };
}

export function onLeave() {
  local.storage = null;
}

export default { id: 'settings', render: render_, actions, presence, onLeave };
