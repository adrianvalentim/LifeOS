import { expect, test } from './fixtures.mjs';

const MARKDOWN = '# Saros\n\nEclipses repeat every **18 years**.\n\n- [ ] Find the 1919 plates';

test('a new idea opens in the editor and its Markdown saves itself', async ({ app, page }) => {
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

  const body = page.getByRole('textbox', { name: 'Idea Markdown' });
  await body.click();
  await body.pressSequentially(MARKDOWN);
  await expect(page.locator('.save-state')).not.toHaveText('Saved');

  // Autosave: no ⌘S, the store catches up once typing pauses.
  await expect.poll(async () => (await idea()).markdown).toBe(MARKDOWN);
  await expect(page.locator('.save-state')).toHaveText('Saved');

  // The split view previews sanitized Markdown.
  const preview = page.getByRole('article', { name: 'Preview' });
  await expect(preview.locator('h1')).toHaveText('Saros');
  await expect(preview.locator('strong')).toHaveText('18 years');
  await expect(preview.locator('input[type="checkbox"]')).toHaveCount(1);

  // A fresh window loads the saved draft.
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Idea Markdown' })).toHaveValue(MARKDOWN);
});
