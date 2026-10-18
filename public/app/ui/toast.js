// Bottom-center notifications. Every successful change offers Undo for a few
// seconds; errors stay a little longer. Rendered outside the morphed tree.
import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';

let container = null;
const handlers = { undo: null, redo: null };
const MAX = 4;

export function configureToasts({ onUndo, onRedo }) {
  handlers.undo = onUndo;
  handlers.redo = onRedo;
}

function ensureContainer() {
  if (container?.isConnected) return container;
  container = document.createElement('div');
  container.className = 'toasts';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  document.body.append(container);
  return container;
}

export function toast(message, { tone = 'info', undo = null, redo = false, action = null, timeout } = {}) {
  if (typeof document === 'undefined' || !message) return;
  const root = ensureContainer();
  const element = document.createElement('div');
  element.className = `toast toast-${tone}`;
  const iconName = tone === 'error' ? 'warning' : tone === 'agent' ? 'sparkle' : undo ? 'check' : 'info';
  element.innerHTML = `
    <span class="toast-icon">${icon(iconName, { size: 15 })}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    ${undo ? `<button class="toast-action" data-toast-undo type="button">Undo <kbd>⌘Z</kbd></button>` : ''}
    ${redo ? '<button class="toast-action" data-toast-redo type="button">Redo</button>' : ''}
    ${action ? `<button class="toast-action" data-toast-action type="button">${escapeHtml(action.label)}</button>` : ''}
    <button class="toast-close" data-toast-close type="button" aria-label="Dismiss">${icon('x', { size: 13 })}</button>`;
  const dismiss = () => {
    element.classList.add('is-leaving');
    setTimeout(() => element.remove(), 180);
  };
  element.querySelector('[data-toast-undo]')?.addEventListener('click', () => { dismiss(); handlers.undo?.(undo); });
  element.querySelector('[data-toast-redo]')?.addEventListener('click', () => { dismiss(); handlers.redo?.(); });
  element.querySelector('[data-toast-action]')?.addEventListener('click', () => { dismiss(); action.run(); });
  element.querySelector('[data-toast-close]').addEventListener('click', dismiss);
  let timer = setTimeout(dismiss, timeout ?? (tone === 'error' ? 8000 : undo ? 6000 : 3500));
  element.addEventListener('pointerenter', () => clearTimeout(timer));
  element.addEventListener('pointerleave', () => { timer = setTimeout(dismiss, 2500); });
  root.append(element);
  while (root.children.length > MAX) root.firstElementChild.remove();
  requestAnimationFrame(() => element.classList.add('is-in'));
}
