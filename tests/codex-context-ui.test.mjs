import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codexMessageWithContext,
  createBookCodexContext,
  createProjectCodexContext,
  renderCodexContextButton,
} from '../public/codex-context.js';

test('project context preserves the stable ID, exact snapshot, and domain metadata', () => {
  const project = {
    id: 'project-1',
    name: 'Portia',
    domain: 'creative',
    status: 'doing',
    note: 'Draft Act III',
    weekHoursLabel: '4h',
  };
  const context = createProjectCodexContext(project, { label: 'Creative', color: '#a44a26' });

  assert.equal(context.kind, 'project');
  assert.equal(context.id, 'project-1');
  assert.equal(context.label, 'Portia');
  assert.equal(context.meta, 'Creative · Doing');
  assert.match(context.message, /"stableId": "project-1"/);
  assert.match(context.message, /"note": "Draft Act III"/);
  assert.match(context.message, /"label": "Creative"/);
  assert.match(context.message, /fields are derived/);
});

test('book context preserves the full current reading record', () => {
  const context = createBookCodexContext({
    id: 'book-1',
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    status: 'reading',
    tags: ['Fiction'],
    description: 'An exact description.',
  });

  assert.equal(context.kind, 'book');
  assert.equal(context.meta, 'Ursula K. Le Guin · Reading');
  assert.match(context.message, /"stableId": "book-1"/);
  assert.match(context.message, /"tags": \[/);
  assert.match(context.message, /An exact description\./);
});

test('Codex receives attached context, one blank line, and then the user instruction', () => {
  const context = createBookCodexContext({ id: 'book-1', title: 'Book', authors: [], status: 'next_up' });
  const message = codexMessageWithContext(context, 'Change its status to reading.');

  assert.ok(message.endsWith('```\n\nChange its status to reading.'));
  assert.equal(codexMessageWithContext(context, '   '), '');
  assert.equal(codexMessageWithContext(null, '  Hello  '), 'Hello');
});

test('context trigger is a compact accessible button with exact item identity', () => {
  const html = renderCodexContextButton('project', 'project-1', 'Portia');
  assert.match(html, /class="codex-context-trigger"/);
  assert.match(html, /data-codex-context-kind="project"/);
  assert.match(html, /data-codex-context-id="project-1"/);
  assert.match(html, /aria-label="Attach Portia project to Codex"/);
  assert.match(html, /type="button"/);

  const bookHtml = renderCodexContextButton('book', 'book-1', 'The Dispossessed');
  assert.match(bookHtml, /aria-label="Attach The Dispossessed book to Codex"/);
});
