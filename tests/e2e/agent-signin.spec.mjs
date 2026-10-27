import { expect, test } from './fixtures.mjs';

// The fixtures answer every agent route as unavailable so a test never starts
// the installed Codex or Claude Code. These stand in for a signed-out Claude
// Code, so the rail's Connect flow can be exercised without touching an account.
async function signedOutClaude(page) {
  const calls = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/claude/bootstrap**', (route) => json(route, {
    connection: { status: 'connected', executable: '/fake/claude' },
    account: { loggedIn: false, authMethod: 'none' },
    threads: [],
    pendingRequests: [],
    login: null,
  }));
  await page.route('**/api/claude/login/*', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').pop();
    calls.push({ action, body: route.request().postDataJSON() });
    if (action === 'start' && calls.filter((call) => call.action === 'start').length === 1) {
      return json(route, { error: 'Could not start Claude Code: spawn ENOENT' }, 500);
    }
    return json(route, action === 'start' ? { login: { status: 'waiting', url: 'https://claude.example.com/authorize' } } : { ok: true });
  });
  return calls;
}

test('a signed-out Claude can be connected from the rail, with a Terminal fallback and a way out', async ({ app, page }) => {
  const calls = await signedOutClaude(page);
  await app.goto('/projects');
  const rail = page.getByRole('complementary', { name: 'Agent rail' });
  await rail.getByRole('radio', { name: 'Claude' }).click();

  await expect(rail).toContainText('Claude needs your sign-in');
  await expect(rail.getByRole('button', { name: 'Retry' })).toBeVisible();

  // A failed start says why and offers another go.
  await rail.getByRole('button', { name: 'Connect Claude' }).click();
  await expect(rail.getByRole('alert')).toContainText('Could not start Claude Code');
  await rail.getByRole('button', { name: 'Connect Claude' }).click();

  // The browser does the signing in; the rail waits and offers the page again.
  // A code fallback belongs in Terminal: the rail has nowhere to type one.
  await expect(rail).toContainText('Finish signing in');
  await expect(rail.getByRole('button', { name: 'Open sign-in page again' })).toBeVisible();
  await expect(rail).toContainText('If the browser shows a code instead, press Cancel and run claude auth login in Terminal.');
  await expect(rail.locator('.agent-welcome input, .agent-welcome textarea')).toHaveCount(0);

  await rail.getByRole('button', { name: 'Open sign-in page again' }).click();
  await expect.poll(() => calls.some((call) => call.action === 'open')).toBe(true);

  await rail.getByRole('button', { name: 'Cancel' }).click();
  await expect(rail).toContainText('Claude needs your sign-in');
  await expect(rail.getByRole('button', { name: 'Connect Claude' })).toBeVisible();
  expect(calls.map((call) => call.action)).toEqual(['start', 'start', 'open', 'cancel']);
});
