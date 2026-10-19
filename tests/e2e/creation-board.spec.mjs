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

test('the whole column is a drop target, down to the bottom of the pane', async ({ app, page }) => {
  for (const title of TITLES) await app.cli(['run', 'creation.create', '--title', title, '--type', 'short']);
  await app.goto('/creation');
  const column = (status) => page.locator(`[data-idea-drop="${status}"]`);
  const titles = async (status) => column(status).locator('.idea-title').allTextContents();
  const viewport = page.viewportSize();

  // Even a nearly empty column reaches the bottom of the pane.
  const doing = await column('doing').boundingBox();
  expect(doing.y + doing.height).toBeGreaterThan(viewport.height - 4);

  // Drop an idea far below the cards: in an empty column, then at the end of a populated one.
  const drag = async (title, to) => {
    const box = await page.locator('.idea-card', { hasText: title }).locator('.idea-title').boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 22, box.y + box.height / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  };
  await drag('Kepler planets', { x: doing.x + doing.width / 2, y: viewport.height - 30 });
  await expect.poll(() => titles('doing')).toEqual(['Kepler planets']);

  const before = await titles('to_do');
  const todo = await column('to_do').boundingBox();
  await drag(before[0], { x: todo.x + todo.width / 2, y: viewport.height - 30 });
  await expect.poll(() => titles('to_do')).toEqual([...before.slice(1), before[0]]);
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

test('a dragged card lifts when picked up and glides into its slot when dropped', async ({ app, page }) => {
  for (const title of TITLES) await app.cli(['run', 'creation.create', '--title', title, '--type', 'short']);
  await app.goto('/creation');
  const card = page.locator('.idea-card:not(.drag-preview)', { hasText: 'Kepler planets' });
  const box = await card.locator('.idea-title').boundingBox();
  const next = await page.locator('[data-idea-drop="next_up"]').boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 22, box.y + box.height / 2, { steps: 3 });

  // Picked up: the lifted copy is larger than the card it came from, which fades into a slot.
  const preview = page.locator('.drag-preview');
  await expect(preview).toHaveClass(/is-lifted/);
  await expect.poll(() => preview.evaluate((node) => getComputedStyle(node).scale)).toBe('1.035');
  await expect(card).toHaveClass(/is-drag-source/);

  // The lifted card follows the pointer, wherever it goes.
  const pointer = { x: next.x + next.width / 2, y: next.y + 200 };
  await page.mouse.move(pointer.x, pointer.y, { steps: 8 });
  await expect.poll(async () => {
    const lifted = await preview.boundingBox();
    return lifted.x < pointer.x && pointer.x < lifted.x + lifted.width && lifted.y < pointer.y && pointer.y < lifted.y + lifted.height;
  }).toBe(true);
  await page.mouse.up();
  // It glides to the new slot (hidden underneath) and is gone a moment later.
  await expect(page.locator('.is-settling')).toHaveCount(1);
  await expect(preview).toHaveCount(0);
  await expect(page.locator('.is-settling, .is-drag-source')).toHaveCount(0);
  const landed = await page.locator('[data-idea-drop="next_up"] .idea-card').boundingBox();
  expect(Math.abs(landed.x - next.x)).toBeLessThanOrEqual(2);
});

test('Esc brings a dragged card back, and reduced motion drops it without animation', async ({ app, page }) => {
  for (const title of TITLES) await app.cli(['run', 'creation.create', '--title', title, '--type', 'short']);
  await app.goto('/creation');
  const card = page.locator('.idea-card:not(.drag-preview)', { hasText: 'Kepler planets' });
  const title = card.locator('.idea-title');
  const box = await title.boundingBox();
  const next = await page.locator('[data-idea-drop="next_up"]').boundingBox();
  const pickUp = async () => {
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 22, box.y + box.height / 2, { steps: 3 });
    await page.mouse.move(next.x + next.width / 2, next.y + 200, { steps: 8 });
  };

  await pickUp();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await expect(card).not.toHaveClass(/is-drag-source/);
  expect((await app.store()).creation.ideas.find((idea) => idea.title === 'Kepler planets').status).toBe('to_do');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pickUp();
  await expect(page.locator('.drag-preview')).not.toHaveClass(/is-lifted/);
  await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
  await expect.poll(async () => (await app.store()).creation.ideas.find((idea) => idea.title === 'Kepler planets').status).toBe('next_up');
});
