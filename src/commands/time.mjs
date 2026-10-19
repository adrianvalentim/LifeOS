import { z } from 'zod';
import {
  cancelSession,
  formatMinutes,
  logTime,
  startSession,
  stopSession,
  updateSession,
} from '../lifeos-data.mjs';
import { deleteTimeEntry, updateTimeEntry } from '../lifeos-manage.mjs';
import { defineCommand } from './registry.mjs';
import {
  activityType,
  date,
  derivedState,
  id,
  quote,
  range,
  resolveProjectId,
  time,
} from './shared.mjs';

const optionalProject = {
  projectId: id.nullable().optional().describe('Project ID, or null for general work.'),
  project: z.string().optional().describe('Project name when the ID is unknown.'),
};

defineCommand({
  name: 'time.entries',
  title: 'List time entries',
  kind: 'read',
  description: 'List logged time entries, newest first, within a date window or analytics range, optionally for one project or activity type.',
  input: z.object({
    from: date.optional(),
    to: date.optional(),
    range: range.optional().describe('Use the current week/month/quarter/year when from/to are absent.'),
    ...optionalProject,
    activityType: activityType.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx, { range: input.range });
    const projectId = input.projectId !== undefined || input.project !== undefined
      ? await resolveProjectId(input, ctx, { allowInbox: true })
      : undefined;
    const bounds = input.from || input.to
      ? { start: input.from || '0000-01-01', end: input.to || '9999-12-31' }
      : input.range ? state.analytics.bounds : { start: '0000-01-01', end: '9999-12-31' };
    const names = new Map(state.projects.map((project) => [project.id, project.name]));
    const entries = state.timeEntries
      .filter((entry) => entry.date >= bounds.start && entry.date <= bounds.end)
      .filter((entry) => projectId === undefined || (entry.projectId || null) === projectId)
      .filter((entry) => !input.activityType || entry.activityType === input.activityType)
      .sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`));
    const total = entries.reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
    return {
      bounds,
      totalMinutes: total,
      totalLabel: formatMinutes(total),
      count: entries.length,
      entries: entries.slice(0, input.limit || 200).map((entry) => ({
        id: entry.id, date: entry.date, time: entry.time, durationMinutes: entry.durationMinutes,
        activityType: entry.activityType, description: entry.description,
        projectId: entry.projectId, project: entry.projectId ? names.get(entry.projectId) : null,
        aggregation: entry.aggregation || null, source: entry.captureSource || null,
      })),
    };
  },
});

defineCommand({
  name: 'time.log',
  title: 'Log time',
  kind: 'write',
  description: 'Log completed work. Give durationMinutes (or a phrase like "2h 15m" in rawInput), a project when it belongs to one, and the activity type. Preserve the person\'s original words in rawInput. Omit the project only for genuinely general work.',
  keywords: ['track', 'record', 'hours'],
  input: z.object({
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    ...optionalProject,
    activityType: activityType.optional().describe('Inferred from the description when omitted.'),
    description: z.string().max(500).optional(),
    rawInput: z.string().max(2000).optional(),
    date: date.optional().describe('Defaults to today in the LifeOS timezone.'),
    time: time.nullable().optional().describe('Start time HH:MM; defaults to now.'),
  }),
  label: (result) => `Logged ${formatMinutes(result.durationMinutes)} · ${result.description}`,
  run: async (input, ctx) => {
    const projectId = input.projectId !== undefined || input.project !== undefined
      ? await resolveProjectId(input, ctx, { allowInbox: true })
      : undefined;
    if (!input.durationMinutes && !input.rawInput) throw new Error('Give durationMinutes or a rawInput phrase with a duration.');
    return logTime({
      ...(projectId !== undefined ? { projectId } : {}),
      durationMinutes: input.durationMinutes,
      activityType: input.activityType,
      description: input.description,
      rawInput: input.rawInput || input.description,
      date: input.date,
      time: input.time,
      source: ctx.source === 'app' ? 'lifeos_app' : ctx.source === 'mcp' ? 'mcp' : ctx.source === 'cli' ? 'cli' : `lifeos_${ctx.source}`,
    }, ctx.storePath);
  },
});

defineCommand({
  name: 'time.update',
  title: 'Edit time entry',
  kind: 'write',
  description: 'Correct a time entry: date, start time, duration, activity type, description, project (null for general) or explicit category IDs.',
  input: z.object({
    entryId: id,
    date: date.optional(),
    time: time.nullable().optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    activityType: activityType.optional(),
    description: z.string().max(500).optional(),
    projectId: id.nullable().optional(),
    categoryIds: z.array(z.string()).max(12).optional(),
  }),
  label: (result) => `Edited entry ${quote(result.description)}`,
  run: async (input, ctx) => updateTimeEntry(input, ctx.storePath),
});

defineCommand({
  name: 'time.delete',
  title: 'Delete time entry',
  kind: 'write',
  description: 'Delete one time entry. Undo restores it.',
  input: z.object({ entryId: id }),
  label: (result) => `Deleted entry ${quote(result.description)} (${formatMinutes(result.durationMinutes)})`,
  run: async (input, ctx) => deleteTimeEntry(input, ctx.storePath),
});

defineCommand({
  name: 'timer.status',
  title: 'Timer status',
  kind: 'read',
  description: 'The running focus timer, if any, with its project and elapsed minutes.',
  run: async (_input, ctx) => {
    const state = await derivedState(ctx);
    const session = state.activeSession;
    if (!session) return { running: false };
    return {
      running: true,
      ...session,
      project: state.projects.find((project) => project.id === session.projectId)?.name || null,
      elapsedMinutes: Math.max(0, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000)),
    };
  },
});

defineCommand({
  name: 'timer.start',
  title: 'Start focus timer',
  kind: 'write',
  description: 'Start the focus timer, optionally for a project. Only one timer runs at a time; stopping it logs the elapsed time as an entry.',
  keywords: ['focus', 'session', 'begin', 'pomodoro'],
  input: z.object({
    ...optionalProject,
    activityType: activityType.optional(),
    description: z.string().max(500).optional(),
    startedAt: z.string().optional().describe('ISO timestamp if the work started earlier.'),
  }),
  label: (result) => `Started a timer · ${result.description}`,
  run: async (input, ctx) => {
    const projectId = input.projectId !== undefined || input.project !== undefined
      ? await resolveProjectId(input, ctx, { allowInbox: true })
      : undefined;
    return startSession({
      ...(projectId !== undefined ? { projectId } : {}),
      activityType: input.activityType,
      description: input.description,
      rawInput: input.description || '',
      startedAt: input.startedAt,
    }, ctx.storePath);
  },
});

defineCommand({
  name: 'timer.stop',
  title: 'Stop timer and log',
  kind: 'write',
  description: 'Stop the running timer and log the elapsed minutes (minimum one) as a time entry dated at its start.',
  input: z.object({
    description: z.string().max(500).optional().describe('Replace the entry description.'),
    activityType: activityType.optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional().describe('Override the measured duration.'),
  }),
  label: (result) => `Logged ${formatMinutes(result.entry?.durationMinutes)} from the timer`,
  run: async (input, ctx) => stopSession(input, ctx.storePath),
});

defineCommand({
  name: 'timer.cancel',
  title: 'Discard timer',
  kind: 'write',
  description: 'Discard the running timer without logging any time.',
  label: 'Discarded the running timer',
  run: async (_input, ctx) => cancelSession({}, ctx.storePath),
});

defineCommand({
  name: 'timer.update',
  title: 'Edit running timer',
  kind: 'write',
  description: 'Change the running timer\'s project, activity type, description or start time.',
  input: z.object({
    ...optionalProject,
    activityType: activityType.optional(),
    description: z.string().max(500).optional(),
    startedAt: z.string().optional(),
  }),
  label: 'Edited the running timer',
  run: async (input, ctx) => {
    const patch = { ...input };
    if (input.project !== undefined) {
      patch.projectId = await resolveProjectId(input, ctx, { allowInbox: true });
      delete patch.project;
    }
    return updateSession(patch, ctx.storePath);
  },
});
