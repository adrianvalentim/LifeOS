import { expect, test } from './fixtures.mjs';

const MARKDOWN = '# Saros\n\nEclipses repeat every **18 years**.\n\n- [ ] Find the 1919 plates';

test('a new idea opens in the editor, renders as you type, and saves plain Markdown', async ({ app, page }) => {
  await app.goto('/creation');

  // On Creation, N captures an idea; ⌘↵ adds it and opens the editor.
  await page.keyboard.press('n');
  const capture = page.getByRole('dialog', { name: 'Quick capture' });
  await expect(capture.getByRole('tab', { name: 'Idea' })).toHaveAttribute('aria-selected', 'true');
  await capture.getByRole('textbox').fill('Why eclipses repeat');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/creation\/[^/]+$/);
  await expect(page.getByRole('textbox', { name: 'Idea title' })).toHaveValue('Why eclipses repeat');
  const idea = async () => (await app.store()).creation.ideas.find((item) => item.title === 'Why eclipses repeat');
  expect(await idea()).toMatchObject({ type: 'short', markdown: '' });

  // Writing and reading happen in one place: Markdown shortcuts turn into formatting as they are typed.
  const body = page.getByRole('textbox', { name: 'Idea body' });
  await body.click();
  await page.keyboard.type('# Saros');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Eclipses repeat every **18 years**.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[ ] Find the 1919 plates');
  await expect(body.locator('h1')).toHaveText('Saros');
  await expect(body.locator('strong')).toHaveText('18 years');
  await expect(body.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(body).not.toContainText('**');
  await expect(page.locator('.save-state')).not.toHaveText('Saved');

  // Autosave: no ⌘S, the store catches up once typing pauses, as Markdown.
  await expect.poll(async () => (await idea()).markdown).toBe(MARKDOWN);
  await expect(page.locator('.save-state')).toHaveText('Saved');

  // A fresh window loads the saved draft, rendered.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Idea body' }).locator('h1')).toHaveText('Saros');
  await expect(page.getByRole('textbox', { name: 'Idea body' }).locator('strong')).toHaveText('18 years');
});
