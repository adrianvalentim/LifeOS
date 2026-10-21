import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ClaudeCodeAgent, cleanClaudeEnv, describeToolUse, parseTranscript, projectSlug } from '../src/claude-code-agent.mjs';

// A stand-in for the `claude` CLI that speaks its stream-json control
// protocol: answers initialize, streams a reply, asks permission for Bash,
// and reports the decision back as the tool result.
const FAKE_CLAUDE = `#!/usr/bin/env node
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args[0] === 'auth') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'person@example.com' })); process.exit(0); }
const out = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
const sessionId = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1];
out({ type: 'system', subtype: 'init', session_id: sessionId, permissionMode: args[args.indexOf('--permission-mode') + 1], args });
let pending = null;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'control_request' && message.request.subtype === 'initialize') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { commands: [] } } });
  } else if (message.type === 'user') {
    out({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking ' } } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'your week.' } } });
    out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Checking your week.' }] } });
    out({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'ls data' } }] } });
    pending = 'perm1';
    out({ type: 'control_request', request_id: 'perm1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls data' }, permission_suggestions: [{ type: 'addRules' }] } });
  } else if (message.type === 'control_response' && message.response.request_id === pending) {
    const allowed = message.response.response.behavior === 'allow';
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: allowed ? 'lifeos.demo.json' : 'denied', is_error: !allowed } ] } });
    out({ type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: allowed ? 'Done.' : 'Understood.' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: sessionId });
  }
});
`;

// Answers initialize, then dies as soon as the next message starts arriving.
const CRASHING_CLAUDE = `#!/usr/bin/env node
if (process.argv[2] === 'auth') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
let initialized = false;
process.stdin.on('data', (chunk) => {
  if (initialized) process.exit(1);
  initialized = true;
  const message = JSON.parse(chunk.toString().split('\\n')[0]);
  process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } }) + '\\n');
});
`;

async function setup(script = FAKE_CLAUDE) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lifeos-claude-'));
  const executable = path.join(dir, 'claude');
  await writeFile(executable, script);
  await chmod(executable, 0o755);
  const agent = new ClaudeCodeAgent({ cwd: dir, executable, indexPath: path.join(dir, 'sessions.json'), env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, 'config') }, mcpServer: null });
  const events = [];
  agent.subscribe((event) => events.push(event));
  return { dir, agent, events };
}

function waitFor(events, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - started > timeout) return reject(new Error('Timed out waiting for event'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('Claude bridge streams a turn, routes approval to the person, and completes', async (t) => {
  const { dir, agent, events } = await setup();
  t.after(async () => { await agent.stop(); await rm(dir, { recursive: true, force: true }); });

  const account = await agent.account();
  assert.equal(account.loggedIn, true);

  const thread = await agent.startThread();
  assert.equal((await agent.listThreads())[0].id, thread.id);

  const turn = await agent.startTurn(thread.id, 'How is my week going?');
  assert.equal(turn.status, 'inProgress');
  assert.equal(turn.items[0].type, 'userMessage');

  const request = await waitFor(events, (event) => event.type === 'serverRequest');
  assert.equal(request.request.method, 'claude/canUseTool');
  assert.equal(request.request.params.command, 'ls data');

  const deltas = events.filter((event) => event.method === 'item/agentMessage/delta').map((event) => event.params.delta).join('');
  assert.equal(deltas, 'Checking your week.');
  // The streamed text and the final assistant block are the same item.
  const textItems = new Set(events.filter((event) => event.params?.item?.type === 'agentMessage').map((event) => event.params.item.id));
  assert.equal(textItems.size, 1);

  await assert.rejects(agent.startTurn(thread.id, 'again'), /still working/);
  await agent.respondToServerRequest(request.request.id, { decision: 'acceptForSession' });

  const done = await waitFor(events, (event) => event.method === 'turn/completed');
  assert.equal(done.params.turn.status, 'completed');
  const tool = done.params.turn.items.find((item) => item.type === 'commandExecution');
  assert.equal(tool.status, 'completed');
  assert.equal(tool.aggregatedOutput, 'lifeos.demo.json');
  assert.ok(events.some((event) => event.method === 'serverRequest/resolved'));
  assert.equal(agent.serverRequests.size, 0);

  const [listed] = await agent.listThreads();
  assert.equal(listed.preview, 'How is my week going?');
});

test('Claude bridge passes the person’s decline back to Claude', async (t) => {
  const { dir, agent, events } = await setup();
  t.after(async () => { await agent.stop(); await rm(dir, { recursive: true, force: true }); });
  const thread = await agent.startThread();
  await agent.startTurn(thread.id, 'List the data folder');
  const request = await waitFor(events, (event) => event.type === 'serverRequest');
  await agent.respondToServerRequest(request.request.id, { decision: 'decline' });
  const done = await waitFor(events, (event) => event.method === 'turn/completed');
  assert.equal(done.params.turn.items.find((item) => item.type === 'commandExecution').status, 'failed');
  assert.equal(done.params.turn.items.at(-1).text, 'Understood.');
});

test('Claude exiting mid-message fails the turn without taking the server down', async (t) => {
  const { dir, agent } = await setup(CRASHING_CLAUDE);
  t.after(async () => { await agent.stop(); await rm(dir, { recursive: true, force: true }); });
  const thread = await agent.startThread();
  // Larger than a pipe buffer, so the write is still in flight when Claude exits (EPIPE).
  await assert.rejects(agent.startTurn(thread.id, 'x'.repeat(2_000_000)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(agent.sessions.size, 0);
});

test('Claude bridge reloads past conversations from the session transcript', async (t) => {
  const { dir, agent } = await setup();
  t.after(async () => { await agent.stop(); await rm(dir, { recursive: true, force: true }); });
  const thread = await agent.startThread();
  await agent.updateIndex(thread.id, { started: true });
  const transcriptDir = path.join(dir, 'config', 'projects', projectSlug(dir));
  await mkdir(transcriptDir, { recursive: true });
  const lines = [
    { type: 'user', uuid: 'u1', promptId: 'p1', message: { role: 'user', content: 'Plan my day' } },
    { type: 'assistant', uuid: 'a1', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Here is a plan.' }] } },
    { type: 'assistant', uuid: 'a2', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__lifeos__tasks_list', input: { list: 'today' } }] } },
    { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '3 tasks' }] } },
    { type: 'assistant', uuid: 'a3', isSidechain: true, message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text: 'sub-agent chatter' }] } },
  ];
  await writeFile(path.join(transcriptDir, `${thread.id}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  const read = await agent.readThread(thread.id);
  assert.equal(read.turns.length, 1);
  const types = read.turns[0].items.map((item) => item.type);
  assert.deepEqual(types, ['userMessage', 'agentMessage', 'mcpToolCall']);
  assert.equal(read.turns[0].items[2].server, 'lifeos');
  assert.equal(read.turns[0].items[2].result, '3 tasks');
});

test('Claude helpers strip an embedding session and describe tool requests', () => {
  const env = cleanClaudeEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1', CLAUDE_CODE_TMPDIR: '/x', CLAUDE_CONFIG_DIR: '/c' });
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_TMPDIR', 'CLAUDE_CONFIG_DIR', 'PATH']);
  assert.equal(describeToolUse('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(describeToolUse('Edit', { file_path: '/a/b.js' }), 'Edit /a/b.js');
  assert.equal(projectSlug('/Volumes/atlas/LifeOS'), '-Volumes-atlas-LifeOS');
  assert.deepEqual(parseTranscript('not json\n'), []);
});
