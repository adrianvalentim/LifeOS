// Modal dialogs for the few moments that deserve one: permanent deletions and
// small forms. Built on <dialog> for a real focus trap and Escape handling.
import { escapeHtml, Html } from '../dom.js';
import { icon } from '../icons.js';

let open = null;

export function isDialogOpen() {
  return Boolean(open);
}

export function confirmDialog({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    showDialog({
      title,
      className: danger ? 'is-danger' : '',
      content: `<p class="dialog-body">${body instanceof Html ? body.value : escapeHtml(body)}</p>`,
      actions: [
        { label: cancelLabel, value: false, autofocus: true },
        { label: confirmLabel, value: true, primary: !danger, danger },
      ],
      onClose: (value) => resolve(Boolean(value)),
    });
  });
}

/**
 * A form dialog. `fields`: [{ name, label, type, value, options, placeholder, required, hint }]
 * Resolves with the submitted values, or null when cancelled.
 */
export function formDialog({ title, description = '', fields, submitLabel = 'Save', cancelLabel = 'Cancel', danger = false, validate }) {
  return new Promise((resolve) => {
    const content = `${description ? `<p class="dialog-body">${escapeHtml(description)}</p>` : ''}
      <div class="dialog-fields">${fields.map(renderField).join('')}</div>
      <p class="dialog-error" hidden></p>`;
    showDialog({
      title,
      content,
      form: true,
      actions: [
        { label: cancelLabel, value: null },
        { label: submitLabel, submit: true, primary: !danger, danger },
      ],
      onSubmit: (form) => {
        const values = {};
        for (const field of fields) {
          const control = form.elements[field.name];
          if (!control) continue;
          if (field.type === 'checkbox') values[field.name] = control.checked;
          else if (field.type === 'number') values[field.name] = control.value === '' ? null : Number(control.value);
          else values[field.name] = control.value;
        }
        const problem = validate?.(values);
        if (problem) return problem;
        return { value: values };
      },
      onClose: (value) => resolve(value ?? null),
    });
  });
}

function renderField(field) {
  const id = `dialog-${field.name}`;
  const common = `id="${id}" name="${escapeHtml(field.name)}" ${field.required ? 'required' : ''} ${field.autofocus ? 'autofocus' : ''}`;
  let control;
  if (field.type === 'select') {
    control = `<select ${common}>${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value ?? '') ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    control = `<textarea ${common} rows="${field.rows || 4}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(field.value ?? '')}</textarea>`;
  } else if (field.type === 'checkbox') {
    return `<label class="dialog-check"><input type="checkbox" ${common} ${field.value ? 'checked' : ''}><span>${escapeHtml(field.label)}</span></label>`;
  } else {
    control = `<input type="${field.type || 'text'}" ${common} value="${escapeHtml(field.value ?? '')}" placeholder="${escapeHtml(field.placeholder || '')}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.step !== undefined ? `step="${field.step}"` : ''} autocomplete="off">`;
  }
  return `<label class="dialog-field" for="${id}"><span>${escapeHtml(field.label)}</span>${control}${field.hint ? `<small>${escapeHtml(field.hint)}</small>` : ''}</label>`;
}

function showDialog({ title, content, actions, form = false, onSubmit, onClose, className = '' }) {
  open?.close();
  const dialog = document.createElement('dialog');
  dialog.className = `dialog ${className}`;
  const tag = form ? 'form' : 'div';
  dialog.innerHTML = `<${tag} class="dialog-inner" ${form ? 'method="dialog" novalidate' : ''}>
    <header class="dialog-head"><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button" data-dialog-cancel aria-label="Close">${icon('x', { size: 15 })}</button></header>
    ${content}
    <footer class="dialog-actions">${actions.map((action, index) => `<button type="${action.submit ? 'submit' : 'button'}" class="button ${action.primary ? 'is-primary' : ''} ${action.danger ? 'is-danger' : ''}" data-dialog-action="${index}" ${action.autofocus ? 'autofocus' : ''}>${escapeHtml(action.label)}</button>`).join('')}</footer>
  </${tag}>`;
  document.body.append(dialog);
  let result = null;
  const finish = (value) => {
    result = value;
    dialog.close();
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (open === dialog) open = null;
    onClose?.(result);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish(null);
    if (event.target.closest('[data-dialog-cancel]')) finish(null);
    const action = event.target.closest('[data-dialog-action]');
    if (action && action.type !== 'submit') finish(actions[Number(action.dataset.dialogAction)].value);
  });
  if (form) {
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      if (!formElement.reportValidity()) return;
      const outcome = onSubmit(formElement);
      if (typeof outcome === 'string') {
        const error = dialog.querySelector('.dialog-error');
        error.textContent = outcome;
        error.hidden = false;
        return;
      }
      finish(outcome.value);
    });
  }
  open = dialog;
  dialog.showModal();
  const focusTarget = dialog.querySelector('[autofocus]') || dialog.querySelector('input, select, textarea, button.is-primary');
  focusTarget?.focus();
  if (focusTarget?.select) focusTarget.select();
}
