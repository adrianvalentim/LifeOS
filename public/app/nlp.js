// Natural-language capture: "Draft Act III fri 3pm !high #writing @Portia"
// becomes a title plus structured fields. Recognized pieces are shown as chips
// the person can dismiss (keeping the words literal). English and Portuguese
// date words are understood. Pure functions; no DOM.
import { addDays, normalize } from './format.js';

const WEEKDAYS = [
  ['sunday', 'sun', 'domingo'],
  ['monday', 'mon', 'segunda', 'segunda-feira'],
  ['tuesday', 'tue', 'tues', 'terça', 'terca', 'terça-feira', 'terca-feira'],
  ['wednesday', 'wed', 'quarta', 'quarta-feira'],
  ['thursday', 'thu', 'thur', 'thurs', 'quinta', 'quinta-feira'],
  ['friday', 'fri', 'sexta', 'sexta-feira'],
  ['saturday', 'sat', 'sábado', 'sabado'],
];
const AMBIGUOUS_DAY = new Set(['sun', 'sat', 'wed', 'quinta']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ACTIVITY_ALIASES = {
  deep: 'deep_work', deep_work: 'deep_work', focus: 'deep_work',
  shallow: 'shallow_work', shallow_work: 'shallow_work',
  admin: 'admin', research: 'research', reading: 'research', study: 'research',
  creative: 'creative', create: 'creative', edit: 'creative', writing: 'creative',
  comm: 'communication', communication: 'communication', meeting: 'communication', call: 'communication',
};

function weekdayIndex(word) {
  const lower = word.toLowerCase();
  return WEEKDAYS.findIndex((names) => names.includes(lower));
}

function dayOfWeek(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function monthIndex(word) {
  const key = word.toLowerCase().slice(0, 3);
  const en = MONTHS.indexOf(key);
  return en >= 0 ? en : PT_MONTHS.indexOf(key);
}

function resolveMonthDay(month, day, year, today, past) {
  if (day < 1 || day > 31) return null;
  let y = year || Number(today.slice(0, 4));
  const build = (yy) => `${yy}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  let date = build(y);
  if (Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  if (!year && !past && date < today) date = build(y + 1);
  if (!year && past && date > today) date = build(y - 1);
  return date;
}

function to24(hour, minute, meridiem) {
  let h = Number(hour);
  const m = Number(minute || 0);
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith('p');
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function matchProject(query, projects) {
  const needle = normalize(query.replace(/[-_]/g, ' '));
  if (!needle) return null;
  const compact = needle.replace(/ /g, '');
  const exact = projects.filter((project) => normalize(project.name) === needle || project.id === query.toLowerCase()
    || normalize(project.name).replace(/ /g, '') === compact);
  if (exact.length === 1) return exact[0];
  const starts = projects.filter((project) => normalize(project.name).startsWith(needle) || normalize(project.name).replace(/ /g, '').startsWith(compact));
  if (starts.length === 1) return starts[0];
  const contains = projects.filter((project) => normalize(project.name).includes(needle));
  return contains.length === 1 ? contains[0] : null;
}

/**
 * @param {string} text
 * @param {{ today: string, projects?: any[], mode?: 'task'|'log'|'timer'|'idea'|'project'|'milestone'|'book', ignore?: Set<string> }} options
 */
export function parseCapture(text, { today, projects = [], mode = 'task', ignore = new Set() } = {}) {
  const tokens = [];
  const spans = [];
  const result = { tags: [], priority: null, dueDate: null, startTime: null, durationMinutes: null, projectId: null, activityType: null };
  const past = mode === 'log';
  const source = String(text || '');

  const claim = (start, end, token) => {
    if (spans.some(([a, b]) => start < b && end > a)) return false;
    const key = `${token.type}:${source.slice(start, end).trim().toLowerCase()}`;
    if (ignore.has(key)) return false;
    spans.push([start, end]);
    tokens.push({ ...token, key, raw: source.slice(start, end).trim(), start, end });
    return true;
  };
  const scan = (pattern, handler) => {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) handler(match, match.index, match.index + match[0].length);
  };

  // #tag, #"multi word", #[multi word]
  scan(/(^|\s)#(?:"([^"]{1,40})"|\[([^\]]{1,40})\]|([\p{L}\p{N}][\p{L}\p{N}_\-/]{0,39}))/gu, (match, start, end) => {
    const tag = (match[2] || match[3] || match[4] || '').trim();
    if (!tag) return;
    const offset = match[1].length;
    if (claim(start + offset, end, { type: 'tag', value: tag, label: `#${tag}` })) {
      if (!result.tags.some((item) => normalize(item) === normalize(tag))) result.tags.push(tag);
    }
  });

  // @project or @"Long Now"
  scan(/(^|\s)@(?:"([^"]{1,80})"|\[([^\]]{1,80})\]|([\p{L}\p{N}][\p{L}\p{N}_\-.]{0,79}))/gu, (match, start, end) => {
    const query = (match[2] || match[3] || match[4] || '').trim();
    const project = query.toLowerCase() === 'inbox' ? { id: null, name: 'Inbox' } : matchProject(query, projects);
    if (!project) return;
    if (claim(start + match[1].length, end, { type: 'project', value: project.id, label: project.name })) result.projectId = project.id;
  });

  // Priority: !high !h !1 !!! p1
  scan(/(^|\s)(!{1,3}|!(?:high|hi|h|medium|med|m|low|lo|l|1|2|3|none)|p[1-3])(?=\s|$)/gi, (match, start, end) => {
    const value = match[2].toLowerCase();
    const map = { '!!!': 'high', '!!': 'medium', '!': 'low', '!high': 'high', '!hi': 'high', '!h': 'high', '!1': 'high', p1: 'high',
      '!medium': 'medium', '!med': 'medium', '!m': 'medium', '!2': 'medium', p2: 'medium',
      '!low': 'low', '!lo': 'low', '!l': 'low', '!3': 'low', p3: 'low', '!none': 'none' };
    const priority = map[value];
    if (!priority) return;
    if (claim(start + match[1].length, end, { type: 'priority', value: priority, label: `${priority[0].toUpperCase()}${priority.slice(1)} priority` })) result.priority = priority;
  });

  // ~activity (log/timer)
  if (mode === 'log' || mode === 'timer') {
    scan(/(^|\s)~([a-z_]+)(?=\s|$)/gi, (match, start, end) => {
      const type = ACTIVITY_ALIASES[match[2].toLowerCase()];
      if (type && claim(start + match[1].length, end, { type: 'activity', value: type, label: type.replace('_', ' ') })) result.activityType = type;
    });
  }

  // Durations. Logs and timers read any "2h 15m"; tasks need "for 30m" or "~1h".
  const durationPattern = mode === 'log' || mode === 'timer'
    ? /(^|\s)(?:for\s+)?(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|horas?)(?:\s*(\d{1,2})\s*(?:m|min|mins|minutes?|minutos?)?)?(?=\s|$|[,.;])|(^|\s)(?:for\s+)?(\d{1,3})\s*(m|min|mins|minutes?|minutos?)(?=\s|$|[,.;])/gi
    : /(^|\s)(?:for|~|est\.?)\s*(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?)(?:\s*(\d{1,2})\s*(?:m|min|mins|minutes?)?)?(?=\s|$)|(^|\s)(?:for|~|est\.?)\s*(\d{1,3})\s*(m|min|mins|minutes?)(?=\s|$)/gi;
  scan(durationPattern, (match, start, end) => {
    let minutes;
    let lead;
    if (match[2]) {
      minutes = Math.round(Number(match[2].replace(',', '.')) * 60 + Number(match[4] || 0));
      lead = match[1].length;
    } else {
      minutes = Number(match[6]);
      lead = match[5].length;
    }
    if (!minutes || minutes > 10080) return;
    if (claim(start + lead, end, { type: 'duration', value: minutes, label: formatDuration(minutes) })) result.durationMinutes = minutes;
  });

  // Times: 3pm, 3:30 pm, 15:00, at 9
  scan(/(^|\s)(?:at\s+|às\s+|as\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$|[,.;])|(^|\s)(?:at\s+|às\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s|$|[,.;])|(^|\s)(?:at|às)\s+(\d{1,2})h?(?=\s|$)/gi, (match, start, end) => {
    let time;
    let lead;
    if (match[2]) { time = to24(match[2], match[3], match[4]); lead = match[1].length; }
    else if (match[6]) { time = to24(match[6], match[7]); lead = match[5].length; }
    else { time = to24(match[9], 0); lead = match[8].length; }
    if (!time) return;
    if (claim(start + lead, end, { type: 'time', value: time, label: time })) result.startTime = time;
  });

  // Dates
  const setDate = (date, start, end, label) => {
    if (!date) return;
    if (claim(start, end, { type: 'date', value: date, label })) result.dueDate = date;
  };
  scan(/(^|\s)(?:on\s+|by\s+|due\s+|em\s+)?(\d{4}-\d{2}-\d{2})(?=\s|$|[,.;])/gi, (match, start, end) => {
    const date = match[2];
    if (!Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) setDate(date, start + match[1].length, end, date);
  });
  scan(/(^|\s)(?:by\s+|due\s+)?(today|tonight|tod|hoje|tomorrow|tmrw|tmr|amanhã|amanha|yesterday|ontem|day after tomorrow|depois de amanhã)(?=\s|$|[,.;])/gi, (match, start, end) => {
    const word = match[2].toLowerCase();
    const offset = ['today', 'tonight', 'tod', 'hoje'].includes(word) ? 0
      : ['yesterday', 'ontem'].includes(word) ? -1
        : word.startsWith('day after') || word.startsWith('depois') ? 2 : 1;
    setDate(addDays(today, offset), start + match[1].length, end, ['Today', 'Tomorrow', 'Yesterday', '', 'In 2 days'][[0, 1, -1, 99, 2].indexOf(offset)] || match[2]);
  });
  scan(/(^|\s)(next|this|last|on|by|due|próxima|proxima|próximo|proximo|na|no)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat|domingo|segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado)(?=\s|$|[,.;])/gi, (match, start, end) => {
    const modifier = (match[2] || '').toLowerCase();
    const word = match[3].toLowerCase();
    if (AMBIGUOUS_DAY.has(word) && !modifier) return;
    const index = weekdayIndex(word);
    if (index < 0) return;
    const current = dayOfWeek(today);
    let delta;
    if (modifier === 'last' || (past && !['next', 'próxima', 'proxima', 'próximo', 'proximo'].includes(modifier))) {
      delta = -((current - index + 7) % 7 || (modifier === 'last' ? 7 : 0));
    } else {
      delta = (index - current + 7) % 7;
      // "next friday" is the Friday of next calendar week (weeks start Monday).
      if (['next', 'próxima', 'proxima', 'próximo', 'proximo'].includes(modifier)) {
        const nextMonday = ((1 - current + 7) % 7) || 7;
        delta = nextMonday + ((index + 6) % 7);
      }
    }
    const date = addDays(today, delta);
    setDate(date, start + match[1].length, end, delta === 0 ? 'Today' : delta === 1 ? 'Tomorrow' : match[0].trim().replace(/^(on|by|due)\s+/i, ''));
  });
  scan(/(^|\s)(next week|próxima semana|proxima semana|this weekend|weekend|fim de semana|next month|próximo mês|proximo mes)(?=\s|$|[,.;])/gi, (match, start, end) => {
    const phrase = match[2].toLowerCase();
    const current = dayOfWeek(today);
    let date;
    if (phrase.includes('week') && !phrase.includes('end') || phrase.includes('semana')) date = addDays(today, ((1 - current + 7) % 7) || 7);
    else if (phrase.includes('weekend') || phrase.includes('fim de semana')) date = addDays(today, (6 - current + 7) % 7);
    else {
      const [year, month] = today.split('-').map(Number);
      date = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    }
    setDate(date, start + match[1].length, end, match[2]);
  });
  scan(/(^|\s)(?:in|em|daqui a)\s+(\d{1,3})\s*(days?|dias?|weeks?|semanas?|months?|meses|mês|mes)(?=\s|$|[,.;])/gi, (match, start, end) => {
    const amount = Number(match[2]);
    const unit = match[3].toLowerCase();
    let date;
    if (unit.startsWith('d')) date = addDays(today, amount);
    else if (unit.startsWith('w') || unit.startsWith('s')) date = addDays(today, amount * 7);
    else {
      const base = new Date(`${today}T12:00:00Z`);
      base.setUTCMonth(base.getUTCMonth() + amount);
      date = base.toISOString().slice(0, 10);
    }
    setDate(date, start + match[1].length, end, match[0].trim());
  });
  scan(/(^|\s)(?:on\s+|by\s+|due\s+)?(jan|feb|fev|mar|apr|abr|may|mai|jun|jul|aug|ago|sep|sept|set|oct|out|nov|dec|dez)[a-zç]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?=\s|$|[,.;])/gi, (match, start, end) => {
    setDate(resolveMonthDay(monthIndex(match[2]), Number(match[3]), match[4] ? Number(match[4]) : null, today, past), start + match[1].length, end, match[0].trim().replace(/^(on|by|due)\s+/i, ''));
  });
  scan(/(^|\s)(?:on\s+|by\s+|due\s+|em\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:de\s+)?(jan|feb|fev|mar|apr|abr|may|mai|jun|jul|aug|ago|sep|sept|set|oct|out|nov|dec|dez)[a-zç]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?=\s|$|[,.;])/gi, (match, start, end) => {
    setDate(resolveMonthDay(monthIndex(match[3]), Number(match[2]), match[4] ? Number(match[4]) : null, today, past), start + match[1].length, end, match[0].trim());
  });

  // A start time without a date means today (tasks need a date for a time).
  if (result.startTime && !result.dueDate && mode === 'task') result.dueDate = today;

  // Logs may name the project in plain words ("2h Vulcano color pass").
  let title = source;
  for (const [start, end] of [...spans].sort((a, b) => b[0] - a[0])) title = `${title.slice(0, start)} ${title.slice(end)}`;
  title = title.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().replace(/(^|\s)(on|by|at|due|for|em|às)$/i, '').trim();
  if ((mode === 'log' || mode === 'timer') && !result.projectId && projects.length) {
    const lowered = normalize(title);
    const inferred = [...projects].sort((a, b) => b.name.length - a.name.length)
      .find((project) => normalize(project.name).length > 2 && ` ${lowered} `.includes(` ${normalize(project.name)} `));
    if (inferred) {
      result.projectId = inferred.id;
      tokens.push({ type: 'project', value: inferred.id, label: inferred.name, key: `project:inferred:${inferred.id}`, raw: '', inferred: true });
    }
  }
  return { ...result, title, tokens: tokens.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9)) };
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

// For autocomplete: the #tag or @project being typed at the caret.
export function activeTrigger(text, caret) {
  const before = String(text || '').slice(0, caret);
  const match = before.match(/(^|\s)([#@])("?[^\s#@"]*)$/u);
  if (!match) return null;
  return { trigger: match[2], query: match[3].replace(/^"/, ''), start: caret - match[3].length - 1 };
}

export function tokenFor(trigger, value) {
  return /[\s"]/.test(value) ? `${trigger}"${value.replaceAll('"', '')}"` : `${trigger}${value}`;
}

// Quick date phrases for pickers ("tomorrow", "next fri", "oct 3").
export function parseDatePhrase(text, today) {
  const parsed = parseCapture(String(text || ''), { today, mode: 'task' });
  return parsed.dueDate;
}
