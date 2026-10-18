// Formatting shared by every screen. Calendar math uses YYYY-MM-DD strings in
// the LifeOS timezone (the server's `meta.today`), never the browser's clock.

const DAY = 86_400_000;
const utc = (date) => new Date(`${date}T12:00:00Z`);

export function addDays(date, amount) {
  return new Date(utc(date).getTime() + amount * DAY).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((utc(to) - utc(from)) / DAY);
}

export function weekday(date, style = 'short') {
  return new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(utc(date));
}

export function startOfWeek(date) {
  const day = utc(date).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function formatDate(date, { year = 'auto', today = null, style = 'short' } = {}) {
  if (!date) return '';
  const value = utc(date);
  const showYear = year === true || (year === 'auto' && today && date.slice(0, 4) !== today.slice(0, 4));
  return new Intl.DateTimeFormat('en-US', {
    month: style === 'long' ? 'long' : 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(value);
}

export function formatLongDate(date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(utc(date));
}

// "Today", "Tomorrow", "Fri", "Oct 21" — the way people talk about due dates.
export function relativeDay(date, today) {
  if (!date) return '';
  const delta = daysBetween(today, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return weekday(date, 'long');
  if (delta < -1 && delta > -7) return `Last ${weekday(date, 'short')}`;
  return formatDate(date, { today });
}

export function dueTone(date, today, completed = false) {
  if (!date || completed) return '';
  const delta = daysBetween(today, date);
  if (delta < 0) return 'overdue';
  if (delta === 0) return 'today';
  if (delta === 1) return 'soon';
  return '';
}

export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${String(rest).padStart(2, '0')}m`;
}

export function formatHours(hours) {
  return formatMinutes(Math.round((Number(hours) || 0) * 60));
}

export function formatClock(iso) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [hour, minute] = hhmm.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
}

export function elapsed(fromIso, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return 'never';
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
}

export function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

export const ACTIVITY_LABELS = {
  deep_work: 'Deep work', shallow_work: 'Shallow work', admin: 'Admin',
  research: 'Research', creative: 'Creative', communication: 'Communication',
};
export const PROJECT_STATUS = {
  to_do: { label: 'To do', hint: 'Planned, not started' },
  next_up: { label: 'Next up', hint: 'Ready to begin' },
  doing: { label: 'Doing', hint: 'In progress now' },
  paused: { label: 'Paused', hint: 'On hold — out of summaries' },
  done: { label: 'Done', hint: 'Finished' },
  dropped: { label: 'Dropped', hint: 'Let go' },
};
export const READING_STATUS = {
  to_read: 'To read', next_up: 'Next up', reading: 'Reading', finished: 'Finished', dropped: 'Dropped',
};
export const IDEA_STATUS = { to_do: 'To do', next_up: 'Next up', doing: 'Doing', done: 'Done', dropped: 'Dropped' };
export const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low', none: 'None' };
export const ideaTypeLabel = (type) => ({ short: 'Short', long_video: 'Long video' }[type] || type);

export function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Subsequence fuzzy score with bonuses for word starts and contiguous runs.
export function fuzzyScore(query, text) {
  const q = normalize(query).replace(/ /g, '');
  const t = normalize(text);
  if (!q) return 1;
  if (!t) return 0;
  if (t.startsWith(normalize(query))) return 1000 - t.length;
  const index = t.indexOf(normalize(query));
  if (index >= 0) return 700 - index - t.length * 0.1;
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const char of q) {
    let found = false;
    while (ti < t.length) {
      const current = t[ti];
      const boundary = ti === 0 || t[ti - 1] === ' ';
      ti += 1;
      if (current === char) {
        run += 1;
        score += 10 + (boundary ? 25 : 0) + run * 4;
        found = true;
        break;
      }
      run = 0;
      if (current !== ' ') score -= 1;
    }
    if (!found) return 0;
  }
  return Math.max(1, score - t.length * 0.2);
}

export function initials(text) {
  return String(text || '?').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}
