import { expect, test } from './fixtures.mjs';
import { addDays } from './helpers.mjs';

test('quick capture turns one line of natural language into a scheduled project task', async ({ app, page }) => {
  await app.goto('/tasks?list=all');
  const { meta } = await app.state();

  await page.keyboard.press('n');
  const capture = page.getByRole('dialog', { name: 'Quick capture' });
  const input = capture.getByRole('textbox', { name: 'What do you want to add?' });
  await expect(input).toBeFocused();
  await input.pressSequentially('Call the lab tomorrow 3pm !high #film @Vulcano');

  // Every recognised token is highlighted where it was typed and listed as a chip.
  await expect(capture.locator('.capture-mirror mark')).toHaveText(['tomorrow', '3pm', '!high', '#film', '@Vulcano']);
  await expect(capture.locator('.cap-chip.cap-date')).toContainText('Tomorrow');
  await expect(capture.locator('.cap-chip.cap-time')).toHaveText(/3:00\sPM/);
  await expect(capture.locator('.cap-chip.cap-priority')).toHaveText('High priority');
  await expect(capture.locator('.cap-chip.cap-tag')).toHaveText('film');
  await expect(capture.locator('.cap-chip.cap-project')).toHaveText('Vulcano');

  await input.press('Enter');
  await expect(capture).toBeHidden();

  await expect.poll(() => app.task('Call the lab')).toMatchObject({
    projectId: 'vulcano',
    priority: 'high',
    tags: ['film'],
    status: 'open',
    schedule: { dueDate: addDays(meta.today, 1), startTime: '15:00' },
  });
  const row = page.locator('.main .task-row', { hasText: 'Call the lab' });
  await expect(row.locator('.meta-tag')).toHaveText('#film');
  await expect(row.locator('.meta-flag')).toHaveClass(/prio-high/);
  await expect(row.locator('.pill-due')).toHaveText(/Tomorrow · 3:00\sPM/);
  await expect(page.locator('.toast [data-toast-undo]')).toBeVisible();
});
