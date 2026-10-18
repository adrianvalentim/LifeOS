// The right rail: an agent (Codex through the installed `codex app-server`, or
// Claude Code through the installed `claude` CLI — both with the person's own
// signed-in account, never an API key) and Activity (the change journal for
// people and agents, with undo). Approvals and questions from either agent
// always wait for the person here; nothing is accepted automatically.
import { messageWithContext } from './agent-context.js';
import { postJson, request, scheduleRefresh, undo } from './api.js';
import { cx, html, raw } from './dom.js';
import { timeAgo } from './format.js';
import { icon } from './icons.js';
import { render, setPref, store } from './store.js';
import { renderMarkdown } from '../vendor/creation-markdown.js';

const PROVIDERS = {
  codex: {
    name: 'Codex',
    threadKey: 'lifeos.codex.threadId',
    ready: (agent) => agent.account?.account?.type === 'chatgpt',
    status: (agent) => {
      const account = agent.account?.account;
      return account?.type === 'chatgpt' ? account.email || `ChatGPT ${account.planType || ''}`.trim() : null;
    },
    signIn: (agent) => (agent.account
      ? 'Codex is not using a ChatGPT account. Sign in with the installed Codex app, then press Retry.'
      : 'Could not reach the installed Codex app. Start Codex or set CODEX_EXECUTABLE, then press Retry.'),
  },
  claude: {
    name: 'Claude',
    threadKey: 'lifeos.claude.threadId',
    ready: (agent) => Boolean(agent.account?.loggedIn),
    status: (agent) => (agent.account?.loggedIn ? agent.account.email || (agent.account.subscriptionType ? `Claude ${agent.account.subscriptionType}` : 'Signed in') : null),
    signIn: (agent) => (agent.connection === 'error'
      ? agent.error || 'Claude Code is not installed. Install it or set CLAUDE_EXECUTABLE, then press Retry.'
      : 'Claude Code is not signed in. Run “claude auth login” in Terminal, then press Retry.'),
  },
};

function makeAgent(provider) {
  return {
    provider,
    connection: 'idle',
    account: null,
    threads: [],
    activeThread: null,
    runningTurns: {},
    pendingRequests: [],
    draft: '',
    sending: false,
    opening: false,
    error: null,
    started: false,
    stickToBottom: true,
  };
}

export const agents = { codex: makeAgent('codex'), claude: makeAgent('claude') };
const activity = { entries: [], loaded: false, loading: false, filter: 'all' };

const providerId = () => (store.prefs.railAgent === 'claude' ? 'claude' : 'codex');
const current = () => agents[providerId()];
const api = (agent, route) => `/api/${agent.provider}/${route}`;
const ready = (agent) => PROVIDERS[agent.provider].ready(agent);

// ——— Rendering ————————————————————————————————————————————————————————
export function renderRail() {
  const tab = store.prefs.railTab === 'activity' ? 'activity' : 'agent';
  const agent = current();
  if (tab === 'agent' && !agent.started) queueMicrotask(() => bootstrapAgent(agent.provider));
  const waiting = agents.codex.pendingRequests.length + agents.claude.pendingRequests.length;
  return html`<aside class="rail" aria-label="Agent rail" tabindex="-1">
    <div class="rail-resize" data-rail-resize role="separator" aria-orientation="vertical" aria-label="Resize rail"></div>
    <header class="rail-head">
      <div class="rail-tabs" role="tablist">
        <button type="button" role="tab" class="${tab === 'agent' ? 'is-active' : ''}" aria-selected="${String(tab === 'agent')}" data-action="rail-tab" data-tab="agent">${icon('sparkle', { size: 14 })}Agent${waiting ? html`<b class="badge" title="Waiting for you">${waiting}</b>` : ''}</button>
        <button type="button" role="tab" class="${tab === 'activity' ? 'is-active' : ''}" aria-selected="${String(tab === 'activity')}" data-action="rail-tab" data-tab="activity">${icon('activity', { size: 14 })}Activity</button>
      </div>
      <button type="button" class="icon-button" data-action="rail-close" aria-label="Hide rail" title="Hide rail (⌘J)">${icon('rail', { size: 16 })}</button>
    </header>
    ${tab === 'agent' ? renderAgent(agent) : renderActivity()}
  </aside>`;
}

function isBusy(agent) {
  const thread = agent.activeThread;
  return Boolean(thread && (thread.turns?.some((turn) => turn.status === 'inProgress') || agent.runningTurns[thread.id]));
}

function threadTitle(thread) {
  const text = String(thread.name || thread.preview || 'Untitled conversation').replace(/^The user attached this exact existing LifeOS [\s\S]*?```\s*/, '');
  return text.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled conversation';
}

function renderAgent(agent) {
  const spec = PROVIDERS[agent.provider];
  const ok = ready(agent);
  const busy = isBusy(agent);
  const status = agent.connection === 'connecting' || agent.connection === 'idle' ? 'Connecting…' : spec.status(agent) || (agent.connection === 'error' ? 'Unavailable' : 'Not signed in');
  const context = store.ui.codexContext;
  return html`<div class="rail-pane agent-pane">
    <div class="agent-bar">
      <div class="segmented tiny agent-switch" role="radiogroup" aria-label="Agent">${Object.entries(PROVIDERS).map(([id, item]) => html`<button type="button" role="radio" class="${agent.provider === id ? 'is-active' : ''}" aria-checked="${String(agent.provider === id)}" data-action="agent-switch" data-provider="${id}">${item.name}${agents[id].pendingRequests.length ? html`<i class="pip"></i>` : ''}</button>`)}</div>
      <span class="${cx('status-dot', ok ? 'is-live' : ['connecting', 'idle'].includes(agent.connection) ? 'is-wait' : 'is-off')}" title="${status}"></span>
      <span class="agent-account" title="${status}">${status}</span>
      <span class="grow"></span>
      <button type="button" class="icon-button tiny" data-action="agent-threads" ${!ok || agent.opening ? 'disabled' : ''} aria-haspopup="menu" aria-label="Conversations" title="Conversations">${icon('list', { size: 14 })}</button>
      <button type="button" class="icon-button tiny" data-action="agent-new" ${!ok || agent.opening ? 'disabled' : ''} aria-label="New conversation" title="New conversation">${icon('plus', { size: 14 })}</button>
    </div>
    ${agent.activeThread ? html`<div class="agent-thread-title" title="${threadTitle(agent.activeThread)}">${threadTitle(agent.activeThread)}</div>` : ''}
    <div class="rail-body scroll-y" data-agent-scroll data-morph-key="${renderKey(agent)}">${raw(renderMessages(agent))}</div>
    ${agent.pendingRequests.length ? html`<div class="agent-requests">${agent.pendingRequests.map((item, index) => renderServerRequest(agent, item, index))}</div>` : ''}
    ${agent.error && ok ? html`<div class="agent-error" role="alert">${icon('warning', { size: 14 })}<span>${agent.error}</span><button type="button" class="icon-button tiny" data-action="agent-error-dismiss" aria-label="Dismiss">${icon('x', { size: 12 })}</button></div>` : ''}
    <form class="composer" data-agent-form>
      ${context ? html`<div class="composer-context" title="This exact record is sent with your next message">
        ${icon(context.kind === 'project' ? 'projects' : context.kind === 'book' ? 'reading' : context.kind === 'idea' ? 'creation' : 'tasks', { size: 13 })}
        <span><b>${context.label}</b><small>${context.typeLabel}${context.meta ? ` · ${context.meta}` : ''}</small></span>
        <button type="button" class="icon-button tiny" data-action="agent-context-remove" aria-label="Remove ${context.label} from context">${icon('x', { size: 12 })}</button>
      </div>` : ''}
      <textarea class="composer-input" name="message" rows="1" placeholder="${ok ? (context ? `Ask ${spec.name} about ${context.label}…` : `Ask ${spec.name} to plan, log or change anything…`) : `${spec.name} is not available`}" ${!ok || busy || agent.sending ? 'disabled' : ''} aria-label="Message ${spec.name}">${agent.draft}</textarea>
      <div class="composer-foot">
        <span class="composer-hint">${busy ? `${spec.name} is working…` : '↵ send · ⇧↵ new line'}</span>
        ${busy
          ? html`<button type="button" class="button small is-danger" data-action="agent-stop">${icon('stop', { size: 12 })}Stop</button>`
          : html`<button type="submit" class="button small is-primary" ${!ok || agent.sending ? 'disabled' : ''}>${agent.sending ? 'Sending…' : html`${icon('send', { size: 12 })}Send`}</button>`}
      </div>
    </form>
  </div>`;
}

// The transcript is rendered as a string and keyed, so morph only revisits it
// when something in it changed (keeps selection and scroll steady while idle).
const messageCache = new Map();
function renderKey(agent) {
  const thread = agent.activeThread;
  const turns = thread?.turns || [];
  const last = turns.at(-1);
  const items = last?.items || [];
  const item = items.at(-1);
  return [agent.provider, agent.connection, ready(agent), thread?.id, turns.length, last?.status, items.length, item?.id, item?.status, String(item?.text || item?.aggregatedOutput || '').length].join('|');
}

function renderMessages(agent) {
  const key = renderKey(agent);
  const cached = messageCache.get(agent.provider);
  if (cached?.key === key) return cached.html;
  const spec = PROVIDERS[agent.provider];
  let out;
  if (agent.connection === 'connecting' || agent.connection === 'idle') out = welcome(`Connecting to ${spec.name}…`, 'Your signed-in account and LifeOS conversations will appear here.');
  else if (!ready(agent)) out = welcome(`${spec.name} needs your sign-in`, spec.signIn(agent), { retry: true });
  else if (!agent.activeThread) out = welcome('Your workspace, with an agent beside it.', `${spec.name} has every LifeOS command and this workspace. Ask it to plan your week, triage the Inbox, log time, or reshape the app.`, { suggestions: true });
  else {
    const items = agent.activeThread.turns?.flatMap((turn) => [...(turn.items || []), ...(turn.status === 'failed' && turn.error?.message ? [{ type: 'turnError', text: turn.error.message }] : [])]) || [];
    out = items.length ? items.map(renderItem).join('') : welcome(`What should ${spec.name} do?`, 'Plan, log, analyze or change LifeOS.', { suggestions: true });
  }
  messageCache.set(agent.provider, { key, html: out });
  return out;
}

const SUGGESTIONS = [
  'Plan my day from today’s tasks and what is overdue',
  'Triage my Inbox: suggest a project, priority and date for each task',
  'How did I spend my time this week compared with my plan?',
  'Create a saved view for high-priority tasks due this week and pin it',
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function welcome(title, body, { suggestions = false, retry = false } = {}) {
  return `<div class="agent-welcome"><div class="agent-mark">${icon('sparkle', { size: 20 })}</div><b>${esc(title)}</b><p>${esc(body)}</p>${retry ? '<button type="button" class="button small" data-action="agent-retry">Retry</button>' : ''}${suggestions ? `<div class="agent-suggestions">${SUGGESTIONS.map((text) => `<button type="button" class="suggestion" data-action="agent-suggest" data-text="${esc(text)}">${esc(text)}</button>`).join('')}</div>` : ''}</div>`;
}

function stripContext(text) {
  // Attached record snapshots are long; show them as a chip in the transcript.
  const match = text.match(/^The user attached this exact existing LifeOS ([a-z ]+) as context\.[\s\S]*?```json\n([\s\S]*?)\n```\n*/);
  if (!match) return { text, context: null };
  let label = match[1];
  try { const parsed = JSON.parse(match[2]); label = parsed.record?.name || parsed.record?.title || label; } catch { /* keep generic */ }
  return { text: text.slice(match[0].length), context: label };
}

function renderItem(item) {
  if (item.type === 'userMessage') {
    const full = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const { text, context } = stripContext(full);
    return `<article class="msg is-user">${context ? `<span class="msg-context">${icon('link', { size: 11 })}${esc(context)}</span>` : ''}<div class="msg-body">${esc(text)}</div></article>`;
  }
  if (item.type === 'agentMessage') {
    return `<article class="msg is-agent"><div class="msg-body markdown-preview">${item.text ? renderMarkdown(item.text) : '<span class="typing"><i></i><i></i><i></i></span>'}</div></article>`;
  }
  if (item.type === 'turnError') return `<div class="msg-error">${icon('warning', { size: 12 })}${esc(item.text)}</div>`;
  if (item.type === 'commandExecution') return step('terminal', 'Ran a command', item.status, [item.command, item.aggregatedOutput].filter(Boolean).join('\n\n'));
  if (item.type === 'fileChange') return step('note', `Changed ${item.changes?.length || 0} file${item.changes?.length === 1 ? '' : 's'}${item.changes?.[0]?.path ? ` · ${item.changes[0].path.split('/').pop()}` : ''}`, item.status, (item.changes || []).map((change) => `${change.kind}: ${change.path}\n${change.diff || ''}`).join('\n\n'));
  if (item.type === 'plan') return step('checklist', 'Plan', null, item.text || '');
  if (item.type === 'reasoning') return (item.summary || []).length ? step('bolt', 'Thinking', null, (item.summary || []).join('\n')) : '';
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const lifeos = item.server === 'lifeos';
    const label = lifeos ? `LifeOS · ${String(item.tool || '').replace(/_/g, '.')}` : `${item.server ? `${item.server} · ` : ''}${item.tool || 'tool'}`;
    return step(lifeos ? 'layers' : 'bolt', label, item.status, compact(item.result || item.error || item.arguments));
  }
  if (item.type === 'contextCompaction') return '<div class="msg-divider">Context compacted</div>';
  return '';
}

function step(iconName, label, status, body) {
  const text = String(body || '').slice(0, 6000);
  const tone = status === 'failed' || status === 'declined' ? ' is-failed' : status === 'inProgress' ? ' is-running' : '';
  return `<details class="msg-step${tone}" data-keep-open><summary>${icon(iconName, { size: 12 })}<span>${esc(label)}</span>${status && status !== 'completed' ? `<small>${esc(status === 'inProgress' ? 'running' : status)}</small>` : ''}</summary>${text ? `<pre>${esc(text)}</pre>` : ''}</details>`;
}

function compact(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function renderServerRequest(agent, item, index) {
  const params = item.params || {};
  const name = PROVIDERS[agent.provider].name;
  if (item.method === 'item/tool/requestUserInput') {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    return html`<form class="request-card" data-request-form="${index}" data-provider="${agent.provider}">
      <div class="request-kicker">${icon('info', { size: 13 })}${name} is asking</div>
      ${questions.map((question) => html`<fieldset><legend>${question.question || question.header || 'Input required'}</legend>
        ${Array.isArray(question.options) && question.options.length ? question.options.map((option, optionIndex) => html`<label class="request-option"><input type="${question.multiSelect ? 'checkbox' : 'radio'}" name="${question.id}" value="${option.label}" ${optionIndex === 0 && !question.multiSelect ? 'checked' : ''}><span><b>${option.label}</b>${option.description ? html`<small>${option.description}</small>` : ''}</span></label>`)
          : html`<input class="input" name="${question.id}" type="${question.isSecret ? 'password' : 'text'}" autocomplete="off">`}
      </fieldset>`)}
      <div class="request-actions"><button type="submit" class="button small is-primary">Answer</button></div>
    </form>`;
  }
  const command = params.command || params.reason || (params.grantRoot ? `Write access: ${params.grantRoot}` : `${name} needs permission to continue.`);
  return html`<section class="request-card is-approval">
    <div class="request-kicker">${icon('warning', { size: 13 })}${name} wants to ${params.toolName ? html`use <b>${params.toolName}</b>` : 'continue'}</div>
    <pre>${Array.isArray(command) ? command.join(' ') : command}</pre>
    ${params.reason && params.command ? html`<p class="muted small">${params.reason}</p>` : ''}
    <div class="request-actions">
      <button type="button" class="button small ghost" data-action="agent-decide" data-provider="${agent.provider}" data-index="${index}" data-decision="decline">Decline</button>
      <button type="button" class="button small" data-action="agent-decide" data-provider="${agent.provider}" data-index="${index}" data-decision="acceptForSession">Allow for session</button>
      <button type="button" class="button small is-primary" data-action="agent-decide" data-provider="${agent.provider}" data-index="${index}" data-decision="accept">Allow once</button>
    </div>
  </section>`;
}

// ——— Activity —————————————————————————————————————————————————————————
const SOURCE = {
  app: { label: 'You', icon: 'user' },
  cli: { label: 'CLI', icon: 'terminal' },
  mcp: { label: 'Agent', icon: 'agent' },
  sdk: { label: 'Script', icon: 'code' },
  http: { label: 'HTTP', icon: 'link' },
  capture: { label: 'Capture', icon: 'bolt' },
  codex: { label: 'Codex', icon: 'sparkle' },
};

const TARGET_ICONS = { task: 'tasks', project: 'projects', book: 'reading', idea: 'creation', entry: 'clock', milestone: 'star' };

function renderActivity() {
  if (!activity.loaded) queueMicrotask(loadActivity);
  const filter = activity.filter;
  const entries = activity.entries.filter((entry) => filter === 'all' || (filter === 'agents' ? entry.source !== 'app' : entry.source === 'app'));
  const days = new Map();
  for (const entry of entries) {
    const day = new Date(entry.at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(entry);
  }
  return html`<div class="rail-pane activity-pane">
    <div class="agent-bar"><div class="segmented tiny" role="group" aria-label="Show">${[['all', 'All'], ['agents', 'Agents'], ['you', 'You']].map(([id, label]) => html`<button type="button" class="${filter === id ? 'is-active' : ''}" data-action="activity-filter" data-value="${id}" aria-pressed="${String(filter === id)}">${label}</button>`)}</div><span class="grow"></span><button type="button" class="icon-button tiny" data-action="activity-refresh" aria-label="Refresh">${icon('refresh', { size: 13 })}</button></div>
    <div class="rail-body scroll-y">
      ${!activity.loaded ? html`<p class="muted small pad">Loading…</p>` : entries.length ? [...days.entries()].map(([day, items]) => html`<section class="activity-day"><h4>${day}</h4><ol>${items.map(renderEntry)}</ol></section>`)
        : html`<div class="agent-welcome"><div class="agent-mark">${icon('activity', { size: 20 })}</div><b>No changes yet</b><p>Every change — yours, Codex’s, Claude’s, or any agent’s through MCP, the CLI or the SDK — is recorded here and can be undone.</p></div>`}
    </div>
  </div>`;
}

function renderEntry(entry) {
  const source = SOURCE[entry.source] || { label: entry.source || 'Unknown', icon: 'circle' };
  const who = entry.actor && entry.actor !== 'app' ? entry.actor : source.label;
  const reverted = Boolean(entry.undoneBy);
  const isUndo = Boolean(entry.undoOf);
  const targets = (entry.targets || []).slice(0, 3);
  return html`<li class="${cx('activity-entry', reverted && 'is-undone', entry.source !== 'app' && 'is-agent')}" data-key="act-${entry.id}">
    <span class="activity-icon" title="${source.label}">${icon(isUndo ? 'undo' : source.icon, { size: 13 })}</span>
    <div class="activity-main">
      <p>${entry.label || entry.command}</p>
      <small><b>${who}</b> · <time datetime="${entry.at}" title="${new Date(entry.at).toLocaleString()}">${timeAgo(entry.at)}</time>${reverted ? ' · undone' : ''}</small>
      ${targets.length ? html`<div class="activity-targets">${targets.map((target) => html`<button type="button" class="link-chip" data-action="activity-open" data-kind="${target.kind}" data-id="${target.id}" title="Open ${target.kind}">${icon(TARGET_ICONS[target.kind] || 'dot', { size: 11 })}${String(target.label).slice(0, 48)}</button>`)}</div>` : ''}
    </div>
    ${!reverted && !isUndo ? html`<button type="button" class="button ghost tiny activity-undo" data-action="activity-undo" data-id="${entry.id}" title="Undo this change">${icon('undo', { size: 12 })}Undo</button>` : ''}
  </li>`;
}

export async function loadActivity() {
  if (activity.loading) return;
  activity.loading = true;
  try {
    const body = await request('/api/history?limit=120');
    activity.entries = body.entries || [];
  } catch { /* shown as empty */ }
  activity.loaded = true;
  activity.loading = false;
  render();
}

export function onHistoryChanged() {
  if (store.prefs.railOpen && store.prefs.railTab === 'activity') loadActivity();
  else activity.loaded = false;
}

// ——— Transport (same shapes for both agents) ——————————————————————————
export async function bootstrapAgent(provider, { refresh = false } = {}) {
  const agent = agents[provider];
  if (agent.started && !refresh) return;
  agent.started = true;
  agent.connection = 'connecting';
  agent.error = null;
  render();
  try {
    const body = await request(api(agent, `bootstrap${refresh ? '?refresh=1' : ''}`));
    agent.connection = body.connection.status;
    if (body.connection.status === 'error') agent.error = body.connection.detail;
    agent.account = body.account;
    agent.threads = body.threads || [];
    agent.pendingRequests = body.pendingRequests || [];
    let stored = null;
    try { stored = localStorage.getItem(PROVIDERS[provider].threadKey); } catch { /* optional */ }
    const selected = agent.threads.find((thread) => thread.id === stored);
    if (selected && ready(agent)) await openThread(agent, selected.id);
  } catch (error) {
    agent.connection = 'error';
    agent.error = error.message;
  }
  render();
}

async function refreshThreads(agent) {
  try {
    const body = await request(api(agent, 'bootstrap'));
    agent.connection = body.connection.status;
    agent.account = body.account;
    agent.threads = body.threads || agent.threads;
  } catch { /* a completed turn stays visible */ }
  render();
}

async function openThread(agent, threadId) {
  agent.opening = true;
  agent.error = null;
  render();
  try {
    const body = await postJson(api(agent, 'thread/read'), { threadId });
    agent.activeThread = body.thread;
    try { localStorage.setItem(PROVIDERS[agent.provider].threadKey, body.thread.id); } catch { /* optional */ }
    const running = [...(body.thread.turns || [])].reverse().find((turn) => turn.status === 'inProgress');
    if (running) agent.runningTurns[body.thread.id] = running.id;
    else delete agent.runningTurns[body.thread.id];
    agent.stickToBottom = true;
  } catch (error) {
    agent.error = error.message;
  } finally {
    agent.opening = false;
    render();
    scrollToEnd(agent);
  }
}

async function newThread(agent) {
  agent.opening = true;
  agent.error = null;
  render();
  try {
    const body = await postJson(api(agent, 'thread/start'), {});
    agent.activeThread = body.thread;
    agent.threads = [body.thread, ...agent.threads.filter((thread) => thread.id !== body.thread.id)];
    try { localStorage.setItem(PROVIDERS[agent.provider].threadKey, body.thread.id); } catch { /* optional */ }
    return body.thread;
  } catch (error) {
    agent.error = error.message;
    return null;
  } finally {
    agent.opening = false;
    render();
    requestAnimationFrame(() => document.querySelector('.composer-input')?.focus());
  }
}

export async function sendMessage(explicit = null, agent = current()) {
  const draft = String(explicit ?? agent.draft).trim();
  const context = store.ui.codexContext;
  const text = messageWithContext(context, draft);
  if (!text || agent.sending) return;
  agent.sending = true;
  agent.error = null;
  agent.draft = '';
  store.ui.codexContext = null;
  agent.stickToBottom = true;
  render();
  try {
    const thread = agent.activeThread || await newThread(agent);
    if (!thread) throw new Error(agent.error || `Could not start a ${PROVIDERS[agent.provider].name} conversation.`);
    const body = await postJson(api(agent, 'turn/start'), { threadId: thread.id, message: text });
    agent.activeThread = upsertTurn(agent.activeThread || thread, body.turn);
    agent.runningTurns[thread.id] = body.turn.id;
  } catch (error) {
    agent.error = error.message;
    agent.draft = draft;
    store.ui.codexContext = context;
  } finally {
    agent.sending = false;
    render();
    scrollToEnd(agent);
  }
}

// Used by the palette and agents' "ask" entry points.
export function askAgent(text, provider = providerId()) {
  setPref('railOpen', true);
  setPref('railTab', 'agent');
  setPref('railAgent', provider);
  const agent = agents[provider];
  if (!agent.started) {
    agent.draft = text || agent.draft;
    bootstrapAgent(provider).then(() => { if (text && ready(agent) && agent.draft === text) void sendMessage(text, agent); });
    return;
  }
  if (text && ready(agent) && !isBusy(agent)) { void sendMessage(text, agent); return; }
  agent.draft = text || agent.draft;
  render();
  requestAnimationFrame(() => document.querySelector('.composer-input')?.focus());
}
export const askCodex = (text) => askAgent(text, 'codex');

async function interrupt(agent) {
  const threadId = agent.activeThread?.id;
  const turnId = threadId ? agent.runningTurns[threadId] || [...(agent.activeThread.turns || [])].reverse().find((turn) => turn.status === 'inProgress')?.id : null;
  if (!threadId || !turnId) return;
  try {
    await postJson(api(agent, 'turn/interrupt'), { threadId, turnId });
  } catch (error) {
    agent.error = error.message;
    render();
  }
}

async function respond(agent, item, result) {
  try {
    await postJson(api(agent, 'request/respond'), { id: item.id, result });
    agent.pendingRequests = agent.pendingRequests.filter((candidate) => candidate.id !== item.id);
  } catch (error) {
    agent.error = error.message;
  }
  render();
}

async function decide(agent, index, decision) {
  const item = agent.pendingRequests[index];
  if (!item) return;
  if (item.method === 'item/permissions/requestApproval') {
    const permissions = Object.fromEntries(Object.entries(item.params.permissions || {}).filter(([, value]) => value !== null));
    await respond(agent, item, decision === 'decline' ? { permissions: {}, scope: 'turn' } : { permissions, scope: decision === 'acceptForSession' ? 'session' : 'turn' });
    return;
  }
  await respond(agent, item, { decision });
}

export function submitRequestForm(form) {
  const agent = agents[form.dataset.provider] || current();
  const item = agent.pendingRequests[Number(form.dataset.requestForm)];
  if (!item) return;
  const data = new FormData(form);
  const answers = Object.fromEntries((item.params.questions || []).map((question) => [question.id, { answers: data.getAll(question.id).map(String).filter(Boolean) }]));
  void respond(agent, item, { answers });
}

export function handleAgentEvent(provider, event) {
  const agent = agents[provider];
  if (event.type === 'connection') {
    agent.connection = event.status;
    if (event.status === 'error') agent.error = event.detail || `${PROVIDERS[provider].name} connection failed.`;
    render();
    return;
  }
  if (event.type === 'serverRequest') {
    if (!agent.pendingRequests.some((item) => item.id === event.request.id)) agent.pendingRequests.push(event.request);
    // A question or approval must reach the person: bring it into view.
    if (!store.prefs.railOpen || store.prefs.railTab !== 'agent' || providerId() !== provider) {
      setPref('railOpen', true);
      setPref('railTab', 'agent');
      setPref('railAgent', provider);
    }
    render();
    return;
  }
  if (event.type !== 'notification') return;
  const { method, params } = event;
  const threadId = typeof params.threadId === 'string' ? params.threadId : null;
  const active = agent.activeThread?.id === threadId;
  if (method === 'turn/started' && threadId && params.turn) {
    agent.runningTurns[threadId] = params.turn.id;
    if (active) agent.activeThread = upsertTurn(agent.activeThread, params.turn);
  } else if ((method === 'item/started' || method === 'item/completed') && threadId && params.turnId && params.item) {
    if (active) agent.activeThread = upsertItem(agent.activeThread, params.turnId, params.item);
    if (method === 'item/completed' && ['mcpToolCall', 'commandExecution', 'dynamicToolCall'].includes(params.item.type)) scheduleRefresh(150);
  } else if ((method === 'item/agentMessage/delta' || method === 'item/commandExecution/outputDelta') && threadId && params.turnId && params.itemId && typeof params.delta === 'string') {
    if (active) agent.activeThread = appendDelta(agent.activeThread, params.turnId, params.itemId, method === 'item/agentMessage/delta' ? 'text' : 'aggregatedOutput', params.delta);
  } else if (method === 'turn/completed' && threadId && params.turn) {
    delete agent.runningTurns[threadId];
    if (active) agent.activeThread = upsertTurn(agent.activeThread, params.turn);
    scheduleRefresh(100);
    void refreshThreads(agent);
  } else if (method === 'serverRequest/resolved' && params.requestId !== undefined) {
    agent.pendingRequests = agent.pendingRequests.filter((item) => item.id !== params.requestId);
  } else if (method === 'error') {
    agent.error = params.error?.message || `${PROVIDERS[provider].name} reported an error.`;
    if (/not signed in/i.test(agent.error)) agent.account = { ...(agent.account || {}), loggedIn: false };
  }
  render();
  if (active) scrollToEnd(agent, { onlyIfPinned: true });
}

function upsertTurn(thread, turn) {
  const turns = [...(thread.turns || [])];
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  if (index === -1) turns.push(turn);
  else turns[index] = { ...turns[index], ...turn, items: turn.items?.length ? turn.items : turns[index].items };
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

function appendDelta(thread, turnId, itemId, field, delta) {
  const turn = (thread.turns || []).find((candidate) => candidate.id === turnId);
  const existing = turn?.items?.find((candidate) => candidate.id === itemId);
  const item = existing
    ? { ...existing, [field]: `${String(existing[field] || '')}${delta}` }
    : { id: itemId, type: field === 'text' ? 'agentMessage' : 'commandExecution', [field]: delta };
  return upsertItem(thread, turnId, item);
}

function scrollToEnd(agent, { onlyIfPinned = false } = {}) {
  if (onlyIfPinned && !agent.stickToBottom) return;
  if (agent !== current()) return;
  requestAnimationFrame(() => {
    const body = document.querySelector('[data-agent-scroll]');
    if (body) body.scrollTop = body.scrollHeight;
  });
}

export function onRailScroll(element) {
  current().stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}

// ——— Input & actions ——————————————————————————————————————————————————
export function onComposerInput(element) {
  current().draft = element.value;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
}

export function onComposerKey(event) {
  if (!event.target.matches?.('.composer-input')) return false;
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void sendMessage();
    return true;
  }
  if (event.key === 'Escape') { event.target.blur(); return true; }
  return false;
}

export function startRailResize(event) {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = store.prefs.railWidth;
  const widthAt = (x) => Math.max(300, Math.min(640, startWidth + (startX - x)));
  const move = (moveEvent) => document.documentElement.style.setProperty('--rail-w', `${widthAt(moveEvent.clientX)}px`);
  const up = (upEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('is-resizing');
    setPref('railWidth', widthAt(upEvent.clientX));
  };
  document.body.classList.add('is-resizing');
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

export const railActions = {
  'rail-tab': (el) => {
    setPref('railTab', el.dataset.tab);
    if (el.dataset.tab === 'activity') loadActivity();
    else requestAnimationFrame(() => document.querySelector('.composer-input')?.focus());
  },
  'rail-close': () => setPref('railOpen', false),
  'agent-switch': (el) => {
    setPref('railAgent', el.dataset.provider);
    bootstrapAgent(el.dataset.provider);
    requestAnimationFrame(() => document.querySelector('.composer-input')?.focus());
  },
  'agent-retry': () => bootstrapAgent(providerId(), { refresh: true }),
  'agent-new': () => newThread(current()),
  'agent-threads': async (el) => {
    const agent = current();
    const { openMenu } = await import('./ui/menu.js');
    await refreshThreads(agent);
    const stamp = (value) => (value ? timeAgo(new Date(value < 1e12 ? value * 1000 : value).toISOString()) : '');
    openMenu({
      anchor: el, width: 300, align: 'end', title: `${PROVIDERS[agent.provider].name} conversations`, search: agent.threads.length > 6 ? 'Search conversations' : null,
      items: agent.threads.length ? agent.threads.map((thread) => ({ label: threadTitle(thread), icon: thread.id === agent.activeThread?.id ? 'check' : 'sparkle', hint: stamp(thread.updatedAt), run: () => openThread(agent, thread.id) }))
        : [{ type: 'note', label: 'No LifeOS conversations yet.' }],
    });
  },
  'agent-stop': () => interrupt(current()),
  'agent-error-dismiss': () => { current().error = null; render(); },
  'agent-context-remove': () => { store.ui.codexContext = null; render(); },
  'agent-decide': (el) => decide(agents[el.dataset.provider] || current(), Number(el.dataset.index), el.dataset.decision),
  'agent-suggest': (el) => {
    current().draft = el.dataset.text;
    render();
    requestAnimationFrame(() => { const input = document.querySelector('.composer-input'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); });
  },
  'activity-filter': (el) => { activity.filter = el.dataset.value; render(); },
  'activity-refresh': () => loadActivity(),
  'activity-undo': async (el) => { await undo(el.dataset.id); loadActivity(); },
  'activity-open': (el) => import('./actions.js').then(({ openRecord }) => openRecord(el.dataset.kind, el.dataset.id)),
};
