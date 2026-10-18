import { expect, test } from './fixtures.mjs';

test('⌘K finds records and screens and goes there', async ({ app, page }) => {
  await app.goto('/insights');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('combobox');
  const sheet = page.getByRole('dialog', { name: 'Details' });
  // The palette fades out briefly after a choice and keeps focus until it is gone.
  const closed = () => expect(page.locator('.palette-backdrop')).toHaveCount(0);

  // From a screen without task lists, a task opens in its detail sheet on Tasks.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeFocused();
  await search.fill('observatory');
  await expect(palette.getByRole('option').first()).toContainText('Lock the observatory sequence');
  await search.press('Enter');
  await closed();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(sheet.getByRole('textbox', { name: 'Task title' })).toHaveValue('Lock the observatory sequence');

  // Esc closes the sheet; a project opens its page.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('vulcano');
  await expect(palette.getByRole('option').first()).toContainText('Vulcano');
  await search.press('Enter');
  await closed();
  await expect(page).toHaveURL(/\/projects\/vulcano$/);
  await expect(page).toHaveTitle(/^Vulcano · /);

  // Screens are reachable by name, with arrow keys to choose.
  await page.keyboard.press('ControlOrMeta+k');
  await search.fill('almanac');
  const almanac = palette.getByRole('option', { name: /^Almanac/ });
  await expect(almanac).toBeVisible();
  while (await almanac.getAttribute('aria-selected') !== 'true') await search.press('ArrowDown');
  await search.press('Enter');
  await closed();
  await expect(page).toHaveURL(/\/almanac$/);
  await expect(page.locator('.nav-link[aria-current="page"]')).toHaveText(/Almanac/);
});
