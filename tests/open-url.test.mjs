import assert from 'node:assert/strict';
import test from 'node:test';
import { openSignInPage } from '../src/open-url.mjs';

test('sign-in pages open in the default browser, https only', async () => {
  const calls = [];
  const run = async (command, args) => { calls.push([command, ...args]); };

  assert.deepEqual(await openSignInPage('https://claude.com/cai/oauth/authorize?code=true', { platform: 'darwin', run }), { ok: true });
  assert.deepEqual(calls, [['/usr/bin/open', 'https://claude.com/cai/oauth/authorize?code=true']]);

  await assert.rejects(openSignInPage('http://claude.com/x', { platform: 'darwin', run }), /https/);
  await assert.rejects(openSignInPage('file:///etc/passwd', { platform: 'darwin', run }), /https/);
  await assert.rejects(openSignInPage(undefined, { platform: 'darwin', run }), /no sign-in page/);
  await assert.rejects(openSignInPage('https://claude.com/x', { platform: 'linux', run }), /directly in your browser/);
  assert.equal(calls.length, 1);
});
