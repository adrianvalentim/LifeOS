import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_VOICE_CAPABILITY, CodexAppServer, codexExecutableCandidates } from '../src/codex-app-server.mjs';

test('Codex executable lookup covers macOS and portable PATH installs', () => {
  const mac = codexExecutableCandidates('darwin', {});
  const windows = codexExecutableCandidates('win32', {});

  assert.equal(mac[0], '/Applications/ChatGPT.app/Contents/Resources/codex');
  assert.ok(mac.includes('codex'));
  assert.deepEqual(windows, ['codex.exe']);
});

test('CODEX_EXECUTABLE takes precedence and is deduplicated', () => {
  const candidates = codexExecutableCandidates('linux', { CODEX_EXECUTABLE: '/custom/codex' });
  assert.equal(candidates[0], '/custom/codex');
  assert.equal(new Set(candidates).size, candidates.length);
});

test('protocol notifications expose approvals to the browser bridge', () => {
  const client = new CodexAppServer();
  const events = [];
  client.subscribe((event) => events.push(event));
  client.handleProtocolLine(JSON.stringify({
    method: 'item/commandExecution/requestApproval',
    id: 17,
    params: { command: 'npm test' },
  }));

  assert.equal(client.serverRequests.get(17).params.command, 'npm test');
  assert.equal(events.at(-1).type, 'serverRequest');
});

test('voice remains disabled instead of falling back to an API key or separate model', () => {
  assert.equal(CODEX_VOICE_CAPABILITY.available, false);
  assert.match(CODEX_VOICE_CAPABILITY.reason, /does not expose desktop dictation/);
  assert.match(CODEX_VOICE_CAPABILITY.reason, /will not use/);
});
