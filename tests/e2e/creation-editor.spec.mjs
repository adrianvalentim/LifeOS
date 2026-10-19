import { expect, test } from './fixtures.mjs';

const create = async (app, title, markdown) => {
  await app.cli(['run', 'creation.create', '--title', title, '--type', 'short', '--markdown', markdown]);
  return (await app.store()).creation.ideas.find((idea) => idea.title === title);
};
const stored = async (app, id) => (await app.store()).creation.ideas.find((idea) => idea.id === id);
const bodyOf = (page) => page.getByRole('textbox', { name: 'Idea body' });

test('opening an idea shows it formatted and never rewrites what is saved', async ({ app, page }) => {
  // Star bullets are not how the editor writes lists, so any rewrite would show.
  const idea = await create(app, 'Hook', '# Hook\n\nA **bold** claim.\n\n* star bullet\n* another');
  await app.goto(`/creation/${idea.id}`);
  const body = bodyOf(page);
  await expect(body.locator('h1')).toHaveText('Hook');
  await expect(body.locator('strong')).toHaveText('bold');
  await expect(body.locator('li')).toHaveCount(2);
  await page.waitForTimeout(1500); // past the autosave delay
  expect(await stored(app, idea.id)).toMatchObject({ markdown: idea.markdown, updatedAt: idea.updatedAt });
});

test('Markdown the editor cannot show faithfully opens as Markdown, untouched', async ({ app, page }) => {
  const markdown = 'Line<br>with html\n\n- a\n\n- b';
  const idea = await create(app, 'Raw', markdown);
  await app.goto(`/creation/${idea.id}`);
  await expect(page.locator('.editor-note')).toContainText('exactly as written');
  const source = page.getByRole('textbox', { name: 'Idea Markdown' });
  await expect(source).toHaveValue(markdown);
  await expect(page.getByRole('button', { name: 'Write', exact: true })).toBeDisabled();
  await page.waitForTimeout(1200);
  expect((await stored(app, idea.id)).markdown).toBe(markdown);

  // It stays editable as text.
  await source.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\nmore');
  await expect.poll(async () => (await stored(app, idea.id)).markdown).toBe(`${markdown}\n\nmore`);
});

test('Write and Markdown show the same idea, one formatted and one as text', async ({ app, page }) => {
  const idea = await create(app, 'Modes', '## Plan\n\n- [ ] one');
  await app.goto(`/creation/${idea.id}`);
  await expect(bodyOf(page).locator('h2')).toHaveText('Plan');

  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Idea Markdown' });
  await expect(source).toHaveValue('## Plan\n\n- [ ] one');
  await source.fill('# Changed\n\n- [x] done');
  await expect.poll(async () => (await stored(app, idea.id)).markdown).toBe('# Changed\n\n- [x] done');

  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(bodyOf(page).locator('h1')).toHaveText('Changed');
  await expect(bodyOf(page).locator('input[type="checkbox"]')).toBeChecked();
});

test('shortcuts, the toolbar and the link dialog format as you write', async ({ app, page }) => {
  const idea = await create(app, 'Format', '');
  await app.goto(`/creation/${idea.id}`);
  const body = bodyOf(page);
  await body.click();
  await page.keyboard.type('plain ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' tail');
  await expect(body.locator('strong')).toHaveText('bold');
  await expect(page.getByRole('button', { name: 'Bold ⌘B' })).not.toHaveClass(/is-active/);

  // ⌘K asks for an address and links the selection.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: 'Add link' })).toBeVisible();
  await dialog.getByLabel('Address').fill('example.com');
  await page.keyboard.press('Enter');
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com');
  await expect.poll(async () => (await stored(app, idea.id)).markdown).toBe('[plain **bold** tail](https://example.com)');

  // The toolbar acts on the document, and shows what is under the caret.
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(body.locator('table')).toHaveCount(1);
  await page.getByRole('button', { name: 'Checklist' }).click();
  await expect.poll(async () => (await stored(app, idea.id)).markdown).toContain('| --- |');
});

test('an agent’s edit shows up in the open editor, and Markdown pastes as formatting', async ({ app, page }) => {
  const idea = await create(app, 'Live', 'First draft');
  await app.goto(`/creation/${idea.id}`);
  const body = bodyOf(page);
  await expect(body).toContainText('First draft');

  await app.cli(['run', 'creation.update', '--ideaId', idea.id, '--markdown', '# Rewritten by an agent']);
  await expect(body.locator('h1')).toHaveText('Rewritten by an agent');

  // Plain-text Markdown from a chat or a README becomes the real thing.
  await body.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await body.evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/plain', '## Pasted\n\n- one\n- two');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(body.locator('h2')).toHaveText('Pasted');
  await expect(body.locator('li')).toHaveCount(2);
});

test('⌘Z inside the editor undoes typing, not the last change in Activity', async ({ app, page }) => {
  const idea = await create(app, 'Undo', 'Keep this');
  await app.goto(`/creation/${idea.id}`);
  const body = bodyOf(page);
  await body.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' and this');
  await expect(body).toContainText('Keep this and this');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(body).not.toContainText('and this');
  await expect(body).toContainText('Keep this');
  await expect(page.getByRole('button', { name: 'Write', exact: true })).toBeVisible();
});

test('punctuation is stored as typed, and whatever is typed reads back the same', async ({ app, page }) => {
  const idea = await create(app, 'Punctuation', '');
  await app.goto(`/creation/${idea.id}`);
  const body = bodyOf(page);
  await body.click();
  await page.keyboard.type('Use snake_case, 2 * 3 and [Música sobe] here');
  await expect.poll(async () => (await stored(app, idea.id)).markdown).toBe('Use snake_case, 2 * 3 and [Música sobe] here');

  // Random mixes of the characters Markdown cares about survive a save and a reload.
  const failures = await page.evaluate(async () => {
    const { createEditor } = await import('/vendor/creation-editor.js');
    const host = document.createElement('div');
    document.body.append(host);
    const controller = createEditor(host, { markdown: '' });
    const { editor } = controller;
    const alphabet = ['a', 'b', 'é', '1', '_', '*', '[', ']', '(', ')', '~', '`', '\\', '!', ':', ' ', ' ', '#', '-', '>', '|', '<', '&', '.', 'x'];
    const starts = ['x', '1. ', 'a) ', 'I. ', '# ', '- ', '> ', '+ ', '', '[ ] ', '[x] '];
    let seed = 12345;
    const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (list) => list[Math.floor(random() * list.length)];
    const bad = [];
    for (let run = 0; run < 1500; run += 1) {
      const text = Array.from({ length: 1 + Math.floor(random() * 14) }, () => pick(alphabet)).join('').replace(/^\s+/, '');
      const paragraph = { type: 'paragraph', content: [{ type: 'text', text: `${pick(starts)}${text}x` }] };
      for (const content of [paragraph, { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph] }] }]) {
        editor.commands.setContent({ type: 'doc', content: [content] }, { emitUpdate: false });
        const expected = editor.state.doc;
        const markdown = controller.getMarkdown();
        editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
        if (!editor.state.doc.eq(expected)) bad.push(markdown);
      }
    }
    controller.destroy();
    return bad.slice(0, 5);
  });
  expect(failures).toEqual([]);
});
