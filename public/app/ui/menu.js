// The one menu system. Context menus, "⋯" buttons, pickers and submenus all
// use it, so every menu behaves the same: arrow keys, type-ahead, → and ← for
// submenus, Enter to choose, Esc to step back, a search field when a list is
// long, checkmarks for the current value and shortcuts shown on the right.
import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';

const stack = [];
let restoreTarget = null;
let layer = null;

function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'menu-layer';
  document.body.append(layer);
  document.addEventListener('pointerdown', (event) => {
    if (!stack.length) return;
    if (stack.some((level) => level.element.contains(event.target))) return;
    closeMenus({ restoreFocus: false });
  }, true);
  window.addEventListener('resize', () => closeMenus({ restoreFocus: false }));
  window.addEventListener('blur', () => closeMenus({ restoreFocus: false }));
  return layer;
}

export function isMenuOpen() {
  return stack.length > 0;
}

export function closeMenus({ restoreFocus = true } = {}) {
  while (stack.length) {
    const level = stack.pop();
    level.element.remove();
    level.onClose?.();
  }
  if (restoreFocus && restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
  restoreTarget = null;
}

function closeFrom(depth) {
  while (stack.length > depth) {
    const level = stack.pop();
    level.element.remove();
    if (depth === 0) level.onClose?.();
  }
}

/**
 * @param {object} options
 * @param {Element|{x:number,y:number}} options.anchor
 * @param {Array|function(string):Array} options.items
 * @param {{placeholder?:string, create?:(query:string)=>object|null}} [options.search]
 * @param {'start'|'end'} [options.align]
 * @param {number} [options.width]
 * @param {string} [options.title]
 * @param {() => void} [options.onClose]
 */
export function openMenu(options) {
  closeMenus({ restoreFocus: false });
  restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return openLevel(options, 0);
}

function openLevel(options, depth) {
  ensureLayer();
  const element = document.createElement('div');
  element.className = `menu ${options.className || ''}`;
  element.setAttribute('role', 'menu');
  if (options.width) element.style.width = `${options.width}px`;
  const level = { element, options, depth, query: '', items: [], onClose: options.onClose };
  stack.push(level);
  layer.append(element);
  paint(level);
  position(element, options.anchor, options.align || 'start', depth > 0);
  const search = element.querySelector('.menu-search input');
  if (search) search.focus();
  else focusables(element)[options.focusIndex ?? 0]?.focus();
  element.addEventListener('keydown', (event) => onKey(event, level));
  element.addEventListener('click', (event) => onClick(event, level));
  element.addEventListener('pointerover', (event) => onHover(event, level));
  element.addEventListener('input', (event) => {
    if (!event.target.matches('.menu-search input')) return;
    level.query = event.target.value;
    paint(level, { keepSearch: true });
  });
  return { close: () => closeMenus(), refresh: () => paint(level, { keepSearch: true }) };
}

function resolveItems(level) {
  const source = level.options.items;
  let items = typeof source === 'function' ? source(level.query) : source;
  items = (items || []).filter(Boolean);
  if (level.options.search && level.query.trim()) {
    const query = level.query.trim().toLowerCase();
    if (typeof source !== 'function') {
      items = items.filter((item) => item.type && item.type !== 'item' ? false : String(item.label || '').toLowerCase().includes(query) || String(item.keywords || '').toLowerCase().includes(query));
    }
    const created = level.options.search.create?.(level.query.trim());
    if (created && !items.some((item) => String(item.label || '').toLowerCase() === query)) items.push(created);
  }
  return items;
}

function paint(level, { keepSearch = false } = {}) {
  const items = resolveItems(level);
  level.items = items;
  const { element, options } = level;
  const searchMarkup = options.search
    ? `<div class="menu-search">${icon('search', { size: 14 })}<input type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(options.search.placeholder || 'Search…')}" value="${escapeHtml(level.query)}"></div>`
    : '';
  const body = items.map((item, index) => renderItem(item, index)).join('') || '<div class="menu-empty">Nothing here</div>';
  if (keepSearch && element.querySelector('.menu-items')) {
    element.querySelector('.menu-items').innerHTML = body;
  } else {
    element.innerHTML = `${options.title ? `<div class="menu-title">${escapeHtml(options.title)}</div>` : ''}${searchMarkup}<div class="menu-items">${body}</div>`;
  }
  element.querySelectorAll('[data-custom-index]').forEach((holder) => {
    const item = items[Number(holder.dataset.customIndex)];
    item.mount?.(holder, { close: () => closeMenus(), refresh: () => paint(level, { keepSearch: true }) });
  });
}

function renderItem(item, index) {
  if (item.type === 'separator') return '<div class="menu-sep" role="separator"></div>';
  if (item.type === 'header') return `<div class="menu-header">${escapeHtml(item.label)}</div>`;
  if (item.type === 'note') return `<div class="menu-note">${escapeHtml(item.label)}</div>`;
  if (item.type === 'chips') {
    return `<div class="menu-chips" role="group" aria-label="${escapeHtml(item.label || '')}">${item.label ? `<span class="menu-chips-label">${escapeHtml(item.label)}</span>` : ''}<div class="menu-chip-row">${item.options.map((option, optionIndex) => `
      <button type="button" class="menu-chip ${option.active ? 'is-active' : ''} ${option.className || ''}" data-index="${index}" data-chip="${optionIndex}" role="menuitemradio" aria-checked="${option.active ? 'true' : 'false'}" title="${escapeHtml(option.title || option.label)}">${option.icon ? icon(option.icon, { size: 14 }) : ''}${option.label ? `<span>${escapeHtml(option.label)}</span>` : ''}</button>`).join('')}</div></div>`;
  }
  if (item.type === 'custom') return `<div class="menu-custom" data-custom-index="${index}">${item.render ? item.render() : ''}</div>`;
  const role = item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
  return `<button type="button" class="menu-item ${item.danger ? 'is-danger' : ''} ${item.checked ? 'is-checked' : ''}" data-index="${index}" role="${role}" ${item.checked !== undefined ? `aria-checked="${String(item.checked)}"` : ''} ${item.disabled ? 'disabled' : ''} ${item.submenu ? 'aria-haspopup="menu"' : ''}>
    <span class="menu-icon">${item.swatch ? `<i class="menu-swatch" style="--swatch:${escapeHtml(item.swatch)}"></i>` : item.icon ? icon(item.icon, { size: 15 }) : item.checked !== undefined ? (item.checked ? icon('check', { size: 15 }) : '') : ''}</span>
    <span class="menu-label">${escapeHtml(item.label)}${item.description ? `<small>${escapeHtml(item.description)}</small>` : ''}</span>
    ${item.hint ? `<span class="menu-hint">${escapeHtml(item.hint)}</span>` : ''}
    ${item.shortcut ? `<kbd class="menu-kbd">${escapeHtml(item.shortcut)}</kbd>` : ''}
    ${item.submenu ? `<span class="menu-sub">${icon('chevron-right', { size: 14 })}</span>` : item.checked && item.icon ? `<span class="menu-sub">${icon('check', { size: 14 })}</span>` : ''}
  </button>`;
}

function focusables(element) {
  return [...element.querySelectorAll('.menu-item:not([disabled]), .menu-chip, .menu-custom [data-menu-focus]')];
}

function activate(level, target, { viaKeyboard = false } = {}) {
  const index = Number(target.dataset.index);
  const item = level.items[index];
  if (!item) return;
  if (target.classList.contains('menu-chip')) {
    const option = item.options[Number(target.dataset.chip)];
    if (!option) return;
    if (!item.keepOpen && !option.keepOpen) closeMenus();
    option.run?.();
    if (item.keepOpen || option.keepOpen) paint(level, { keepSearch: true });
    return;
  }
  if (item.submenu) {
    openSubmenu(level, target, item, viaKeyboard);
    return;
  }
  if (item.disabled) return;
  if (item.keepOpen) {
    item.run?.();
    paint(level, { keepSearch: true });
    const again = level.element.querySelector(`[data-index="${index}"]`);
    again?.focus();
    return;
  }
  closeMenus();
  item.run?.();
}

function openSubmenu(level, target, item, focusFirst) {
  closeFrom(level.depth + 1);
  level.element.querySelectorAll('.menu-item.is-open').forEach((node) => node.classList.remove('is-open'));
  target.classList.add('is-open');
  const items = typeof item.submenu === 'function' ? item.submenu : item.submenu;
  const sub = openLevel({ anchor: target, items, search: item.search, width: item.width, className: 'is-sub' }, level.depth + 1);
  if (!focusFirst) target.focus();
  return sub;
}

let hoverTimer = 0;
function onHover(event, level) {
  const target = event.target.closest('.menu-item');
  if (!target || !level.element.contains(target)) return;
  if (document.activeElement !== target && !level.element.querySelector('.menu-search input:focus')) target.focus({ preventScroll: true });
  clearTimeout(hoverTimer);
  const item = level.items[Number(target.dataset.index)];
  hoverTimer = setTimeout(() => {
    if (!target.isConnected) return;
    if (item?.submenu) openSubmenu(level, target, item, false);
    else closeFrom(level.depth + 1);
  }, 110);
}

function onClick(event, level) {
  const target = event.target.closest('.menu-item, .menu-chip');
  if (!target || !level.element.contains(target)) return;
  event.preventDefault();
  activate(level, target);
}

function onKey(event, level) {
  const items = focusables(level.element);
  const current = document.activeElement;
  const index = items.indexOf(current);
  const inSearch = current?.matches?.('.menu-search input');
  // Fields inside custom items (a typed date, a time) keep their own keys.
  const inField = !inSearch && current?.matches?.('input, textarea, select');
  if (inField && !['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) return;
  const move = (delta) => {
    event.preventDefault();
    if (!items.length) return;
    const next = index < 0 ? (delta > 0 ? 0 : items.length - 1) : (index + delta + items.length) % items.length;
    items[next].focus();
  };
  switch (event.key) {
    case 'ArrowDown': move(1); break;
    case 'ArrowUp': move(-1); break;
    case 'Home': if (!inSearch) { event.preventDefault(); items[0]?.focus(); } break;
    case 'End': if (!inSearch) { event.preventDefault(); items.at(-1)?.focus(); } break;
    case 'ArrowRight':
      if (current?.classList.contains('menu-chip')) {
        event.preventDefault();
        const row = [...current.parentElement.children];
        row[(row.indexOf(current) + 1) % row.length].focus();
      } else if (current?.getAttribute('aria-haspopup') === 'menu') {
        event.preventDefault();
        activate(level, current, { viaKeyboard: true });
      }
      break;
    case 'ArrowLeft':
      if (current?.classList.contains('menu-chip')) {
        event.preventDefault();
        const row = [...current.parentElement.children];
        row[(row.indexOf(current) - 1 + row.length) % row.length].focus();
      } else if (level.depth > 0 && !inSearch) {
        event.preventDefault();
        closeFrom(level.depth);
        stack[level.depth - 1]?.element.querySelector('.menu-item.is-open')?.focus();
      }
      break;
    case 'Enter':
    case ' ':
      if (inSearch && event.key === ' ') return;
      event.preventDefault();
      if (inSearch) {
        const first = items[0];
        if (first) activate(level, first, { viaKeyboard: true });
      } else if (current && level.element.contains(current) && (current.classList.contains('menu-item') || current.classList.contains('menu-chip'))) {
        activate(level, current, { viaKeyboard: true });
      }
      break;
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      if (level.depth > 0) {
        closeFrom(level.depth);
        stack[level.depth - 1]?.element.querySelector('.menu-item.is-open')?.focus();
      } else closeMenus();
      break;
    case 'Tab':
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
      break;
    default:
      if (!inSearch && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Type-ahead: jump to the next item starting with this letter.
        const letter = event.key.toLowerCase();
        const start = index + 1;
        const ordered = [...items.slice(start), ...items.slice(0, start)];
        const match = ordered.find((node) => node.textContent.trim().toLowerCase().startsWith(letter));
        if (match) { event.preventDefault(); match.focus(); }
      }
  }
}

function position(element, anchor, align, isSub) {
  const margin = 8;
  const rect = anchor instanceof Element
    ? anchor.getBoundingClientRect()
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left;
  let top;
  if (isSub) {
    left = rect.right + 4;
    if (left + width > vw - margin) left = rect.left - width - 4;
    top = rect.top - 6;
  } else {
    left = align === 'end' ? rect.right - width : rect.left;
    top = rect.bottom + 6;
    if (top + height > vh - margin && rect.top - height - 6 > margin) top = rect.top - height - 6;
  }
  left = Math.max(margin, Math.min(left, vw - width - margin));
  top = Math.max(margin, Math.min(top, vh - height - margin));
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
  element.style.maxHeight = `${vh - margin * 2}px`;
}
