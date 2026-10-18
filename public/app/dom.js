// Rendering primitives. Screens return `html` templates (interpolations are
// escaped unless they are themselves templates), and `morph` patches the live
// DOM to match, keeping focus, caret, scroll and element identity. Keyed rows
// (data-key) move instead of being recreated.

export class Html {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('`', '&#096;');
}

function renderValue(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let index = 0; index < values.length; index += 1) out += renderValue(values[index]) + strings[index + 1];
  return new Html(out);
}

export const raw = (value) => new Html(String(value ?? ''));
export const when = (condition, value, otherwise = '') => (condition ? (typeof value === 'function' ? value() : value) : otherwise);
export const attr = (name, value) => (value === null || value === undefined || value === false ? '' : raw(value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`));
export const cx = (...names) => names.flat().filter(Boolean).join(' ');

const template = typeof document !== 'undefined' ? document.createElement('template') : null;

export function morph(target, next) {
  template.innerHTML = next instanceof Html ? next.value : String(next);
  morphChildren(target, template.content);
}

function keyOf(node) {
  if (node.nodeType !== 1) return null;
  return node.getAttribute('data-key') || node.id || null;
}

function morphChildren(from, to) {
  const fromKeyed = new Map();
  for (const child of from.childNodes) {
    const key = keyOf(child);
    if (key) fromKeyed.set(key, child);
  }
  let cursor = from.firstChild;
  const incoming = [...to.childNodes];
  for (const next of incoming) {
    const key = keyOf(next);
    let match = null;
    if (key) {
      match = fromKeyed.get(key) || null;
      if (match && match.nodeName !== next.nodeName) match = null;
    } else if (cursor && !keyOf(cursor) && sameKind(cursor, next)) {
      match = cursor;
    } else {
      // Look a little ahead for an unkeyed node of the same kind (e.g. after a removal).
      let probe = cursor;
      for (let steps = 0; probe && steps < 3; steps += 1, probe = probe.nextSibling) {
        if (!keyOf(probe) && sameKind(probe, next)) { match = probe; break; }
      }
    }
    if (match) {
      if (key) fromKeyed.delete(key);
      if (match !== cursor) from.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      morphNode(match, next);
    } else {
      from.insertBefore(next, cursor);
    }
  }
  while (cursor) {
    const following = cursor.nextSibling;
    if (!(cursor.nodeType === 1 && cursor.hasAttribute('data-persist'))) from.removeChild(cursor);
    cursor = following;
  }
}

function sameKind(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
}

function morphNode(from, to) {
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.nodeType !== 1) return;
  if (to.hasAttribute('data-morph-ignore') && from.hasAttribute('data-morph-ignore')) return;
  // data-morph-key: the subtree is only revisited when this value changes.
  const stable = from.getAttribute('data-morph-key');
  if (stable !== null && stable === to.getAttribute('data-morph-key')) return;
  syncAttributes(from, to);
  syncFormState(from, to);
  if (from.nodeName === 'TEXTAREA') return;
  morphChildren(from, to);
  if (from.nodeName === 'SELECT') {
    const selected = [...to.querySelectorAll('option')].findIndex((option) => option.hasAttribute('selected'));
    if (selected >= 0 && from.selectedIndex !== selected) from.selectedIndex = selected;
  }
}

function syncAttributes(from, to) {
  const keepOpen = from.hasAttribute('data-keep-open');
  for (const { name } of [...from.attributes]) {
    if (!to.hasAttribute(name) && !(keepOpen && name === 'open')) from.removeAttribute(name);
  }
  for (const { name, value } of to.attributes) {
    if (keepOpen && name === 'open') continue;
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

function syncFormState(from, to) {
  const focused = from === document.activeElement;
  if (from.nodeName === 'INPUT') {
    const type = from.type;
    if (type === 'checkbox' || type === 'radio') {
      const checked = to.hasAttribute('checked');
      if (from.checked !== checked) from.checked = checked;
    } else if (!focused || to.hasAttribute('data-force-value')) {
      const value = to.getAttribute('value') ?? '';
      if (from.value !== value) from.value = value;
    }
  } else if (from.nodeName === 'TEXTAREA') {
    const value = to.textContent;
    if ((!focused || to.hasAttribute('data-force-value')) && from.value !== value) from.value = value;
  }
}

// A set figure: numerals full size, unit letters small ("314h 36m").
export function figure(value) {
  const text = String(value ?? '');
  if (!/\d/.test(text) || !/[a-z%]/i.test(text)) return text;
  return html`${text.split(/(\d[\d.,]*)/).filter(Boolean).map((part) => (/^\d/.test(part) ? part : html`<small>${part}</small>`))}`;
}

export function closestData(element, name) {
  const holder = element?.closest?.(`[data-${name}]`);
  return holder ? holder.getAttribute(`data-${name}`) : null;
}

export function focusSoon(selector, { select = false } = {}) {
  requestAnimationFrame(() => {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!element) return;
    element.focus({ preventScroll: false });
    if (select && typeof element.select === 'function') element.select();
  });
}

export function uid() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
