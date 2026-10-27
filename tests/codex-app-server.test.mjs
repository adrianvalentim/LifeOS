import assert from 'node:assert/strict';
import test from 'node:test';
import { CODEX_VOICE_CAPABILITY, CodexAppServer, codexExecutableCandidates } from '../src/codex-app-server.mjs';

test('Codex executable lookup covers macOS and portable PATH installs', () => {
  const mac = codexExecutableCandidates('darwin', {}, '/Users/person');
  const windows = codexExecutableCandidates('win32', {}, '/Users/person');

  assert.equal(mac[0], '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
  assert.ok(mac.includes('/Applications/ChatGPT.app/Contents/Resources/codex'));
  // The desktop app's PATH has no ~/.local/bin, so a per-user install needs its full path.
  assert.ok(mac.includes('/Users/person/.local/bin/codex'));
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

test('ChatGPT sign-in is started through the app server and ends on its completion notice', async () => {
  const client = new CodexAppServer();
  const events = [];
  const requests = [];
  client.subscribe((event) => events.push(event));
  client.connect = async () => undefined;
  client.request = async (method, params) => {
    requests.push({ method, params });
    return method === 'account/login/start' ? { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.example.com/authorize?x=1' } : {};
  };

  const login = await client.startLogin();
  assert.deepEqual(requests[0], { method: 'account/login/start', params: { type: 'chatgpt' } });
  assert.equal(login.url, 'https://auth.example.com/authorize?x=1');
  assert.deepEqual(client.loginState(), { status: 'waiting', url: login.url });
  assert.equal(await client.startLogin(), login, 'a second press reuses the pending sign-in');
  assert.equal(requests.length, 1);

  // Another sign-in finishing does not end ours.
  client.handleProtocolLine(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'other', success: true } }));
  assert.ok(client.loginState());

  client.handleProtocolLine(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'login-1', success: true } }));
  assert.equal(client.loginState(), null);
  assert.equal(events.filter((event) => event.type === 'login').at(-1).status, 'signedIn');
});

test('a cancelled or failed ChatGPT sign-in clears the pending state', async () => {
  const client = new CodexAppServer();
  const events = [];
  const methods = [];
  client.subscribe((event) => events.push(event));
  client.connect = async () => undefined;
  client.request = async (method) => { methods.push(method); return { type: 'chatgpt', loginId: 'login-2', authUrl: 'https://auth.example.com/a' }; };

  await client.startLogin();
  await client.cancelLogin();
  assert.equal(client.loginState(), null);
  assert.deepEqual(methods, ['account/login/start', 'account/login/cancel']);
  assert.equal(events.at(-1).status, 'cancelled');

  await client.startLogin();
  client.handleProtocolLine(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'login-2', success: false, error: 'Access denied' } }));
  assert.equal(client.loginState(), null);
  const failed = events.filter((event) => event.type === 'login').at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Access denied');
});
