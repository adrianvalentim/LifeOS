import { expect, test } from './fixtures.mjs';
import { rowIds, taskRow } from './helpers.mjs';

// The demo store's open tasks, in the All tasks list's manual order.
const ACT_THREE = 'demo-task-portia-act-three';
const CONFRONTATION = 'demo-task-portia-confrontation';
const OBSERVATORY = 'demo-task-vulcano-observatory';
const REVIEW_CUT = 'demo-task-vulcano-review-cut';
const ESSAY = 'demo-task-substack-opening';
const PASSPORT = 'demo-task-inbox-passport';

test.beforeEach(async ({ app, page }) => {
  await app.goto('/tasks?list=all');
  expect(await rowIds(page)).toEqual([ACT_THREE, CONFRONTATION, OBSERVATORY, REVIEW_CUT, ESSAY, PASSPORT]);
});

test('the task sheet edits the title and notes, saving as you go', async ({ app, page }) => {
  await taskRow(page, ESSAY).locator('.task-title').click();
  const sheet = page.getByRole('dialog', { name: 'Details' });
  const title = sheet.getByRole('textbox', { name: 'Task title' });
  await expect(title).toHaveValue('Rewrite the essay opening');

  await title.fill('Rewrite the essay opening around the eclipse');
  await title.press('Enter');
  await expect.poll(async () => (await app.task('Rewrite the essay opening around the eclipse'))?.id).toBe(ESSAY);
  await expect(taskRow(page, ESSAY).locator('.task-title')).toHaveText('Rewrite the essay opening around the eclipse');

  // Notes save shortly after typing pauses, with no explicit save.
  const notes = sheet.getByPlaceholder('Add notes, links, context…');
  await notes.fill('Lead with the 1919 photograph.\nCut the second paragraph.');
  await expect.poll(async () => (await app.task('Rewrite the essay opening around the eclipse')).notes)
    .toBe('Lead with the 1919 photograph.\nCut the second paragraph.');
  await expect(taskRow(page, ESSAY).locator('.meta-note')).toBeVisible();

  // Esc leaves the field, a second Esc closes the sheet.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // A fresh window shows what was saved.
  await page.reload();
  await taskRow(page, ESSAY).locator('.task-title').click();
  await expect(sheet.getByRole('textbox', { name: 'Task title' })).toHaveValue('Rewrite the essay opening around the eclipse');
  await expect(notes).toHaveValue('Lead with the 1919 photograph.\nCut the second paragraph.');
});

test('Space completes the focused task and ⌘Z brings it back', async ({ app, page }) => {
  await page.keyboard.press('j');
  await expect(taskRow(page, ACT_THREE)).toBeFocused();

  await page.keyboard.press('Space');
  // A completed task leaves the open list, and completing a parent completes its subtasks.
  await expect(taskRow(page, ACT_THREE)).toBeHidden();
  await expect(taskRow(page, CONFRONTATION)).toBeHidden();
  await expect.poll(async () => (await app.task('Finish the Act III draft')).status).toBe('completed');
  expect((await app.task('Write the confrontation scene')).status).toBe('completed');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(taskRow(page, ACT_THREE)).toBeVisible();
  await expect.poll(async () => (await app.task('Finish the Act III draft')).status).toBe('open');
  expect((await app.task('Write the confrontation scene')).status).toBe('open');
  expect(await rowIds(page)).toEqual([ACT_THREE, CONFRONTATION, OBSERVATORY, REVIEW_CUT, ESSAY, PASSPORT]);

  await page.keyboard.press('Shift+ControlOrMeta+z');
  await expect(taskRow(page, ACT_THREE)).toBeHidden();
  await expect.poll(async () => (await app.task('Finish the Act III draft')).status).toBe('completed');
});

test('J/K move through the list, X and ⇧J select, and the bulk bar changes them together', async ({ app, page }) => {
  await page.keyboard.press('j');
  await expect(taskRow(page, ACT_THREE)).toBeFocused();
  await page.keyboard.press('j');
  await expect(taskRow(page, CONFRONTATION)).toBeFocused();
  await page.keyboard.press('j');
  await expect(taskRow(page, OBSERVATORY)).toBeFocused();
  await page.keyboard.press('k');
  await expect(taskRow(page, CONFRONTATION)).toBeFocused();

  await page.keyboard.press('x');
  await expect(taskRow(page, CONFRONTATION)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Shift+J');
  await expect(taskRow(page, OBSERVATORY)).toBeFocused();
  await page.keyboard.press('Shift+J');
  await expect(taskRow(page, REVIEW_CUT)).toBeFocused();
  expect(await rowIds(page, '.main .task-row[aria-selected="true"]')).toEqual([CONFRONTATION, OBSERVATORY, REVIEW_CUT]);

  const bar = page.getByRole('toolbar', { name: '3 selected tasks' });
  await expect(bar).toContainText('3 selected');
  await bar.getByRole('button', { name: 'Priority' }).click();
  await page.getByRole('menuitemcheckbox', { name: /^None/ }).click();

  await expect.poll(async () => {
    const { tasks } = await app.store();
    return Object.fromEntries(tasks.items.filter((task) => task.status === 'open').map((task) => [task.id, task.priority]));
  }).toEqual({
    [ACT_THREE]: 'high', [CONFRONTATION]: 'none', [OBSERVATORY]: 'none', [REVIEW_CUT]: 'none', [ESSAY]: 'medium', [PASSPORT]: 'low',
  });
  await expect(taskRow(page, OBSERVATORY)).toHaveClass(/prio-none/);

  // The bulk change is one journal entry, so one ⌘Z restores all three.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => [
    (await app.task('Write the confrontation scene')).priority,
    (await app.task('Lock the observatory sequence')).priority,
    (await app.task('Export the review cut')).priority,
  ]).toEqual(['medium', 'high', 'low']);
});

test('dragging a task reorders the list and saves the new order', async ({ app, page }) => {
  const handle = await taskRow(page, PASSPORT).locator('.task-title').boundingBox();
  const target = await taskRow(page, ACT_THREE).boundingBox();
  const x = handle.x + 8;
  const y = handle.y + handle.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 12, { steps: 3 });
  // Into the top half of the first row, without moving sideways (which would nest).
  await page.mouse.move(x, target.y + 4, { steps: 12 });
  // The drop indicator is a line across the list on the first row's top edge
  // (moves land on animation frames).
  const line = page.locator('.main .drop-line');
  await expect(line).toBeVisible();
  const lineBox = await line.boundingBox();
  expect(lineBox.width).toBeGreaterThan(target.width / 2);
  expect(Math.abs(lineBox.y + lineBox.height / 2 - target.y)).toBeLessThanOrEqual(2);
  await page.mouse.up();

  await expect.poll(() => rowIds(page)).toEqual([PASSPORT, ACT_THREE, CONFRONTATION, OBSERVATORY, REVIEW_CUT, ESSAY]);
  await expect.poll(async () => {
    const roots = (await app.store()).tasks.items.filter((task) => !task.parentTaskId && task.status === 'open');
    return roots.sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id);
  }).toEqual([PASSPORT, ACT_THREE, OBSERVATORY, ESSAY]);
  expect((await app.task('Renew passport')).parentTaskId).toBeNull();

  // The saved order survives a reload.
  await page.reload();
  await expect.poll(() => rowIds(page)).toEqual([PASSPORT, ACT_THREE, CONFRONTATION, OBSERVATORY, REVIEW_CUT, ESSAY]);
});

test('adding a task when the server is unreachable says so and keeps the words', async ({ app, page }) => {
  await app.goto('/projects/portia');
  const input = page.getByRole('textbox', { name: 'Add a task to Portia' });
  // A dead server surfaces in WebKit as a bare "Load failed" network error.
  await page.route('**/api/run/tasks.create*', (route) => route.abort('failed'));
  await input.fill('Book the sound mix');
  await input.press('Enter');

  await expect(page.locator('.toast-error')).toContainText('couldn’t reach its local server');
  await expect(input).toHaveValue('Book the sound mix');
  expect(await app.task('Book the sound mix')).toBeNull();

  // Once the server answers again, Enter saves the same words.
  await page.unroute('**/api/run/tasks.create*');
  await input.press('Enter');
  await expect.poll(async () => (await app.task('Book the sound mix'))?.projectId).toBe('portia');
  await expect(input).toHaveValue('');
});

test('after the server restarts on the same port, the open window reconnects and saves again', async ({ app, page }) => {
  await app.goto('/projects/portia');
  const conn = page.locator('.masthead .conn');
  await app.restartServer();
  await expect(conn).not.toHaveClass(/is-live/);

  // Coming back to the window reconnects without waiting for the browser's retry.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(conn).toHaveClass(/is-live/);

  const input = page.getByRole('textbox', { name: 'Add a task to Portia' });
  await input.fill('Send the cut to the composer');
  await input.press('Enter');
  await expect.poll(async () => (await app.task('Send the cut to the composer'))?.projectId).toBe('portia');
});
