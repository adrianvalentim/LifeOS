// Claude Code in the LifeOS rail, through the installed and signed-in `claude`
// CLI (its stream-json protocol), never an API key. Conversations run in this
// workspace with LifeOS's MCP tools pre-allowed (every write they make is
// journaled and undoable); any other gated tool — shell, file edits, web —
// waits for the person's decision in the rail. Events are translated into the
// same thread/turn/item shapes the Codex bridge emits, so the rail renders
// both agents the same way.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { DEFAULT_STORE_PATH, ROOT_DIR } from './lifeos-storage.mjs';

const execFileAsync = promisify(execFile);
const IDLE_MS = 15 * 60 * 1000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const NOT_SIGNED_IN = 'Claude Code is not signed in. Press Connect in the Agent panel, or run “claude auth login” in Terminal.';

export const CLAUDE_RAIL_INSTRUCTIONS = `You are Claude Code running inside the LifeOS rail — the person's local-first personal almanac (projects, tasks, time, reading, creation, milestones).

Work in the LifeOS workspace (your cwd). AGENTS.md is the compact project map and is authoritative. You have every capability the person has in the app through one command layer, exposed to you as the "lifeos" MCP tools (mcp__lifeos__*): start with overview, search or commands.list; tasks.create, time.log, projects.update, views.create, workspace.update and so on. Prefer those tools to reading application source for ordinary requests.
- Every LifeOS write is journaled and undoable (history.undo); it appears in the app's Activity with your name.
- Show what you changed in the open window with ui.open or ui.navigate.
- The person can reshape the app with you: saved task views, sidebar order and visibility, start screen, theme and pins.
- Preserve the person's own words in rawInput when logging time.
Inspect only the relevant files when the person asks for a code or schema change; new capabilities belong in src/commands/ so they reach the UI palette, CLI, SDK and MCP at once. Shell commands, file edits and web access ask the person for approval in the rail.`;

export function claudeExecutableCandidates(env = process.env, home = os.homedir()) {
  return [
    env.CLAUDE_EXECUTABLE,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.npm-global', 'bin', 'claude'),
  ].filter(Boolean);
}

// The rail's child must not inherit an embedding Claude session's identity
// (e.g. when LifeOS itself was started from Claude Code).
export function cleanClaudeEnv(env = process.env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT' || key.startsWith('CLAUDE_AGENT_SDK')
      || (key.startsWith('CLAUDE_CODE_') && key !== 'CLAUDE_CODE_TMPDIR')) delete next[key];
  }
  return next;
}

export function projectSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export class ClaudeCodeAgent {
  constructor(options = {}) {
    this.cwd = path.resolve(options.cwd || ROOT_DIR);
    this.indexPath = options.indexPath || path.join(path.dirname(DEFAULT_STORE_PATH), 'claude-rail-sessions.json');
    this.env = cleanClaudeEnv(options.env || process.env);
    this.configDir = this.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    this.candidates = options.executable ? [options.executable] : claudeExecutableCandidates(this.env);
    this.extraArgs = options.extraArgs || [];
    this.mcpServer = options.mcpServer ?? { command: process.execPath, args: [path.join(ROOT_DIR, 'scripts', 'lifeos-mcp.mjs')], env: { LIFEOS_ACTOR: 'Claude', LIFEOS_DATA_DIR: path.dirname(DEFAULT_STORE_PATH) } };
    this.listeners = new Set();
    this.sessions = new Map();        // threadId → live process state
    this.serverRequests = new Map();  // request id → { request, threadId, raw }
    this.executable = null;
    this.accountCache = null;
    this.login = null;                // { child, url, cancelled, timer } while a browser sign-in is pending
  }

  subscribe(listener) {
    this.listeners.add(listener);
    for (const entry of this.serverRequests.values()) listener({ type: 'serverRequest', request: entry.request });
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  notify(method, params) {
    this.emit({ type: 'notification', method, params });
  }

  resolveExecutable() {
    if (this.executable) return this.executable;
    const found = this.candidates.find((candidate) => existsSync(candidate));
    if (!found) throw new Error('Claude Code is not installed. Install it (https://claude.com/claude-code) or set CLAUDE_EXECUTABLE.');
    this.executable = found;
    return found;
  }

  async account({ refresh = false } = {}) {
    if (!refresh && this.accountCache && Date.now() - this.accountCache.at < 60_000) return this.accountCache.value;
    const executable = this.resolveExecutable();
    const read = (stdout) => {
      const status = JSON.parse(stdout);
      return {
        loggedIn: Boolean(status.loggedIn),
        authMethod: status.authMethod || null,
        email: status.email || status.emailAddress || null,
        subscriptionType: status.subscriptionType || null,
      };
    };
    let value;
    try {
      value = read((await execFileAsync(executable, ['auth', 'status', '--json'], { env: this.env, timeout: 15_000 })).stdout);
    } catch (error) {
      // Signed out, `auth status` exits non-zero but still says so on stdout.
      try { value = read(error.stdout); } catch { value = { loggedIn: false, authMethod: null, error: error.message }; }
    }
    this.accountCache = { at: Date.now(), value };
    return value;
  }

  // ——— Sign-in ———
  // `claude auth login` opens the person's browser itself and finishes when the
  // browser reaches its local callback; if the browser shows a code instead, it
  // reads that code from stdin. LifeOS never sees a password or token.
  async startLogin() {
    if (this.login) return this.loginState();
    const executable = this.resolveExecutable();
    const child = spawn(executable, ['auth', 'login', '--claudeai'], { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const login = { child, url: null, cancelled: false, output: [], timer: setTimeout(() => child.kill('SIGTERM'), LOGIN_TIMEOUT_MS) };
    this.login = login;
    child.stdin.on('error', () => undefined);
    const onLine = (line) => {
      const text = line.trim();
      if (!text) return;
      login.output.push(text);
      if (login.output.length > 10) login.output.shift();
      const url = text.match(/https:\/\/\S+/)?.[0];
      if (url && !login.url) {
        login.url = url;
        this.emit({ type: 'login', status: 'waiting', url });
      }
    };
    createInterface({ input: child.stdout }).on('line', onLine);
    createInterface({ input: child.stderr }).on('line', onLine);
    let finished = false;
    const finish = async (code, failure) => {
      if (finished) return;
      finished = true;
      clearTimeout(login.timer);
      if (this.login === login) this.login = null;
      if (login.cancelled) return this.emit({ type: 'login', status: 'cancelled' });
      const account = await this.account({ refresh: true });
      if (account.loggedIn) return this.emit({ type: 'login', status: 'signedIn', account });
      const reason = failure || login.output.filter((line) => !/^(opening browser|if the browser|paste code)/i.test(line)).pop();
      this.emit({ type: 'login', status: 'failed', error: reason || `Sign-in did not finish (claude exited with status ${code}).` });
    };
    child.on('error', (error) => void finish(null, `Could not start Claude Code: ${error.message}`));
    child.on('close', (code) => void finish(code));
    this.emit({ type: 'login', status: 'waiting', url: null });
    return this.loginState();
  }

  async submitLoginCode(code) {
    const text = String(code || '').trim();
    if (!this.login) throw new Error('No sign-in is waiting for a code. Press Connect to start one.');
    if (!text || /\s/.test(text) || text.length > 2048) throw new Error('Paste the code exactly as the browser shows it.');
    await new Promise((resolve, reject) => this.login.child.stdin.write(`${text}\n`, (error) => (error ? reject(error) : resolve())));
  }

  cancelLogin() {
    if (!this.login) return;
    this.login.cancelled = true;
    this.login.child.kill('SIGTERM');
  }

  loginState() {
    return this.login ? { status: 'waiting', url: this.login.url } : null;
  }

  // ——— Conversation index (only conversations started from the rail) ———
  async readIndex() {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8'));
      return Array.isArray(parsed.sessions) ? parsed : { sessions: [] };
    } catch {
      return { sessions: [] };
    }
  }

  async writeIndex(index) {
    await mkdir(path.dirname(this.indexPath), { recursive: true });
    const temp = `${this.indexPath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.indexPath);
  }

  async updateIndex(id, patch) {
    const index = await this.readIndex();
    const current = index.sessions.find((session) => session.id === id);
    if (current) Object.assign(current, patch);
    else index.sessions.unshift({ id, ...patch });
    index.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    await this.writeIndex(index);
    return index.sessions.find((session) => session.id === id);
  }

  async listThreads() {
    const index = await this.readIndex();
    return index.sessions.map((session) => ({ id: session.id, name: session.name || null, preview: session.preview || '', createdAt: session.createdAt, updatedAt: session.updatedAt }));
  }

  async startThread() {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.updateIndex(id, { name: null, preview: '', createdAt: now, updatedAt: now, started: false });
    return { id, name: null, preview: '', turns: [] };
  }

  async readThread(threadId) {
    const index = await this.readIndex();
    const meta = index.sessions.find((session) => session.id === threadId);
    if (!meta) throw new Error(`Unknown Claude conversation: ${threadId}`);
    const turns = meta.started ? await this.readTranscript(threadId) : [];
    const live = this.sessions.get(threadId)?.turn;
    if (live && !turns.some((turn) => turn.id === live.id)) {
      // The transcript on disk trails the live turn; show the live one.
      turns.push(serializeTurn(live));
    }
    return { id: threadId, name: meta.name, preview: meta.preview, turns };
  }

  async transcriptPath(threadId) {
    const direct = path.join(this.configDir, 'projects', projectSlug(this.cwd), `${threadId}.jsonl`);
    if (existsSync(direct)) return direct;
    try {
      for (const dir of await readdir(path.join(this.configDir, 'projects'))) {
        const candidate = path.join(this.configDir, 'projects', dir, `${threadId}.jsonl`);
        if (existsSync(candidate)) return candidate;
      }
    } catch { /* no projects yet */ }
    return null;
  }

  async readTranscript(threadId) {
    const file = await this.transcriptPath(threadId);
    if (!file) return [];
    return parseTranscript(await readFile(file, 'utf8'));
  }

  // ——— Turns ———
  async startTurn(threadId, text) {
    const index = await this.readIndex();
    const meta = index.sessions.find((session) => session.id === threadId);
    if (!meta) throw new Error(`Unknown Claude conversation: ${threadId}`);
    const account = await this.account();
    if (!account.loggedIn) throw new Error(NOT_SIGNED_IN);
    let session = this.sessions.get(threadId);
    if (session?.turn) throw new Error('Claude is still working on the previous message.');
    if (!session) session = await this.spawnSession(threadId, { resume: Boolean(meta.started) });
    const turn = { id: `turn_${randomUUID()}`, status: 'inProgress', error: null, items: new Map(), textByMessage: new Map() };
    const userItem = { id: `user_${randomUUID()}`, type: 'userMessage', content: [{ type: 'text', text }] };
    turn.items.set(userItem.id, userItem);
    session.turn = turn;
    clearTimeout(session.idleTimer);
    await this.write(session, { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: threadId });
    const preview = displayText(text).replace(/\s+/g, ' ').trim().slice(0, 140);
    await this.updateIndex(threadId, { started: true, updatedAt: Math.floor(Date.now() / 1000), ...(meta.preview ? {} : { preview }) });
    const serialized = serializeTurn(turn);
    this.notify('turn/started', { threadId, turn: serialized });
    return serialized;
  }

  async interruptTurn(threadId) {
    const session = this.sessions.get(threadId);
    if (!session?.turn) return;
    await this.controlRequest(session, { subtype: 'interrupt' }).catch(() => undefined);
  }

  async respondToServerRequest(id, result) {
    const entry = this.serverRequests.get(id);
    if (!entry) throw new Error('That request is no longer waiting.');
    const session = this.sessions.get(entry.threadId);
    this.serverRequests.delete(id);
    if (!session) return;
    const { raw } = entry;
    const input = raw.request.input || {};
    let response;
    if (entry.request.method === 'item/tool/requestUserInput') {
      const answers = {};
      for (const question of entry.questions) {
        const values = result?.answers?.[question.id]?.answers || [];
        answers[question.question] = values.join(', ');
      }
      response = { behavior: 'allow', updatedInput: { ...input, answers } };
    } else if (result?.decision === 'accept' || result?.decision === 'acceptForSession') {
      response = { behavior: 'allow', updatedInput: input };
      if (result.decision === 'acceptForSession' && Array.isArray(raw.request.permission_suggestions)) response.updatedPermissions = raw.request.permission_suggestions;
    } else {
      response = { behavior: 'deny', message: 'The person declined this in the LifeOS rail.' };
    }
    await this.write(session, { type: 'control_response', response: { subtype: 'success', request_id: raw.request_id, response } });
    this.notify('serverRequest/resolved', { threadId: entry.threadId, requestId: id });
  }

  async stop() {
    this.cancelLogin();
    for (const session of this.sessions.values()) this.endSession(session);
    this.sessions.clear();
  }

  // ——— Process ———
  async spawnSession(threadId, { resume }) {
    const executable = this.resolveExecutable();
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', 'manual',
      '--allowedTools', 'mcp__lifeos',
      '--append-system-prompt', CLAUDE_RAIL_INSTRUCTIONS,
      ...(resume ? ['--resume', threadId] : ['--session-id', threadId]),
      ...(this.mcpServer ? ['--mcp-config', JSON.stringify({ mcpServers: { lifeos: this.mcpServer } })] : []),
      ...this.extraArgs,
    ];
    const child = spawn(executable, args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { threadId, child, turn: null, control: new Map(), idleTimer: 0, stderr: [] };
    this.sessions.set(threadId, session);
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(session, line));
    createInterface({ input: child.stderr }).on('line', (line) => { session.stderr.push(line); if (session.stderr.length > 20) session.stderr.shift(); });
    child.on('error', (error) => this.failSession(session, error.message));
    // A write racing Claude's exit fails with EPIPE. The write's callback and the
    // exit handler report it; unhandled, it would take the whole server down.
    child.stdin.on('error', () => undefined);
    child.on('exit', (code, signal) => {
      if (this.sessions.get(threadId) === session) this.sessions.delete(threadId);
      for (const pending of session.control.values()) pending.reject(new Error('Claude Code exited.'));
      if (session.turn) this.finishTurn(session, { status: signal ? 'interrupted' : 'failed', error: session.stderr.at(-1) || `Claude Code exited (${signal || code}).` });
      for (const [id, entry] of this.serverRequests) if (entry.threadId === threadId) { this.serverRequests.delete(id); this.notify('serverRequest/resolved', { threadId, requestId: id }); }
    });
    await this.controlRequest(session, { subtype: 'initialize', hooks: null }, 30_000);
    return session;
  }

  write(session, message) {
    if (!session.child.stdin.writable) return Promise.reject(new Error('Claude Code is not running.'));
    return new Promise((resolve, reject) => session.child.stdin.write(`${JSON.stringify(message)}\n`, 'utf8', (error) => (error ? reject(error) : resolve())));
  }

  controlRequest(session, request, timeoutMs = 15_000) {
    const requestId = `lifeos_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { session.control.delete(requestId); reject(new Error(`Claude Code did not answer ${request.subtype}.`)); }, timeoutMs);
      session.control.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.write(session, { type: 'control_request', request_id: requestId, request }).catch((error) => { clearTimeout(timer); session.control.delete(requestId); reject(error); });
    });
  }

  endSession(session) {
    clearTimeout(session.idleTimer);
    try { session.child.stdin.end(); } catch { /* already closed */ }
    setTimeout(() => { if (session.child.exitCode === null) session.child.kill(); }, 3000).unref?.();
  }

  failSession(session, message) {
    if (session.turn) this.finishTurn(session, { status: 'failed', error: message });
    this.notify('error', { threadId: session.threadId, error: { message } });
  }

  handleLine(session, line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const { threadId } = session;
    if (message.type === 'control_response') {
      const response = message.response || {};
      const pending = session.control.get(response.request_id);
      if (!pending) return;
      session.control.delete(response.request_id);
      if (response.subtype === 'error') pending.reject(new Error(response.error || 'Claude Code refused the request.'));
      else pending.resolve(response.response);
      return;
    }
    if (message.type === 'control_request') {
      this.handleControlRequest(session, message);
      return;
    }
    if (message.parent_tool_use_id) return; // sub-agent traffic stays inside its tool call
    const turn = session.turn;
    if (!turn) return;
    if (message.type === 'stream_event') this.handleStreamEvent(session, message.event || {});
    else if (message.type === 'assistant') this.handleAssistant(session, message.message || {});
    else if (message.type === 'user') this.handleToolResults(session, message.message || {});
    else if (message.type === 'result') {
      const failed = message.is_error || message.subtype?.startsWith('error');
      let error = failed ? String(message.result || message.subtype || 'Claude Code reported an error.') : null;
      if (failed && /authenticat|oauth|log ?in/i.test(error)) { this.accountCache = null; error = NOT_SIGNED_IN; }
      if (failed) this.notify('error', { threadId, error: { message: error } });
      this.finishTurn(session, { status: failed ? 'failed' : 'completed', error });
    }
  }

  handleControlRequest(session, message) {
    const request = message.request || {};
    if (request.subtype !== 'can_use_tool') {
      void this.write(session, { type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: `LifeOS does not handle ${request.subtype}.` } }).catch(() => undefined);
      return;
    }
    const id = `claude:${message.request_id}`;
    const input = request.input || {};
    let entry;
    if (request.tool_name === 'AskUserQuestion' && Array.isArray(input.questions)) {
      const questions = input.questions.map((question, index) => ({ id: `q${index}`, question: question.question, header: question.header, options: question.options, multiSelect: question.multiSelect }));
      entry = { threadId: session.threadId, raw: message, questions, request: { id, provider: 'claude', method: 'item/tool/requestUserInput', params: { threadId: session.threadId, questions } } };
    } else {
      entry = {
        threadId: session.threadId,
        raw: message,
        request: { id, provider: 'claude', method: 'claude/canUseTool', params: { threadId: session.threadId, toolName: request.tool_name, command: describeToolUse(request.tool_name, input), reason: request.decision_reason || request.description || null, input } },
      };
    }
    this.serverRequests.set(id, entry);
    this.emit({ type: 'serverRequest', request: entry.request });
  }

  handleStreamEvent(session, event) {
    const turn = session.turn;
    if (event.type === 'message_start') {
      session.messageId = event.message?.id || `msg_${randomUUID()}`;
      return;
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      const id = `${session.messageId}:${event.index}`;
      const list = turn.textByMessage.get(session.messageId) || [];
      list.push(id);
      turn.textByMessage.set(session.messageId, list);
      const item = { id, type: 'agentMessage', text: event.content_block.text || '' };
      turn.items.set(id, item);
      this.notify('item/started', { threadId: session.threadId, turnId: turn.id, item });
      return;
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const id = `${session.messageId}:${event.index}`;
      const item = turn.items.get(id);
      if (!item) return;
      item.text += event.delta.text;
      this.notify('item/agentMessage/delta', { threadId: session.threadId, turnId: turn.id, itemId: id, delta: event.delta.text });
    }
  }

  handleAssistant(session, apiMessage) {
    const turn = session.turn;
    const messageId = apiMessage.id || session.messageId || `msg_${randomUUID()}`;
    turn.seenText ||= new Map();
    for (const block of apiMessage.content || []) {
      if (block.type === 'text') {
        const ordinal = turn.seenText.get(messageId) || 0;
        turn.seenText.set(messageId, ordinal + 1);
        const id = turn.textByMessage.get(messageId)?.[ordinal] || `${messageId}:text${ordinal}`;
        const item = { id, type: 'agentMessage', text: block.text || '' };
        turn.items.set(id, item);
        this.notify('item/completed', { threadId: session.threadId, turnId: turn.id, item });
      } else if (block.type === 'tool_use') {
        const item = toolItem(block);
        turn.items.set(item.id, item);
        this.notify('item/started', { threadId: session.threadId, turnId: turn.id, item });
      } else if (block.type === 'thinking' && block.thinking?.trim()) {
        const item = { id: `${messageId}:thinking${turn.items.size}`, type: 'reasoning', summary: [block.thinking.trim()] };
        turn.items.set(item.id, item);
        this.notify('item/completed', { threadId: session.threadId, turnId: turn.id, item });
      }
    }
  }

  handleToolResults(session, apiMessage) {
    const turn = session.turn;
    if (!Array.isArray(apiMessage.content)) return;
    for (const block of apiMessage.content) {
      if (block.type !== 'tool_result') continue;
      const item = turn.items.get(block.tool_use_id);
      if (!item) continue;
      const completed = applyToolResult(item, block);
      turn.items.set(item.id, completed);
      this.notify('item/completed', { threadId: session.threadId, turnId: turn.id, item: completed });
    }
  }

  finishTurn(session, { status, error }) {
    const turn = session.turn;
    if (!turn) return;
    session.turn = null;
    turn.status = status;
    turn.error = error ? { message: error } : null;
    for (const item of turn.items.values()) if (item.status === 'inProgress') item.status = status === 'completed' ? 'completed' : 'interrupted';
    this.notify('turn/completed', { threadId: session.threadId, turn: serializeTurn(turn) });
    void this.updateIndex(session.threadId, { updatedAt: Math.floor(Date.now() / 1000) }).catch(() => undefined);
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => this.endSession(session), IDLE_MS);
    session.idleTimer.unref?.();
  }
}

// ——— Translation helpers ——————————————————————————————————————————————
function serializeTurn(turn) {
  return { id: turn.id, status: turn.status, error: turn.error, items: [...turn.items.values()] };
}

function displayText(text) {
  return String(text).replace(/^The user attached this exact existing LifeOS [\s\S]*?```\n\n?/, '');
}

export function describeToolUse(name, input = {}) {
  if (name === 'Bash') return String(input.command || '');
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return `${name} ${input.file_path || input.notebook_path || ''}`.trim();
  if (name === 'WebFetch') return `Fetch ${input.url || ''}`.trim();
  if (name === 'WebSearch') return `Search the web for “${input.query || ''}”`;
  const json = JSON.stringify(input);
  return `${name} ${json.length > 600 ? `${json.slice(0, 600)}…` : json}`;
}

function toolItem(block) {
  const name = block.name || 'tool';
  const input = block.input || {};
  if (name === 'Bash') return { id: block.id, type: 'commandExecution', command: input.command || '', aggregatedOutput: '', status: 'inProgress' };
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    return { id: block.id, type: 'fileChange', status: 'inProgress', changes: [{ kind: name === 'Write' ? 'write' : 'edit', path: input.file_path || input.notebook_path || '', diff: name === 'Edit' ? `- ${String(input.old_string || '').slice(0, 2000)}\n+ ${String(input.new_string || '').slice(0, 2000)}` : '' }] };
  }
  const mcp = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcp) return { id: block.id, type: 'mcpToolCall', server: mcp[1], tool: mcp[2], arguments: input, status: 'inProgress' };
  if (name === 'TodoWrite' && Array.isArray(input.todos)) return { id: block.id, type: 'plan', text: input.todos.map((todo) => `${todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '·'} ${todo.content}`).join('\n'), status: 'completed' };
  return { id: block.id, type: 'dynamicToolCall', tool: name, arguments: input, status: 'inProgress' };
}

function resultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) return block.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join('\n');
  return '';
}

function applyToolResult(item, block) {
  const text = resultText(block).slice(0, 20_000);
  const status = block.is_error ? 'failed' : 'completed';
  if (item.type === 'commandExecution') return { ...item, aggregatedOutput: text, status };
  if (item.type === 'fileChange') return { ...item, status };
  if (item.type === 'plan') return item;
  return { ...item, status, ...(block.is_error ? { error: text } : { result: text }) };
}

// Rebuild turns from Claude Code's session transcript (one JSON object per
// line; assistant lines carry one content block each).
export function parseTranscript(source) {
  const turns = [];
  let turn = null;
  const toolItems = new Map();
  const textOrdinal = new Map();
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.isSidechain || entry.isMeta || !entry.message) continue;
    if (entry.type === 'user') {
      const content = entry.message.content;
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      const results = blocks.filter((block) => block.type === 'tool_result');
      if (results.length) {
        for (const block of results) {
          const item = toolItems.get(block.tool_use_id);
          if (item) Object.assign(item, applyToolResult(item, block));
        }
        continue;
      }
      const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
      if (!text.trim() || /^<(command-name|local-command|system-reminder)/.test(text.trim())) continue;
      turn = { id: entry.promptId || entry.uuid, status: 'completed', error: null, items: [{ id: entry.uuid, type: 'userMessage', content: [{ type: 'text', text }] }] };
      turns.push(turn);
      continue;
    }
    if (entry.type !== 'assistant' || !turn) continue;
    const messageId = entry.message.id || entry.uuid;
    for (const block of entry.message.content || []) {
      if (block.type === 'text' && block.text) {
        const ordinal = textOrdinal.get(messageId) || 0;
        textOrdinal.set(messageId, ordinal + 1);
        turn.items.push({ id: `${messageId}:text${ordinal}`, type: 'agentMessage', text: block.text });
      } else if (block.type === 'tool_use') {
        const item = { ...toolItem(block), status: 'completed' };
        toolItems.set(block.id, item);
        turn.items.push(item);
      }
    }
  }
  return turns;
}

export const claudeCodeAgent = new ClaudeCodeAgent();
