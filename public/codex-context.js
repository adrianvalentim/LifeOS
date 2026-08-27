const CONTEXT_KINDS = {
  project: 'project',
  book: 'book',
};

export function renderCodexContextButton(kind, id, label) {
  const itemKind = CONTEXT_KINDS[kind];
  if (!itemKind) return '';
  return `
    <button
      class="codex-context-trigger"
      data-codex-context-kind="${escapeAttribute(kind)}"
      data-codex-context-id="${escapeAttribute(id)}"
      type="button"
      aria-label="Attach ${escapeAttribute(label)} ${itemKind} to Codex"
      title="Attach to Codex"
    >
      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9h8M8.5 5.5 12 9l-3.5 3.5M14.5 4.5v9"/></svg>
    </button>
  `;
}

export function createProjectCodexContext(project, domain) {
  if (!project?.id) return null;
  const domainSnapshot = domain ? { id: project.domain, ...domain } : { id: project.domain };
  const payload = {
    itemType: 'project',
    stableId: project.id,
    record: project,
    domain: domainSnapshot,
  };
  return {
    kind: 'project',
    id: project.id,
    label: project.name || project.id,
    meta: [domain?.label, statusLabel(project.status)].filter(Boolean).join(' · '),
    message: contextMessage('project', payload, true),
  };
}

export function createBookCodexContext(book) {
  if (!book?.id) return null;
  const payload = {
    itemType: 'reading_book',
    stableId: book.id,
    record: book,
  };
  return {
    kind: 'book',
    id: book.id,
    label: book.title || book.id,
    meta: [book.authors?.join(', '), statusLabel(book.status)].filter(Boolean).join(' · '),
    message: contextMessage('reading book', payload, false),
  };
}

export function codexMessageWithContext(context, draft) {
  const userMessage = String(draft ?? '').trim();
  if (!userMessage) return '';
  const itemContext = String(context?.message || '').trim();
  return itemContext ? `${itemContext}\n\n${userMessage}` : userMessage;
}

function contextMessage(label, payload, includesDerivedFields) {
  const snapshotDescription = includesDerivedFields
    ? 'This is the current LifeOS view-model snapshot, so some health and activity fields are derived.'
    : 'This is the current LifeOS record snapshot.';
  return [
    `The user attached this exact existing LifeOS ${label} as context.`,
    'Use its stable ID to distinguish it from similarly named items.',
    snapshotDescription,
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');
}

function statusLabel(value) {
  if (!value) return '';
  return String(value)
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('`', '&#096;');
}
