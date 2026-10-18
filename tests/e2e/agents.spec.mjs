import { expect, test } from './fixtures.mjs';

test('an agent’s CLI write shows up live, the agent can steer the window, and Activity can undo it', async ({ app, page }) => {
  await app.goto('/tasks?list=all');
  const rail = page.getByRole('complementary', { name: 'Agent rail' });
  await rail.getByRole('tab', { name: 'Activity' }).click();
  await expect(rail).toContainText('No changes yet');

  const output = await app.cli(['run', 'tasks.create', '--title', 'Pick up the film stock', '--project', 'Vulcano', '--priority', 'high'], { actor: 'Claude' });
  expect(output.operationId).toBeTruthy();

  // The open window picks the change up from the store, with no reload.
  const row = page.locator('.main .task-row', { hasText: 'Pick up the film stock' });
  await expect(row).toBeVisible();
  await expect(row.locator('.meta-project')).toHaveText('Vulcano');

  // Activity names the agent and offers Undo.
  const entry = rail.locator(`.activity-entry[data-key="act-${output.operationId}"]`);
  await expect(entry).toContainText('Pick up the film stock');
  await expect(entry).toHaveClass(/is-agent/);
  await expect(entry).toContainText('Claude');

  // UI commands reach the window through the running server.
  await app.cli(['run', 'ui.navigate', '--to', '/tasks?list=project:vulcano']);
  await expect(page).toHaveURL(/\/tasks\?list=project(:|%3A)vulcano$/);
  await expect(page.locator('.list-pane h1')).toHaveText('Vulcano');
  await expect(row).toBeVisible();

  await entry.getByRole('button', { name: 'Undo' }).click();
  await expect(row).toBeHidden();
  await expect.poll(() => app.task('Pick up the film stock')).toBeNull();
  await expect(entry).toHaveClass(/is-undone/);
  await expect(rail.locator('.activity-entry').first()).toContainText('You');
});
