// Pointer drag-and-drop shared by tasks, projects, books and ideas. Pressing is
// inert; a drag starts only after real movement (or a long press on touch), so
// clicks stay clicks. The preview is the card itself, lifted, keeping the grab
// offset. Targets are found under the pointer; nearby scroll areas auto-scroll.
// A card's title link is a handle like the rest of the card: the browser's own
// link drag is cancelled so it can't take over the gesture (it would cancel the
// pointer, then navigate or error when dropped).

const THRESHOLD = 5;
const TOUCH_HOLD = 320;
const EDGE = 64;
let active = null;

export function isDragging() {
  return Boolean(active?.started);
}

/**
 * @param {PointerEvent} event
 * @param {object} options
 * @param {HTMLElement} options.source  element to lift
 * @param {(info) => void} [options.onStart]
 * @param {(info) => void} options.onMove  info: { x, y, target, dx, dy }
 * @param {(info) => void} options.onDrop
 * @param {() => void} [options.onCancel]
 * @param {HTMLElement} [options.scroller] preferred scroll container
 */
export function beginDrag(event, options) {
  if (event.button !== 0 || active) return;
  if (event.target.closest('button, input, textarea, select, [contenteditable="true"], [data-no-drag]')) return;
  const rect = options.source.getBoundingClientRect();
  active = {
    ...options,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    started: false,
    touch: event.pointerType === 'touch',
    holdTimer: 0,
    frame: 0,
    scrollFrame: 0,
  };
  if (active.touch) {
    active.holdTimer = setTimeout(() => { if (active && !active.started) start(); }, TOUCH_HOLD);
  }
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('dragstart', onNativeDrag, true);
}

function onNativeDrag(event) {
  event.preventDefault();
}

function start() {
  const { source } = active;
  active.started = true;
  const preview = source.cloneNode(true);
  preview.classList.add('drag-preview');
  preview.removeAttribute('id');
  preview.style.width = `${active.width}px`;
  preview.style.transition = 'none';
  document.body.append(preview);
  active.preview = preview;
  source.classList.add('is-drag-source');
  document.body.classList.add('is-dragging');
  window.getSelection()?.removeAllRanges();
  position();
  active.onStart?.(info());
}

function info() {
  if (!active) return {};
  const hidden = active.preview;
  if (hidden) hidden.style.display = 'none';
  const target = document.elementFromPoint(active.x, active.y);
  if (hidden) hidden.style.display = '';
  return { x: active.x, y: active.y, target, dx: active.x - active.startX, dy: active.y - active.startY };
}

function position() {
  if (!active?.preview) return;
  active.preview.style.transform = `translate3d(${Math.round(active.x - active.offsetX)}px, ${Math.round(active.y - active.offsetY)}px, 0) rotate(0.6deg)`;
}

function onPointerMove(event) {
  if (!active || event.pointerId !== active.pointerId) return;
  active.x = event.clientX;
  active.y = event.clientY;
  if (!active.started) {
    const distance = Math.hypot(active.x - active.startX, active.y - active.startY);
    if (active.touch) {
      if (distance > 10) cleanup(); // a scroll, not a drag
      return;
    }
    if (distance < THRESHOLD) return;
    start();
  }
  event.preventDefault();
  if (active.frame) return;
  active.frame = requestAnimationFrame(() => {
    if (!active) return;
    active.frame = 0;
    position();
    active.onMove?.(info());
    autoScroll();
  });
}

function scrollParent(element) {
  let node = element;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

function autoScroll() {
  cancelAnimationFrame(active.scrollFrame);
  const target = info().target;
  const scroller = active.scroller || scrollParent(target) || scrollParent(active.source);
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  let speed = 0;
  if (active.y < rect.top + EDGE) speed = -Math.ceil(((rect.top + EDGE - active.y) / EDGE) * 16);
  else if (active.y > rect.bottom - EDGE) speed = Math.ceil(((active.y - (rect.bottom - EDGE)) / EDGE) * 16);
  if (!speed) return;
  const step = () => {
    if (!active?.started) return;
    scroller.scrollTop += speed;
    active.onMove?.(info());
    active.scrollFrame = requestAnimationFrame(step);
  };
  active.scrollFrame = requestAnimationFrame(step);
}

function onPointerUp(event) {
  if (!active || event.pointerId !== active.pointerId) return;
  if (!active.started) { cleanup(); return; }
  active.x = event.clientX;
  active.y = event.clientY;
  const handler = active.onDrop;
  const final = info();
  // Swallow the click that follows a drag.
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
  cleanup();
  handler?.(final);
}

function swallow(event) {
  event.stopPropagation();
  event.preventDefault();
}

function onKeyDown(event) {
  if (event.key === 'Escape' && active) {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
}

function cancel() {
  if (!active) return;
  const handler = active.onCancel;
  const started = active.started;
  cleanup();
  if (started) handler?.();
}

function cleanup() {
  if (!active) return;
  clearTimeout(active.holdTimer);
  cancelAnimationFrame(active.frame);
  cancelAnimationFrame(active.scrollFrame);
  active.preview?.remove();
  active.source?.classList.remove('is-drag-source');
  document.body.classList.remove('is-dragging');
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', cancel);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('dragstart', onNativeDrag, true);
  active = null;
}
