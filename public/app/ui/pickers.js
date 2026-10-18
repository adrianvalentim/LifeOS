// Property pickers shared by rows, detail sheets, quick capture and bulk edits.
// Each is a menu, so they all feel identical and work fully from the keyboard.
import { escapeHtml } from '../dom.js';
import { addDays, formatDate, normalize, PRIORITY, relativeDay, startOfWeek } from '../format.js';
import { parseDatePhrase } from '../nlp.js';
import { store } from '../store.js';
import { openMenu } from './menu.js';

export const PRIORITY_ORDER = ['high', 'medium', 'low', 'none'];

export function pickDate({ anchor, value = null, onPick, title = 'Date', allowClear = true, time = null, onTime = null }) {
  const today = store.state.meta.today;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const nextMonday = addDays(today, ((1 - dow + 7) % 7) || 7);
  const weekend = addDays(today, (6 - dow + 7) % 7);
  let month = (value || today).slice(0, 7);
  const choose = (date) => onPick(date);
  openMenu({
    anchor,
    width: 272,
    className: 'date-menu',
    items: () => [
      { type: 'chips', options: [
        { label: 'Today', active: value === today, run: () => choose(today) },
        { label: 'Tomorrow', active: value === addDays(today, 1), run: () => choose(addDays(today, 1)) },
        { label: dow === 6 || dow === 0 ? 'Next wknd' : 'Weekend', active: value === weekend, run: () => choose(dow === 6 || dow === 0 ? addDays(weekend, 7) : weekend) },
        { label: 'Next week', active: value === nextMonday, run: () => choose(nextMonday) },
      ] },
      {
        type: 'custom',
        render: () => `<label class="date-type"><input data-menu-focus type="text" placeholder="Type a date — fri, oct 21, in 3 days" autocomplete="off" spellcheck="false"><small data-date-preview></small></label>`,
        mount(holder, api) {
          const input = holder.querySelector('input');
          const preview = holder.querySelector('[data-date-preview]');
          input.addEventListener('input', () => {
            const parsed = parseDatePhrase(input.value, today);
            preview.textContent = parsed ? `${relativeDay(parsed, today)} · ${formatDate(parsed, { today, year: true })}` : input.value ? 'Not a date yet' : '';
          });
          input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            const parsed = parseDatePhrase(input.value, today);
            if (parsed) { api.close(); choose(parsed); }
          });
        },
      },
      {
        type: 'custom',
        render: () => renderCalendar(month, value, today),
        mount(holder, api) {
          holder.addEventListener('click', (event) => {
            const nav = event.target.closest('[data-cal-nav]');
            if (nav) {
              const [y, m] = month.split('-').map(Number);
              const next = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.calNav), 1));
              month = next.toISOString().slice(0, 7);
              api.refresh();
              return;
            }
            const day = event.target.closest('[data-cal-day]');
            if (day) { api.close(); choose(day.dataset.calDay); }
          });
        },
      },
      ...(onTime ? [{ type: 'custom', render: () => `<label class="date-time-row"><span>Time</span><input data-menu-focus type="time" value="${escapeHtml(time || '')}"><button type="button" class="link-button" data-clear-time>${time ? 'Clear' : ''}</button></label>`,
        mount(holder, api) {
          const input = holder.querySelector('input');
          input.addEventListener('change', () => onTime(input.value || null));
          holder.querySelector('[data-clear-time]').addEventListener('click', () => { api.close(); onTime(null); });
        } }] : []),
      ...(allowClear && value ? [{ type: 'separator' }, { label: 'Remove date', icon: 'x', run: () => choose(null) }] : []),
    ],
    title,
  });
}

function renderCalendar(month, value, today) {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = `${month}-01`;
  const gridStart = startOfWeek(first);
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`));
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const inMonth = Number(date.slice(5, 7)) === monthNumber && Number(date.slice(0, 4)) === year;
    if (index >= 35 && !inMonth) break;
    cells.push(`<button type="button" class="cal-day ${inMonth ? '' : 'is-out'} ${date === today ? 'is-today' : ''} ${date === value ? 'is-selected' : ''} ${date < today ? 'is-past' : ''}" data-cal-day="${date}" aria-label="${date}">${Number(date.slice(8))}</button>`);
  }
  return `<div class="calendar">
    <div class="cal-head"><button type="button" class="icon-button small" data-cal-nav="-1" aria-label="Previous month">‹</button><span>${escapeHtml(label)}</span><button type="button" class="icon-button small" data-cal-nav="1" aria-label="Next month">›</button></div>
    <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day) => `<span class="cal-dow">${day}</span>`).join('')}${cells.join('')}</div>
  </div>`;
}

export function pickPriority({ anchor, value = 'none', onPick }) {
  openMenu({
    anchor,
    width: 200,
    title: 'Priority',
    items: PRIORITY_ORDER.map((priority) => ({
      label: PRIORITY[priority],
      icon: 'flag',
      swatch: priority === 'none' ? null : `var(--p-${priority})`,
      checked: value === priority,
      shortcut: { high: '1', medium: '2', low: '3', none: '0' }[priority],
      run: () => onPick(priority),
    })),
  });
}

export function projectItems({ value, onPick, allowInbox = true, includeClosed = false, query = '' }) {
  const state = store.state;
  const needle = normalize(query);
  const active = ['doing', 'next_up', 'to_do'];
  const projects = state.projects
    .filter((project) => includeClosed || !['done', 'dropped'].includes(project.status) || project.id === value)
    .filter((project) => !needle || normalize(project.name).includes(needle))
    .sort((a, b) => (active.includes(a.status) ? 0 : 1) - (active.includes(b.status) ? 0 : 1) || a.name.localeCompare(b.name));
  const items = [];
  if (allowInbox && (!needle || 'inbox'.includes(needle))) items.push({ label: 'Inbox', icon: 'inbox', checked: value === null, run: () => onPick(null) });
  for (const project of projects) {
    items.push({
      label: project.name,
      swatch: state.domains[project.domain]?.color,
      hint: active.includes(project.status) ? '' : project.status.replace('_', ' '),
      checked: value === project.id,
      run: () => onPick(project.id),
    });
  }
  return items;
}

export function pickProject({ anchor, value = null, onPick, allowInbox = true, title = 'Move to', onCreate = null }) {
  openMenu({
    anchor,
    width: 260,
    title,
    search: {
      placeholder: 'Find a project…',
      create: onCreate ? (query) => ({ label: `Create project “${query}”`, icon: 'plus', run: () => onCreate(query) }) : null,
    },
    items: (query) => projectItems({ value, onPick, allowInbox, query }),
  });
}

export function knownTags() {
  const counts = new Map();
  for (const task of store.state.tasks.items) {
    if (task.trashedAt) continue;
    for (const tag of task.tags || []) {
      const key = normalize(tag);
      const entry = counts.get(key) || { label: tag, count: 0 };
      entry.count += task.status === 'open' ? 1 : 0;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function pickTags({ anchor, value = [], onChange, known = knownTags().map((tag) => tag.label), title = 'Tags', max = 12 }) {
  let current = [...value];
  const has = (tag) => current.some((item) => normalize(item) === normalize(tag));
  const toggle = (tag) => {
    current = has(tag) ? current.filter((item) => normalize(item) !== normalize(tag)) : [...current, tag].slice(0, max);
    onChange(current);
  };
  openMenu({
    anchor,
    width: 250,
    title,
    search: {
      placeholder: 'Find or create a tag…',
      create: (query) => ({ label: `Create “${query.replace(/^#/, '')}”`, icon: 'plus', keepOpen: true, run: () => toggle(query.replace(/^#/, '').trim()) }),
    },
    items: (query) => {
      const needle = normalize(query);
      const pool = [...new Map([...current, ...known].map((tag) => [normalize(tag), tag])).values()];
      return pool
        .filter((tag) => !needle || normalize(tag).includes(needle))
        .map((tag) => ({ label: tag, icon: 'hash', checked: has(tag), keepOpen: true, run: () => toggle(tag) }));
    },
  });
}

export function pickFromList({ anchor, title, options, value, onPick, width = 220, search = false }) {
  openMenu({
    anchor,
    width,
    title,
    search: search ? { placeholder: 'Search…' } : undefined,
    items: options.map((option) => ({
      label: option.label,
      description: option.description,
      icon: option.icon,
      swatch: option.swatch,
      checked: option.value === value,
      run: () => onPick(option.value),
    })),
  });
}
