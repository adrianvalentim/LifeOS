import { expect, test } from './fixtures.mjs';

const TITLES = ['Kepler planets', 'Simplest PC', 'Macro double slit', 'Leonardo science', 'First space photo'];

test('dragging an idea card by its title moves it between columns and reorders within one', async ({ app, page }) => {
  for (const title of TITLES) await app.cli(['run', 'creation.create', '--title', title, '--type', 'short']);
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await app.goto('/creation');

  const card = (title) => page.locator('.idea-card', { hasText: title });
  const column = (status) => page.locator(`[data-idea-drop="${status}"]`);
  const titles = async (status) => column(status).locator('.idea-title').allTextContents();

  // To do → Next up.
  const source = await card('Kepler planets').boundingBox();
  const next = await column('next_up').boundingBox();
  // Grab the card by its title, where nearly all of its area is.
  const title = await card('Kepler planets').locator('.idea-title').boundingBox();
  const x = title.x + 10;
  const y = title.y + title.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y, { steps: 3 });
  await page.mouse.move(next.x + next.width / 2, next.y + 120, { steps: 12 });
  await expect(column('next_up')).toHaveClass(/is-drop-target/);
  await page.mouse.up();

  await expect.poll(async () => (await app.store()).creation.ideas.find((idea) => idea.title === 'Kepler planets').status).toBe('next_up');
  await expect.poll(() => titles('next_up')).toEqual(['Kepler planets']);
  await expect(page.locator('.toast.is-error, [role="alert"]')).toHaveCount(0);

  // Within To do: the last card above the first.
  const before = await titles('to_do');
  const last = await card(before.at(-1)).locator('.idea-title').boundingBox();
  const first = await card(before[0]).boundingBox();
  await page.mouse.move(last.x + 10, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + 22, last.y + last.height / 2, { steps: 3 });
  await page.mouse.move(first.x + 30, first.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => titles('to_do')).toEqual([before.at(-1), ...before.slice(0, -1)]);

  // Dragging by the title link never navigates, but a plain click still opens the idea.
  await expect(page).toHaveURL(/\/creation$/);
  await card('Kepler planets').locator('.idea-title').click();
  await expect(page).toHaveURL(/\/creation\/[^/]+$/);

  expect(consoleErrors.filter((text) => !text.includes('503'))).toEqual([]);
});

test('dragging a project card by its name changes its status', async ({ app, page }) => {
  await app.goto('/projects?view=board');
  const card = page.locator('.project-card', { hasText: 'Substack' }).first();
  const name = await card.locator('.pc-name').boundingBox();
  const target = await page.locator('[data-drop-status="doing"]').boundingBox();
  await page.mouse.move(name.x + 6, name.y + name.height / 2);
  await page.mouse.down();
  await page.mouse.move(name.x + 18, name.y + name.height / 2, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await app.store()).projects.find((project) => project.name === 'Substack').status).toBe('doing');
  await expect(page).toHaveURL(/\/projects/);
});
