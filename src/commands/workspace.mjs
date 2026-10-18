import { z } from 'zod';
import {
  findView,
  mutateWorkspace,
  normalizeView,
  SECTIONS,
  VIEW_DUE,
  VIEW_GROUPS,
  VIEW_ICONS,
  VIEW_SORTS,
  VIEW_STATUS,
} from '../lifeos-workspace.mjs';
import { defineCommand } from './registry.mjs';
import { quote } from './shared.mjs';

const section = z.enum(SECTIONS);
const viewFilter = z.object({
  projects: z.array(z.string()).max(40).optional().describe('Project IDs; "inbox" matches tasks without a project.'),
  tags: z.array(z.string()).max(40).optional().describe('Match tasks with any of these tags.'),
  priorities: z.array(z.enum(['high', 'medium', 'low', 'none'])).optional(),
  due: z.enum(VIEW_DUE).optional(),
  status: z.enum(VIEW_STATUS).optional(),
  text: z.string().max(120).optional(),
});
const viewFields = {
  icon: z.enum(VIEW_ICONS).optional(),
  filter: viewFilter.optional(),
  groupBy: z.enum(VIEW_GROUPS).optional(),
  sortBy: z.enum(VIEW_SORTS).optional(),
};

defineCommand({
  name: 'workspace.update',
  title: 'Arrange workspace',
  kind: 'write',
  description: 'Change how the app is arranged: startScreen, theme ({mode: system|light|dark, accent: #RRGGBB|null}), density (comfortable|compact), or the order and visibility of the sections in the masthead (nav: [{id, hidden}]).',
  keywords: ['layout', 'theme', 'dark mode', 'night edition', 'masthead', 'sidebar', 'navigation', 'accent'],
  input: z.object({
    startScreen: section.optional(),
    theme: z.object({ mode: z.enum(['system', 'light', 'dark']).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() }).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    nav: z.array(z.object({ id: section, hidden: z.boolean().optional() })).optional(),
  }),
  label: (_result, input) => {
    if (input.theme?.mode && Object.keys(input).length === 1) return `Switched to ${input.theme.mode} theme`;
    if (input.nav) return 'Rearranged the sections';
    return 'Updated the workspace';
  },
  run: async (input, ctx) => {
    const { workspace } = await mutateWorkspace((draft) => {
      if (input.startScreen) draft.startScreen = input.startScreen;
      if (input.density) draft.density = input.density;
      if (input.theme) draft.theme = { ...draft.theme, ...input.theme };
      if (input.nav) draft.nav = input.nav.map((item) => ({ id: item.id, hidden: Boolean(item.hidden) }));
      if (draft.nav.every((item) => item.hidden)) throw new Error('Keep at least one section visible.');
    }, ctx.storePath);
    return { workspace };
  },
});

defineCommand({
  name: 'views.create',
  title: 'Save task view',
  kind: 'write',
  description: 'Save a custom task list (smart list) that appears in the Tasks list pane and command palette, filtered by projects, tags, priorities, due window, status and text, with its own grouping and sort.',
  keywords: ['smart list', 'filter', 'saved search', 'perspective'],
  input: z.object({ name: z.string().trim().min(1).max(60), ...viewFields }),
  label: (result) => `Saved the view ${quote(result.name)}`,
  run: async (input, ctx) => {
    let created;
    const { workspace } = await mutateWorkspace((draft) => {
      created = normalizeView({ ...input, id: undefined });
      if (draft.views.some((view) => view.name.toLowerCase() === created.name.toLowerCase())) throw new Error(`A view named ${created.name} already exists.`);
      draft.views.push(created);
      return created;
    }, ctx.storePath);
    return { view: created, workspace };
  },
});

defineCommand({
  name: 'views.update',
  title: 'Edit task view',
  kind: 'write',
  description: 'Rename a saved view or change its icon, filter, grouping or sort. The filter is merged with the existing one.',
  input: z.object({ viewId: z.string().min(1), name: z.string().trim().min(1).max(60).optional(), ...viewFields }),
  label: (result) => `Edited the view ${quote(result.name)}`,
  run: async (input, ctx) => {
    let updated;
    const { workspace } = await mutateWorkspace((draft) => {
      const view = findView(draft, input.viewId);
      if (!view) throw new Error(`View not found: ${input.viewId}`);
      updated = normalizeView({ ...view, ...input, id: view.id, filter: { ...view.filter, ...(input.filter || {}) } });
      draft.views = draft.views.map((item) => (item.id === view.id ? updated : item));
      return updated;
    }, ctx.storePath);
    return { view: updated, workspace };
  },
});

defineCommand({
  name: 'views.delete',
  title: 'Delete task view',
  kind: 'write',
  description: 'Delete a saved view (tasks are unaffected).',
  input: z.object({ viewId: z.string().min(1) }),
  label: (result) => `Deleted the view ${quote(result.name)}`,
  run: async (input, ctx) => {
    let removed;
    const { workspace } = await mutateWorkspace((draft) => {
      removed = findView(draft, input.viewId);
      if (!removed) throw new Error(`View not found: ${input.viewId}`);
      draft.views = draft.views.filter((view) => view.id !== removed.id);
      draft.pinned = draft.pinned.filter((pin) => !(pin.kind === 'view' && pin.id === removed.id));
      return removed;
    }, ctx.storePath);
    return { view: removed, workspace };
  },
});

defineCommand({
  name: 'pins.set',
  title: 'Pin to the masthead',
  kind: 'write',
  description: 'Pin (or unpin) a project, saved view or tag to the masthead (beside the sections) for one-click access.',
  keywords: ['favorite', 'shortcut'],
  input: z.object({ kind: z.enum(['project', 'view', 'tag']), id: z.string().min(1).max(200), pinned: z.boolean().default(true) }),
  label: (_result, input) => `${input.pinned ? 'Pinned' : 'Unpinned'} a ${input.kind}`,
  run: async (input, ctx) => {
    const { workspace } = await mutateWorkspace((draft) => {
      draft.pinned = draft.pinned.filter((pin) => !(pin.kind === input.kind && pin.id === input.id));
      if (input.pinned) draft.pinned.push({ kind: input.kind, id: input.id });
    }, ctx.storePath);
    return { workspace };
  },
});
