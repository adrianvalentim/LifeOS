import { z } from 'zod';
import { addProjectCategory, deleteProject, normalizeText, setProjectStatus } from '../lifeos-data.mjs';
import { createProject, removeProjectCategory, updateProject } from '../lifeos-manage.mjs';
import { defineCommand } from './registry.mjs';
import {
  date,
  derivedState,
  id,
  projectRef,
  projectStatus,
  projectSummary,
  quote,
  resolveProjectId,
  taskSummary,
  titleOf,
} from './shared.mjs';

const STATUS_LABELS = { to_do: 'To do', next_up: 'Next up', doing: 'Doing', paused: 'Paused', done: 'Done', dropped: 'Dropped' };

const projectFields = {
  subtitle: z.string().max(160).optional(),
  domain: z.string().optional().describe('Domain ID (see planning.get).'),
  categoryIds: z.array(z.string()).max(12).optional().describe('Exact category IDs (replaces the set).'),
  categories: z.array(z.string().trim().min(1).max(60)).max(12).optional().describe('Category labels; unknown labels are created (replaces the set together with categoryIds).'),
  status: projectStatus.optional(),
  priority: z.number().int().min(1).max(5).optional().describe('1 (low) to 5 (critical).'),
  plannedHours: z.number().min(0).max(168).optional().describe('Planned hours per week.'),
  deadline: date.nullable().optional(),
  progress: z.number().min(0).max(1).nullable().optional().describe('Fraction complete, 0 to 1.'),
  note: z.string().max(4000).optional(),
  nextAction: z.string().max(300).optional().describe('Overrides the generated recommendation wording; empty clears it.'),
};

defineCommand({
  name: 'projects.list',
  title: 'List projects',
  kind: 'read',
  description: 'List projects with derived health, last touch, this week\'s hours vs plan, deadline distance, progress, streak and task counts. Defaults to every status.',
  input: z.object({
    status: z.array(projectStatus).optional(),
    activeOnly: z.boolean().optional().describe('Only to_do, next_up and doing.'),
  }),
  run: async (input, ctx) => {
    const state = await derivedState(ctx);
    const projects = state.projects.filter((project) => {
      if (input.activeOnly && !['to_do', 'next_up', 'doing'].includes(project.status)) return false;
      if (input.status?.length && !input.status.includes(project.status)) return false;
      return true;
    });
    return { projects: projects.map(projectSummary) };
  },
});

defineCommand({
  name: 'projects.get',
  title: 'Read project',
  kind: 'read',
  description: 'Read one project: every field, derived health and history, its open tasks and recent time entries.',
  input: z.object({ ...projectRef }),
  run: async (input, ctx) => {
    const projectId = await resolveProjectId(input, ctx);
    const state = await derivedState(ctx);
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const projectsById = new Map(state.projects.map((item) => [item.id, item]));
    return {
      project: { ...projectSummary(project), note: project.note, weekHistory: project.weekHistory, createdAt: project.createdAt, statusChangedAt: project.statusChangedAt || null },
      openTasks: state.tasks.items.filter((task) => task.projectId === projectId && !task.trashedAt && task.status === 'open').map((task) => taskSummary(task, projectsById)),
      recentEntries: state.timeEntries.filter((entry) => entry.projectId === projectId).slice(-15).reverse()
        .map(({ id: entryId, date: day, time, durationMinutes, activityType, description }) => ({ id: entryId, date: day, time, durationMinutes, activityType, description })),
    };
  },
});

defineCommand({
  name: 'projects.create',
  title: 'New project',
  kind: 'write',
  description: 'Create a project. Name is required; domain defaults to the first domain and status to to_do.',
  keywords: ['add project'],
  input: z.object({ name: z.string().trim().min(1).max(120), ...projectFields }),
  label: (result) => `Created project ${quote(titleOf(result))}`,
  run: async (input, ctx) => createProject(input, ctx.storePath),
});

defineCommand({
  name: 'projects.update',
  title: 'Edit project',
  kind: 'write',
  description: 'Edit any project fields: name, subtitle, domain, categories, status, priority (1-5), weekly planned hours, deadline, progress (0-1), note or next action. Omitted fields are kept.',
  input: z.object({ ...projectRef, name: z.string().trim().min(1).max(120).optional(), ...projectFields }),
  label: (result, input) => {
    const keys = Object.keys(input).filter((key) => !['projectId', 'project'].includes(key));
    if (keys.length === 1 && keys[0] === 'status') return `Moved ${quote(titleOf(result))} to ${STATUS_LABELS[input.status]}`;
    if (keys.length === 1 && keys[0] === 'name') return `Renamed project to ${quote(titleOf(result))}`;
    return `Edited ${quote(titleOf(result))}`;
  },
  coalesce: (input) => (Object.keys(input).every((key) => ['projectId', 'project', 'note'].includes(key)) ? `project-note:${input.projectId || input.project}` : null),
  run: async (input, ctx) => {
    const projectId = await resolveProjectId(input, ctx);
    const { project: _name, ...fields } = input;
    return updateProject({ ...fields, projectId }, ctx.storePath);
  },
});

defineCommand({
  name: 'projects.setStatus',
  title: 'Change project status',
  kind: 'write',
  description: 'Move a project to one of six workflow statuses: to_do, next_up, doing (active), paused (on hold, out of summaries), done or dropped.',
  input: z.object({ ...projectRef, status: projectStatus }),
  label: (result, input) => `Moved ${quote(titleOf(result))} to ${STATUS_LABELS[input.status]}`,
  run: async (input, ctx) => setProjectStatus({ projectId: await resolveProjectId(input, ctx), status: input.status }, ctx.storePath),
});

defineCommand({
  name: 'projects.addCategory',
  title: 'Add project category',
  kind: 'write',
  description: 'Add a reusable category label to a project, creating the category if it does not exist.',
  input: z.object({ ...projectRef, category: z.string().trim().min(1).max(60) }),
  label: (result) => `Labeled ${quote(result.project?.name)} ${result.category?.label}`,
  run: async (input, ctx) => addProjectCategory({ projectId: await resolveProjectId(input, ctx), category: input.category }, ctx.storePath),
});

defineCommand({
  name: 'projects.removeCategory',
  title: 'Remove project category',
  kind: 'write',
  description: 'Remove one category label from a project. The category itself and any preserved history remain.',
  input: z.object({ ...projectRef, categoryId: id }),
  label: (result) => `Removed a label from ${quote(titleOf(result))}`,
  run: async (input, ctx) => removeProjectCategory({ projectId: await resolveProjectId(input, ctx), categoryId: input.categoryId }, ctx.storePath),
});

defineCommand({
  name: 'projects.delete',
  title: 'Delete project',
  kind: 'write',
  destructive: true,
  description: 'Delete a project. Its tracked time is preserved as category history (a category named after the project is created when needed) and its tasks move to Inbox. Refused while it backs the active challenge. Undo restores it. Confirm with the person first.',
  input: z.object({ ...projectRef, preserveCategory: z.string().max(60).optional() }),
  label: (result) => `Deleted project ${quote(result.project?.name)}`,
  run: async (input, ctx) => deleteProject({
    projectId: await resolveProjectId(input, ctx),
    preserveHistory: true,
    preserveCategory: input.preserveCategory,
  }, ctx.storePath),
});

export function projectStatusLabel(status) {
  return STATUS_LABELS[status] || normalizeText(status);
}
