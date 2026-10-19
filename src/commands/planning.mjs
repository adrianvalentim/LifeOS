import { z } from 'zod';
import {
  clearChallenge,
  createCategory,
  createDomain,
  createMilestone,
  deleteCategory,
  deleteDomain,
  deleteMilestone,
  setChallenge,
  updateCategory,
  updateDomain,
  updateMilestone,
  updateSettings,
} from '../lifeos-manage.mjs';
import { defineCommand } from './registry.mjs';
import { activityType, date, derivedState, id, quote, titleOf } from './shared.mjs';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB color.');

defineCommand({
  name: 'planning.get',
  title: 'Planning model',
  kind: 'read',
  description: 'Domains (with colors and weekly plan hours), reusable categories, settings (daily plan, deep-work target, health thresholds), the current challenge and milestones.',
  run: async (_input, ctx) => {
    const state = await derivedState(ctx);
    return {
      meta: { appName: state.meta.appName, tagline: state.meta.tagline, timezone: state.meta.timezone },
      domains: Object.entries(state.domains).map(([domainId, domain]) => ({ id: domainId, ...domain, weeklyHours: state.settings.weeklyPlanByDomain[domainId] ?? 0 })),
      categories: Object.entries(state.categories).map(([categoryId, category]) => ({ id: categoryId, ...category })),
      settings: state.settings,
      challenge: state.challenge,
      milestones: state.milestones,
    };
  },
});

defineCommand({
  name: 'settings.update',
  title: 'Update settings',
  kind: 'write',
  description: 'Change planning settings: deepTarget (0-1), defaultDailyPlanHours, weeklyPlanByDomain ({domainId: hours}), health thresholds (attentionInactiveDays, criticalInactiveDays), and the app name, tagline or IANA timezone.',
  keywords: ['preferences', 'plan', 'timezone'],
  input: z.object({
    deepTarget: z.number().min(0).max(1).optional(),
    defaultDailyPlanHours: z.number().min(0.5).max(24).optional(),
    weeklyPlanByDomain: z.record(z.string(), z.number().min(0).max(168)).optional(),
    health: z.object({
      attentionInactiveDays: z.number().min(0.5).max(60).optional(),
      criticalInactiveDays: z.number().min(1).max(120).optional(),
    }).optional(),
    appName: z.string().trim().min(1).max(40).optional(),
    tagline: z.string().max(80).optional(),
    timezone: z.string().min(1).max(80).optional(),
  }),
  label: 'Updated settings',
  run: async (input, ctx) => updateSettings(input, ctx.storePath),
});

defineCommand({
  name: 'domains.create',
  title: 'New domain',
  kind: 'write',
  description: 'Create a life domain (e.g. Filmmaking) with a short label, a color and weekly planned hours.',
  input: z.object({ label: z.string().trim().min(1).max(40), short: z.string().max(8).optional(), color: color.optional(), weeklyHours: z.number().min(0).max(168).optional() }),
  label: (result) => `Created domain ${quote(result.label)}`,
  run: async (input, ctx) => createDomain(input, ctx.storePath),
});

defineCommand({
  name: 'domains.update',
  title: 'Edit domain',
  kind: 'write',
  description: 'Rename a domain or change its short label, color or weekly planned hours.',
  input: z.object({ domainId: id, label: z.string().trim().min(1).max(40).optional(), short: z.string().max(8).optional(), color: color.optional(), weeklyHours: z.number().min(0).max(168).optional() }),
  label: (result) => `Edited domain ${quote(result.label)}`,
  run: async (input, ctx) => updateDomain(input, ctx.storePath),
});

defineCommand({
  name: 'domains.delete',
  title: 'Delete domain',
  kind: 'write',
  destructive: true,
  description: 'Delete an unused domain. Refused while any project or preserved entry uses it.',
  input: z.object({ domainId: id }),
  label: (result) => `Deleted domain ${quote(result.label)}`,
  run: async (input, ctx) => deleteDomain(input, ctx.storePath),
});

defineCommand({
  name: 'categories.create',
  title: 'New category',
  kind: 'write',
  description: 'Create a reusable category label that projects can share.',
  input: z.object({ label: z.string().trim().min(1).max(60) }),
  label: (result) => `Created category ${quote(result.label)}`,
  run: async (input, ctx) => createCategory(input, ctx.storePath),
});

defineCommand({
  name: 'categories.update',
  title: 'Rename category',
  kind: 'write',
  description: 'Rename a category everywhere it is used.',
  input: z.object({ categoryId: id, label: z.string().trim().min(1).max(60) }),
  label: (result) => `Renamed category to ${quote(result.label)}`,
  run: async (input, ctx) => updateCategory(input, ctx.storePath),
});

defineCommand({
  name: 'categories.delete',
  title: 'Delete category',
  kind: 'write',
  destructive: true,
  description: 'Delete a category and remove it from projects. Refused when it preserves time history.',
  input: z.object({ categoryId: id }),
  label: (result) => `Deleted category ${quote(result.category?.label)}`,
  run: async (input, ctx) => deleteCategory(input, ctx.storePath),
});

defineCommand({
  name: 'milestones.create',
  title: 'Add milestone',
  kind: 'write',
  description: 'Record a milestone (something achieved) in the Almanac, dated today unless a date is given.',
  keywords: ['achievement', 'win', 'almanac'],
  input: z.object({ text: z.string().trim().min(1).max(300), date: date.optional(), projectId: id.nullable().optional() }),
  label: (result) => `Recorded milestone ${quote(titleOf(result))}`,
  run: async (input, ctx) => createMilestone(input, ctx.storePath),
});

defineCommand({
  name: 'milestones.update',
  title: 'Edit milestone',
  kind: 'write',
  description: 'Edit a milestone\'s text, date or project.',
  input: z.object({ milestoneId: id, text: z.string().trim().min(1).max(300).optional(), date: date.optional(), projectId: id.nullable().optional() }),
  label: (result) => `Edited milestone ${quote(titleOf(result))}`,
  run: async (input, ctx) => updateMilestone(input, ctx.storePath),
});

defineCommand({
  name: 'milestones.delete',
  title: 'Delete milestone',
  kind: 'write',
  description: 'Delete a milestone. Undo restores it.',
  input: z.object({ milestoneId: id }),
  label: (result) => `Deleted milestone ${quote(titleOf(result))}`,
  run: async (input, ctx) => deleteMilestone(input, ctx.storePath),
});

defineCommand({
  name: 'challenge.set',
  title: 'Set challenge',
  kind: 'write',
  description: 'Create or edit the current challenge: a target number of qualifying sessions (minimum length, optional activity types) on one project between two dates.',
  keywords: ['goal', 'streak'],
  input: z.object({
    text: z.string().trim().min(1).max(300).optional(),
    projectId: id.optional(),
    startDate: date.optional(),
    endDate: date.optional(),
    target: z.number().int().min(1).max(100).optional(),
    minDurationMinutes: z.number().int().min(1).max(1440).optional(),
    activityTypes: z.array(activityType).optional(),
  }),
  label: (result) => `Set the challenge ${quote(titleOf(result))}`,
  run: async (input, ctx) => setChallenge(input, ctx.storePath),
});

defineCommand({
  name: 'challenge.clear',
  title: 'Clear challenge',
  kind: 'write',
  description: 'Remove the current challenge.',
  label: 'Cleared the challenge',
  run: async (_input, ctx) => clearChallenge({}, ctx.storePath),
});
