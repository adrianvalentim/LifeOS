import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { ROOT_DIR } from './lifeos-data.mjs';

const SUPPORTED_SERVER_REQUESTS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
]);

const LIFEOS_DEVELOPER_INSTRUCTIONS = `You are the Codex agent behind the local LifeOS rail.

Work in the LifeOS workspace selected as your cwd. AGENTS.md is the compact project map and is authoritative. For ordinary time logs, project-health questions, statistics, and recommendations, use the documented LifeOS CLI immediately; do not inspect application source first. Inspect only the relevant files when the user asks for a code or schema change. LifeOS data is the filesystem source of truth. After modifying data or code, run the proportionate checks and report the concrete result briefly. Never use an OpenAI API key or suggest adding one: this rail is already connected through the installed Codex app server and the user's signed-in ChatGPT account.`;

export const CODEX_VOICE_CAPABILITY = Object.freeze({
  available: false,
  reason: 'The installed Codex app server does not expose desktop dictation to ChatGPT-account clients. Its realtime route requires API-key authentication, which LifeOS intentionally will not use.',
});

export class CodexAppServer {
  constructor(options = {}) {
    this.cwd = path.resolve(options.cwd || ROOT_DIR);
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.loadedThreads = new Set();
    this.listeners = new Set();
    this.child = null;
    this.connected = false;
    this.connectPromise = null;
    this.executable = null;
    this.lastDiagnostic = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    if (this.connected) listener({ type: 'connection', status: 'connected', detail: this.executable });
    for (const request of this.serverRequests.values()) listener({ type: 'serverRequest', request });
    return () => this.listeners.delete(listener);
  }

  async connect() {
    if (this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.openConnection();
    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  async openConnection() {
    this.emit({ type: 'connection', status: 'connecting' });
    const failures = [];
    for (const executable of codexExecutableCandidates()) {
      try {
        await this.startProcess(executable);
        this.executable = executable;
        break;
      } catch (error) {
        failures.push(`${executable}: ${error.message}`);
      }
    }
    if (!this.child) {
      const error = new Error(`Could not start the installed Codex executable. Set CODEX_EXECUTABLE if needed. Attempts: ${failures.join('; ')}`);
      this.emit({ type: 'connection', status: 'error', detail: error.message });
      throw error;
    }

    try {
      await this.request('initialize', {
        clientInfo: { name: 'lifeos', title: 'LifeOS', version: '0.2.0' },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: false,
        },
      });
      await this.notify('initialized');
      this.connected = true;
      this.emit({ type: 'connection', status: 'connected', detail: this.executable });
    } catch (error) {
      await this.stop();
      this.emit({ type: 'connection', status: 'error', detail: error.message });
      throw error;
    }
  }

  async startProcess(executable) {
    const child = spawn(executable, ['app-server', '--stdio'], {
      cwd: this.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError);
        resolve();
      };
      const onError = (error) => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    this.child = child;
    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on('line', (line) => this.handleProtocolLine(line));
    const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderr.on('line', (line) => {
      this.lastDiagnostic = line;
      this.emit({ type: 'diagnostic', message: line });
    });
    child.once('close', (code, signal) => {
      const detail = signal ? `Codex stopped with ${signal}` : `Codex exited with status ${code}`;
      this.resetConnection(new Error(detail));
      this.emit({ type: 'connection', status: 'disconnected', detail });
    });
  }

  handleProtocolLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit({ type: 'diagnostic', message: `Codex sent a non-JSON protocol line: ${line}` });
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message || `Codex protocol error ${message.error.code}`));
      else pending.resolve(message.result);
      return;
    }

    if (message.method && message.id !== undefined) {
      if (message.method === 'currentTime/read') {
        void this.send({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
        return;
      }
      if (SUPPORTED_SERVER_REQUESTS.has(message.method)) {
        const request = { id: message.id, method: message.method, params: message.params || {} };
        this.serverRequests.set(message.id, request);
        this.emit({ type: 'serverRequest', request });
        return;
      }
      void this.send({ id: message.id, error: { code: -32601, message: `LifeOS does not implement ${message.method}` } });
      return;
    }

    if (!message.method) return;
    const params = message.params || {};
    if (message.method === 'serverRequest/resolved' && params.requestId !== undefined) {
      this.serverRequests.delete(params.requestId);
    }
    this.emit({ type: 'notification', method: message.method, params });
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  request(method, params = {}, timeoutMs = 60_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not answer ${method} within ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ method, id, params }).catch((error) => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method, params) {
    return this.send(params === undefined ? { method } : { method, params });
  }

  async send(message) {
    if (!this.child?.stdin?.writable) throw new Error('The Codex app server is not running.');
    const line = JSON.stringify(message);
    await new Promise((resolve, reject) => {
      this.child.stdin.write(`${line}\n`, 'utf8', (error) => error ? reject(error) : resolve());
    });
  }

  async account() {
    await this.connect();
    return this.request('account/read', { refreshToken: false });
  }

  async listThreads() {
    await this.connect();
    const threads = [];
    let cursor = null;
    do {
      const page = await this.request('thread/list', {
        cursor,
        limit: 100,
        sortKey: 'recency_at',
        sortDirection: 'desc',
        sourceKinds: ['cli', 'vscode', 'appServer'],
        archived: false,
        cwd: [this.cwd],
      });
      threads.push(...(page.data || []));
      cursor = page.nextCursor || null;
    } while (cursor && threads.length < 500);
    return threads;
  }

  async readThread(threadId) {
    await this.connect();
    const response = await this.request('thread/read', { threadId, includeTurns: true });
    return response.thread;
  }

  async startThread(options = {}) {
    await this.connect();
    const response = await this.request('thread/start', {
      cwd: this.cwd,
      runtimeWorkspaceRoots: [this.cwd],
      approvalPolicy: options.ephemeral ? 'never' : 'on-request',
      approvalsReviewer: 'user',
      sandbox: options.ephemeral ? 'read-only' : 'workspace-write',
      developerInstructions: options.ephemeral
        ? 'This is an ephemeral LifeOS task. Do not use tools or modify files.'
        : LIFEOS_DEVELOPER_INSTRUCTIONS,
      ephemeral: options.ephemeral || false,
    });
    this.loadedThreads.add(response.thread.id);
    return response.thread;
  }

  async resumeThread(threadId) {
    await this.connect();
    const response = await this.request('thread/resume', {
      threadId,
      cwd: this.cwd,
      runtimeWorkspaceRoots: [this.cwd],
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      developerInstructions: LIFEOS_DEVELOPER_INSTRUCTIONS,
    });
    this.loadedThreads.add(response.thread.id);
    return response.thread;
  }

  async ensureLoaded(threadId) {
    if (!this.loadedThreads.has(threadId)) await this.resumeThread(threadId);
  }

  async startTurn(threadId, text) {
    await this.ensureLoaded(threadId);
    const response = await this.request('turn/start', {
      threadId,
      cwd: this.cwd,
      runtimeWorkspaceRoots: [this.cwd],
      approvalPolicy: 'on-request',
      input: [{ type: 'text', text, text_elements: [] }],
    });
    return response.turn;
  }

  async interruptTurn(threadId, turnId) {
    await this.connect();
    await this.request('turn/interrupt', { threadId, turnId });
  }

  async respondToServerRequest(id, result) {
    await this.send({ id, result });
    this.serverRequests.delete(id);
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.connected = false;
    this.connectPromise = null;
    if (!child || child.killed) return;
    child.stdin.end();
    child.kill();
  }

  resetConnection(error) {
    this.child = null;
    this.connected = false;
    this.connectPromise = null;
    this.loadedThreads.clear();
    this.serverRequests.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function codexExecutableCandidates(platform = process.platform, env = process.env) {
  const candidates = [];
  if (env.CODEX_EXECUTABLE) candidates.push(env.CODEX_EXECUTABLE);
  if (platform === 'darwin') candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex');
  if (platform !== 'win32') {
    candidates.push('/opt/homebrew/bin/codex');
    candidates.push('/usr/local/bin/codex');
  }
  candidates.push(platform === 'win32' ? 'codex.exe' : 'codex');
  return [...new Set(candidates.filter(Boolean))];
}

export const codexAppServer = new CodexAppServer();
