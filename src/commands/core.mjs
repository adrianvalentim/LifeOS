// Read-only commands that give agents the same picture the person sees.
import { z } from 'zod';
import { addDays, formatMinutes, normalizeText } from '../lifeos-data.mjs';
import { getStorageStatus, backUpStore } from '../lifeos-storage.mjs';
import { readStore } from '../lifeos-data.mjs';
import { defineCommand, listCommands } from './registry.mjs';
import { derivedState, projectSummary, range, taskSummary, workspaceFor } from './shared.mjs';

defineCommand({
  name: 'overview',
  title: 'Overview',
  kind: 'read',
  description: 'A compact digest of the person\'s day: running timer, today\'s logged time, the recommended next focus, project health, overdue and due-today tasks, current reading and upcoming creation work. Start here before acting.',
  keywords: ['summary', 'digest', 'today', 'status'],
  run: async (_input, ctx) => {
    const state = await derivedState(ctx);
    return buildOverview(state);
  },
});

export function buildOverview(state) {
  const today = state.meta.today;
  const projectsById = new Map(state.projects.map((project) => [project.id, project]));
  const open = state.tasks.items.filter((task) => !task.trashedAt && task.status === 'open');
  const overdue = open.filter((task) => task.schedule?.dueDate && task.schedule.dueDate < today);
  const dueToday = open.filter((task) => task.schedule?.dueDate === today);
  const next7End = addDays(today, 7);
  const next7 = open.filter((task) => task.schedule?.dueDate && task.schedule.dueDate > today && task.schedule.dueDate <= next7End);
  const active = state.projects.filter((project) => ['to_do', 'next_up', 'doing'].includes(project.status));
  const session = state.activeSession;
  return {
    today,
    now: state.meta.now,
    timezone: state.meta.timezone,
    week: state.meta.weekNumber,
    timer: session ? {
      project: session.projectId ? projectsById.get(session.projectId)?.name || null : null,
      projectId: session.projectId,
      description: session.description,
      activityType: session.activityType,
      startedAt: session.startedAt,
      elapsedMinutes: Math.max(0, Math.round((new Date(state.meta.now) - new Date(session.startedAt)) / 60000)),
    } : null,
    todayLogged: { minutes: state.summary.todayMinutes, label: state.summary.todayLabel, entries: state.todayEntries.length, planHours: state.settings.defaultDailyPlanHours },
    thisWeek: { hours: state.summary.currentWeekHours, label: state.summary.currentWeekLabel },
    recommendation: state.recommendation ? {
      projectId: state.recommendation.projectId,
      project: state.recommendation.projectName,
      action: state.recommendation.action,
      durationMinutes: state.recommendation.durationMinutes,
      why: state.recommendation.reasonLong,
    } : null,
    projects: {
      active: state.summary.activeCount,
      critical: state.summary.criticalCount,
      list: active.map(projectSummary),
    },
    tasks: {
      open: state.tasks.summary.open,
      inbox: state.tasks.summary.inbox.open,
      overdue: overdue.slice(0, 25).map((task) => taskSummary(task, projectsById)),
      dueToday: dueToday.slice(0, 25).map((task) => taskSummary(task, projectsById)),
      next7Days: next7.length,
    },
    reading: {
      reading: state.reading.books.filter((book) => book.status === 'reading').map((book) => ({ id: book.id, title: book.title, authors: book.authors })),
      nextUp: state.reading.summary.byStatus.next_up,
    },
    creation: {
      byStatus: Object.fromEntries(['to_do', 'next_up', 'doing', 'done', 'dropped'].map((status) => [status, state.creation.ideas.filter((idea) => idea.status === status).length])),
      upcoming: state.creation.ideas.filter((idea) => idea.date && idea.date >= today && idea.status !== 'dropped' && idea.status !== 'done')
        .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8).map((idea) => ({ id: idea.id, title: idea.title, type: idea.type, date: idea.date, status: idea.status })),
    },
    challenge: state.challenge ? { text: state.challenge.text, progress: state.challenge.progress, target: state.challenge.target, daysLeft: state.challenge.daysLeft } : null,
  };
}

const SECTIONS = ['meta', 'summary', 'projects', 'tasks', 'reading', 'creation', 'analytics', 'todayEntries', 'timeEntries', 'recommendations', 'domains', 'categories', 'settings', 'milestones', 'challenge', 'activeSession', 'rhythmHeatmap', 'weekByDay'];

defineCommand({
  name: 'state.get',
  title: 'Read full state',
  kind: 'read',
  description: 'Return the complete derived LifeOS view model (the same data the app renders), optionally limited to some sections. Prefer overview or a focused list command for routine questions; this can be large.',
  input: z.object({
    range: range.optional().describe('Analytics range; defaults to week.'),
    sections: z.array(z.enum(SECTIONS)).optional().describe('Return only these top-level sections.'),
  }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx, { range: input.range });
    if (!input.sections?.length) return { view: state };
    return { view: Object.fromEntries(input.sections.map((key) => [key, state[key]])) };
  },
});

defineCommand({
  name: 'search',
  title: 'Search everything',
  kind: 'read',
  description: 'Search projects, tasks, books, ideas, milestones and time entries by text. Returns matches with kind and exact ID for follow-up commands.',
  keywords: ['find', 'lookup'],
  input: z.object({
    query: z.string().trim().min(1).max(200),
    kinds: z.array(z.enum(['project', 'task', 'book', 'idea', 'milestone', 'entry'])).optional(),
    includeClosed: z.boolean().optional().describe('Include completed/trashed tasks, finished/dropped books and done/dropped ideas.'),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx);
    return { matches: searchState(state, input) };
  },
});

export function searchState(state, { query, kinds, includeClosed = false, limit = 20 }) {
  const needle = normalizeText(query);
  const words = needle.split(' ').filter(Boolean);
  const allow = (kind) => !kinds?.length || kinds.includes(kind);
  const score = (...fields) => {
    const hay = normalizeText(fields.filter(Boolean).join(' '));
    const title = normalizeText(fields[0]);
    if (!words.every((word) => hay.includes(word))) return 0;
    if (title === needle) return 100;
    if (title.startsWith(needle)) return 80;
    if (title.includes(needle)) return 60;
    return 30;
  };
  const projectsById = new Map(state.projects.map((project) => [project.id, project]));
  const matches = [];
  if (allow('project')) for (const project of state.projects) {
    const value = score(project.name, project.subtitle, project.note, (project.categoryLabels || []).join(' '));
    if (value) matches.push({ kind: 'project', id: project.id, title: project.name, subtitle: project.subtitle || project.status, score: value + 5 });
  }
  if (allow('task')) for (const task of state.tasks.items) {
    if (!includeClosed && (task.trashedAt || task.status === 'completed')) continue;
    const value = score(task.title, task.tags.join(' '), task.notes);
    if (value) matches.push({ kind: 'task', id: task.id, title: task.title, subtitle: task.projectId ? projectsById.get(task.projectId)?.name : 'Inbox', score: value + (task.status === 'open' ? 3 : 0) });
  }
  if (allow('book')) for (const book of state.reading.books) {
    if (!includeClosed && ['dropped'].includes(book.status)) continue;
    const value = score(book.title, book.authors.join(' '), book.tags.join(' '), book.subtitle);
    if (value) matches.push({ kind: 'book', id: book.id, title: book.title, subtitle: book.authors.join(', '), score: value });
  }
  if (allow('idea')) for (const idea of state.creation.ideas) {
    if (!includeClosed && ['dropped'].includes(idea.status)) continue;
    const value = score(idea.title, idea.type, idea.markdown.slice(0, 4000));
    if (value) matches.push({ kind: 'idea', id: idea.id, title: idea.title, subtitle: idea.type, score: value });
  }
  if (allow('milestone')) for (const milestone of state.milestones || []) {
    const value = score(milestone.text);
    if (value) matches.push({ kind: 'milestone', id: milestone.id, title: milestone.text, subtitle: milestone.date, score: value - 5 });
  }
  if (allow('entry') && kinds?.includes('entry')) for (const entry of state.timeEntries || []) {
    const value = score(entry.description, entry.rawInput);
    if (value) matches.push({ kind: 'entry', id: entry.id, title: entry.description, subtitle: `${entry.date} · ${formatMinutes(entry.durationMinutes)}`, score: value - 10 });
  }
  return matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

defineCommand({
  name: 'recommendations.list',
  title: 'Recommended focus',
  kind: 'read',
  description: 'The ranked list of what to work on next, with the reason and suggested duration for each active project.',
  keywords: ['what now', 'next', 'focus', 'recommend'],
  run: async (_input, ctx) => {
    const state = await derivedState(ctx);
    return { recommendations: state.recommendations.map(({ alternatives, ...item }) => item) };
  },
});

defineCommand({
  name: 'stats.get',
  title: 'Time statistics',
  kind: 'read',
  description: 'Totals for a week, month, quarter or year: tracked vs planned hours, deep-work ratio, allocation by domain and category, composition and production/consumption. Optionally for one project.',
  keywords: ['analytics', 'insights', 'hours', 'time'],
  input: z.object({
    range: range.optional(),
    projectId: z.string().optional(),
    project: z.string().optional(),
  }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx, { range: input.range });
    const result = { range: state.summary.range, label: state.summary.rangeLabel, bounds: state.analytics.bounds, summary: state.summary, analytics: state.analytics };
    if (input.projectId || input.project) {
      const needle = normalizeText(input.project || '');
      const project = state.projects.find((item) => item.id === input.projectId || (needle && normalizeText(item.name) === needle))
        || state.projects.find((item) => needle && normalizeText(item.name).includes(needle));
      if (!project) throw new Error(`Project not found: ${input.projectId || input.project}`);
      result.project = { ...projectSummary(project), weekHistory: project.weekHistory };
    }
    return result;
  },
});

defineCommand({
  name: 'commands.list',
  title: 'List commands',
  kind: 'read',
  description: 'List every LifeOS command with its input JSON schema. The same commands are available through MCP, the CLI (lifeos run <name>), the SDK and HTTP (POST /api/run/<name>).',
  input: z.object({ group: z.string().optional() }),
  run: async (input) => ({ commands: listCommands().filter((command) => !input.group || command.group === input.group) }),
});

defineCommand({
  name: 'storage.status',
  title: 'Storage status',
  kind: 'read',
  description: 'Where the personal store lives, whether a Google Drive snapshot folder is configured, and the latest snapshot or backup error.',
  run: async () => getStorageStatus(),
});

defineCommand({
  name: 'storage.backupNow',
  title: 'Back up now',
  kind: 'read',
  description: 'Write a snapshot to the configured cloud backup folder immediately. Does not change records.',
  keywords: ['backup', 'snapshot', 'google drive'],
  run: async (_input, ctx) => {
    const result = await backUpStore(await readStore(ctx.storePath));
    if (!result.configured) throw new Error('No cloud backup folder is configured. Configure one with: lifeos storage configure-backup --path "<folder>"');
    if (!result.ok) throw new Error(`Cloud backup failed: ${result.error}`);
    return result;
  },
});

defineCommand({
  name: 'workspace.get',
  title: 'Workspace layout',
  kind: 'read',
  description: 'The app\'s arrangement: section order and visibility, start screen, theme, density, saved task views and pinned items.',
  run: async (_input, ctx) => workspaceFor(ctx),
});
