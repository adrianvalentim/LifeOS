// Pure task projections: which tasks a list shows, how they group and sort,
// and the visible row order used for keyboard navigation. Everything here is
// derived from task records plus today's date; nothing is persisted.
import { addDays, daysBetween, formatDate, normalize, relativeDay, weekday } from './format.js';

export const GROUPINGS = { none: 'None', priority: 'Priority', due: 'Due date', project: 'List', tag: 'Tag' };
export const SORTS = { manual: 'Custom order', priority: 'Priority', due: 'Due date', title: 'Title', created: 'Date created' };
const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 };

export const isOpen = (task) => !task.trashedAt && task.status === 'open';
export const isCompleted = (task) => !task.trashedAt && task.status === 'completed';
export const isTrashed = (task) => Boolean(task.trashedAt);
// A task just crossed off stays in its list for a moment (struck through in
// rubric) before it moves to Completed, so the act is seen and Undo is obvious.
export const lingering = new Map();
export const isListed = (task) => isOpen(task) || (!task.trashedAt && lingering.has(task.id));

export function subsetRoots(items, predicate) {
  const matching = items.filter(predicate);
  const ids = new Set(matching.map((task) => task.id));
  return matching.filter((task) => !task.parentTaskId || !ids.has(task.parentTaskId));
}

export function childrenIndex(items) {
  const index = new Map();
  for (const task of items) {
    const key = task.parentTaskId || null;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(task);
  }
  return index;
}

function dueWithin(task, today, horizon) {
  const due = task.schedule?.dueDate;
  return Boolean(due) && daysBetween(today, due) <= horizon;
}

export function matchesViewFilter(task, filter, today) {
  if (task.trashedAt) return false;
  if (filter.status === 'open' && task.status !== 'open') return false;
  if (filter.status === 'completed' && task.status !== 'completed') return false;
  if (filter.projects?.length && !filter.projects.some((id) => (id === 'inbox' ? task.projectId == null : task.projectId === id))) return false;
  if (filter.tags?.length && !filter.tags.some((tag) => task.tags.some((item) => normalize(item) === normalize(tag)))) return false;
  if (filter.priorities?.length && !filter.priorities.includes(task.priority)) return false;
  const due = task.schedule?.dueDate || null;
  if (filter.due === 'overdue' && !(due && due < today)) return false;
  if (filter.due === 'today' && !(due && due <= today)) return false;
  if (filter.due === 'next7' && !(due && due <= addDays(today, 7))) return false;
  if (filter.due === 'next30' && !(due && due <= addDays(today, 30))) return false;
  if (filter.due === 'dated' && !due) return false;
  if (filter.due === 'nodate' && due) return false;
  if (filter.text && !normalize(`${task.title} ${task.notes} ${task.tags.join(' ')}`).includes(normalize(filter.text))) return false;
  return true;
}

/**
 * Resolve a list id ("all", "inbox", "today", "next7", "completed", "trash",
 * "project:<id>", "tag:<tag>", "view:<id>") to its records and presentation.
 */
export function taskScope(list, state) {
  const tasks = state.tasks;
  const today = state.meta.today;
  const items = tasks.items;
  if (list === 'today' || list === 'next7') {
    const horizon = list === 'today' ? 0 : 7;
    const scheduled = items.filter((task) => !task.trashedAt && dueWithin(task, today, horizon));
    return {
      id: list,
      label: list === 'today' ? 'Today' : 'Upcoming',
      copy: list === 'today' ? 'Overdue and due today.' : 'Everything due in the next seven days.',
      items: scheduled.filter(isListed),
      completed: scheduled.filter((task) => isCompleted(task) && !lingering.has(task.id)),
      flat: true,
      lifecycle: 'active',
      defaultGroup: list === 'today' ? 'due' : 'day',
      icon: list === 'today' ? 'calendar' : 'upcoming',
      defaults: list === 'today' ? { dueDate: today } : {},
      empty: list === 'today' ? 'Nothing due today. Enjoy the open space — or pull something forward.' : 'Your week has no dated commitments yet.',
    };
  }
  if (list === 'completed') {
    return {
      id: list, label: 'Completed', copy: 'Finished work, newest first.',
      items: subsetRoots(items, isCompleted), flat: false, lifecycle: 'completed', defaultGroup: 'completedDay', icon: 'check',
      empty: 'Completed tasks collect here.',
    };
  }
  if (list === 'trash') {
    return {
      id: list, label: 'Trash', copy: tasks.authority?.mode === 'online' ? 'Recoverable for 30 days; cloud records are retained.' : 'Recoverable for 30 days, then removed automatically.',
      items: subsetRoots(items, isTrashed), flat: false, lifecycle: 'trash', icon: 'trash',
      empty: 'Trash is empty.',
    };
  }
  if (list === 'inbox') {
    return {
      id: list, label: 'Inbox', copy: 'Captured commitments without a project.',
      items: subsetRoots(items, (task) => isListed(task) && task.projectId == null), flat: false, lifecycle: 'active', icon: 'inbox',
      defaults: { projectId: null }, empty: 'Inbox zero. Everything has a home.',
    };
  }
  if (list.startsWith('project:')) {
    const project = state.projects.find((item) => item.id === list.slice(8));
    return {
      id: list, label: project?.name || 'Project', copy: project?.subtitle || 'Project tasks', project,
      items: subsetRoots(items, (task) => isListed(task) && task.projectId === project?.id), flat: false, lifecycle: 'active', icon: 'projects',
      defaults: { projectId: project?.id ?? null }, empty: 'No open tasks in this project.',
    };
  }
  if (list.startsWith('tag:')) {
    const tag = list.slice(4);
    return {
      id: list, label: `#${tag}`, copy: 'Every open task with this tag.',
      items: items.filter((task) => isListed(task) && task.tags.some((item) => normalize(item) === normalize(tag))), flat: true, lifecycle: 'active', icon: 'hash',
      defaults: { tags: [tag] }, empty: 'No open tasks carry this tag.',
    };
  }
  if (list.startsWith('view:')) {
    const view = state.workspace.views.find((item) => item.id === list.slice(5));
    if (view) {
      const matching = items.filter((task) => matchesViewFilter(task, view.filter, today) || (lingering.has(task.id) && matchesViewFilter({ ...task, status: 'open' }, view.filter, today)));
      return {
        id: list, label: view.name, copy: describeFilter(view.filter, state), view,
        items: matching.filter((task) => view.filter.status !== 'open' || isListed(task)),
        flat: true, lifecycle: view.filter.status === 'completed' ? 'completed' : 'active', icon: view.icon,
        defaultGroup: view.groupBy, defaultSort: view.sortBy,
        defaults: {
          ...(view.filter.projects.length === 1 ? { projectId: view.filter.projects[0] === 'inbox' ? null : view.filter.projects[0] } : {}),
          ...(view.filter.tags.length ? { tags: [view.filter.tags[0]] } : {}),
        },
        empty: 'Nothing matches this view right now.',
      };
    }
  }
  return {
    id: 'all', label: 'All tasks', copy: 'Every open commitment, by list.',
    items: subsetRoots(items, isListed), flat: false, lifecycle: 'active', icon: 'tasks', empty: 'No open tasks. Press N to capture one.',
  };
}

export function describeFilter(filter, state) {
  const parts = [];
  if (filter.projects?.length) parts.push(filter.projects.map((id) => (id === 'inbox' ? 'Inbox' : state.projects.find((project) => project.id === id)?.name || id)).join(', '));
  if (filter.tags?.length) parts.push(filter.tags.map((tag) => `#${tag}`).join(' '));
  if (filter.priorities?.length) parts.push(`${filter.priorities.join('/')} priority`);
  const due = { overdue: 'overdue', today: 'due by today', next7: 'due within 7 days', next30: 'due within 30 days', dated: 'with a date', nodate: 'without a date' }[filter.due];
  if (due) parts.push(due);
  if (filter.text) parts.push(`matching “${filter.text}”`);
  if (filter.status === 'completed') parts.push('completed');
  if (filter.status === 'all') parts.push('open and completed');
  return parts.length ? parts.join(' · ') : 'All open tasks';
}

export function sortTasks(tasks, sortBy) {
  const list = [...tasks];
  const done = (task) => (task.status === 'completed' && !lingering.has(task.id) ? 1 : 0);
  const completion = (a, b) => done(a) - done(b);
  const due = (a, b) => {
    const x = a.schedule?.dueDate;
    const y = b.schedule?.dueDate;
    if (x === y) return (a.schedule?.startTime || '99').localeCompare(b.schedule?.startTime || '99');
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : 1;
  };
  if (sortBy === 'priority') return list.sort((a, b) => completion(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || due(a, b) || a.title.localeCompare(b.title));
  if (sortBy === 'due') return list.sort((a, b) => completion(a, b) || due(a, b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title));
  if (sortBy === 'title') return list.sort((a, b) => completion(a, b) || a.title.localeCompare(b.title));
  if (sortBy === 'created') return list.sort((a, b) => completion(a, b) || String(b.createdAt).localeCompare(String(a.createdAt)));
  if (sortBy === 'completed') return list.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  return list;
}

function bucketFor(task, groupBy, state) {
  const today = state.meta.today;
  if (groupBy === 'priority') {
    const labels = { high: 'High priority', medium: 'Medium priority', low: 'Low priority', none: 'No priority' };
    return [{ id: `priority:${task.priority}`, label: labels[task.priority], tone: `prio-${task.priority}`, drop: { kind: 'priority', value: task.priority } }];
  }
  if (groupBy === 'project') {
    const project = task.projectId ? state.projects.find((item) => item.id === task.projectId) : null;
    return [{ id: `project:${task.projectId || 'inbox'}`, label: project?.name || 'Inbox', swatch: project ? state.domains[project.domain]?.color : null, drop: task.parentTaskId ? null : { kind: 'project', value: task.projectId || null } }];
  }
  if (groupBy === 'tag') {
    if (!task.tags.length) return [{ id: 'tag:', label: 'No tag' }];
    return task.tags.map((tag) => ({ id: `tag:${normalize(tag)}`, label: `#${tag}`, drop: { kind: 'tag', value: tag } }));
  }
  if (groupBy === 'completedDay') {
    const day = task.completedAt ? new Date(task.completedAt).toISOString().slice(0, 10) : null;
    if (!day) return [{ id: 'done:unknown', label: 'Earlier' }];
    const delta = daysBetween(day, today);
    if (delta <= 0) return [{ id: 'done:today', label: 'Today' }];
    if (delta === 1) return [{ id: 'done:yesterday', label: 'Yesterday' }];
    if (delta < 7) return [{ id: 'done:week', label: 'Earlier this week' }];
    if (delta < 31) return [{ id: 'done:month', label: 'This month' }];
    return [{ id: 'done:earlier', label: 'Earlier' }];
  }
  const due = task.schedule?.dueDate;
  if (groupBy === 'day') {
    if (!due) return [{ id: 'day:none', label: 'No date', drop: { kind: 'due', value: null } }];
    const delta = daysBetween(today, due);
    if (delta < 0) return [{ id: 'day:overdue', label: 'Overdue', tone: 'overdue' }];
    return [{ id: `day:${due}`, label: delta <= 1 ? relativeDay(due, today) : `${weekday(due, 'long')}`, sub: formatDate(due, { today }), tone: delta === 0 ? 'today' : '', drop: { kind: 'due', value: due } }];
  }
  // due grouping
  if (!due) return [{ id: 'due:none', label: 'No date', drop: { kind: 'due', value: null } }];
  const delta = daysBetween(today, due);
  if (delta < 0) return [{ id: 'due:overdue', label: 'Overdue', tone: 'overdue' }];
  if (delta === 0) return [{ id: 'due:today', label: 'Today', tone: 'today', drop: { kind: 'due', value: today } }];
  if (delta === 1) return [{ id: 'due:tomorrow', label: 'Tomorrow', drop: { kind: 'due', value: addDays(today, 1) } }];
  if (delta <= 7) return [{ id: 'due:week', label: 'Next 7 days' }];
  return [{ id: 'due:later', label: 'Later' }];
}

const GROUP_ORDER = {
  priority: ['priority:high', 'priority:medium', 'priority:low', 'priority:none'],
  due: ['due:overdue', 'due:today', 'due:tomorrow', 'due:week', 'due:later', 'due:none'],
  completedDay: ['done:today', 'done:yesterday', 'done:week', 'done:month', 'done:earlier', 'done:unknown'],
};

export function groupTasks(tasks, { groupBy, sortBy }, state) {
  const sorted = sortTasks(tasks, groupBy === 'completedDay' ? 'completed' : sortBy);
  if (!groupBy || groupBy === 'none') return [{ id: 'all', label: '', tasks: sorted }];
  const buckets = new Map();
  for (const task of sorted) {
    for (const bucket of bucketFor(task, groupBy, state)) {
      if (!buckets.has(bucket.id)) buckets.set(bucket.id, { ...bucket, tasks: [] });
      buckets.get(bucket.id).tasks.push(task);
    }
  }
  if (groupBy === 'day') {
    // Show every day of the coming week so a task can be dragged onto any of them.
    const today = state.meta.today;
    for (let offset = 0; offset <= 7; offset += 1) {
      const date = addDays(today, offset);
      const [bucket] = bucketFor({ schedule: { dueDate: date }, tags: [] }, 'day', state);
      if (!buckets.has(bucket.id)) buckets.set(bucket.id, { ...bucket, tasks: [], latent: true });
    }
  }
  if (groupBy === 'due') {
    // Keep the lanes that name one date reachable as drop targets.
    const today = state.meta.today;
    for (const date of [today, addDays(today, 1), null]) {
      const [bucket] = bucketFor({ schedule: { dueDate: date }, tags: [] }, 'due', state);
      if (!buckets.has(bucket.id)) buckets.set(bucket.id, { ...bucket, tasks: [], latent: true });
    }
  }
  const order = GROUP_ORDER[groupBy] || [];
  const rank = (id) => {
    if (groupBy === 'day') return id === 'day:overdue' ? '0' : id === 'day:none' ? '9' : `1${id.slice(4)}`;
    const index = order.indexOf(id);
    return String(index < 0 ? 99 : index).padStart(2, '0');
  };
  return [...buckets.values()].sort((a, b) => rank(a.id).localeCompare(rank(b.id)) || a.label.localeCompare(b.label));
}

export function listCounts(state) {
  const today = state.meta.today;
  const open = state.tasks.items.filter(isOpen);
  return {
    all: state.tasks.summary.open,
    inbox: state.tasks.summary.inbox.open,
    today: open.filter((task) => dueWithin(task, today, 0)).length,
    overdue: open.filter((task) => task.schedule?.dueDate && task.schedule.dueDate < today).length,
    next7: open.filter((task) => dueWithin(task, today, 7)).length,
    completed: state.tasks.summary.completed,
    trash: state.tasks.summary.trashed || 0,
  };
}

export function collectTags(items) {
  const byKey = new Map();
  for (const task of items) {
    if (task.trashedAt) continue;
    for (const tag of task.tags) {
      const key = normalize(tag);
      if (!byKey.has(key)) byKey.set(key, { label: tag, open: 0, total: 0 });
      const entry = byKey.get(key);
      entry.total += 1;
      if (task.status === 'open') entry.open += 1;
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function canReorder(scope, groupBy, sortBy) {
  return scope.lifecycle === 'active' && !scope.flat && (groupBy === 'none' || !groupBy) && sortBy === 'manual';
}

export function normalizeList(list, state) {
  const value = String(list || 'all');
  if (['all', 'inbox', 'today', 'next7', 'completed', 'trash'].includes(value)) return value;
  if (value.startsWith('project:') && state.projects.some((project) => project.id === value.slice(8))) return value;
  if (value.startsWith('view:') && state.workspace.views.some((view) => view.id === value.slice(5))) return value;
  if (value.startsWith('tag:') && value.length > 4) {
    const known = collectTags(state.tasks.items).find((tag) => normalize(tag.label) === normalize(value.slice(4)));
    return known ? `tag:${known.label}` : 'all';
  }
  return 'all';
}

// The rows a list currently shows, in order (for keyboard movement and range selection).
export function visibleRows(groups, scope, collapsed, index) {
  const rows = [];
  const visit = (task) => {
    rows.push(task.id);
    if (scope.flat || collapsed[task.id]) return;
    for (const child of index.get(task.id) || []) {
      if (scope.lifecycle === 'trash' ? isTrashed(child) : scope.lifecycle === 'completed' ? isCompleted(child) : isListed(child)) visit(child);
    }
  };
  for (const group of groups) for (const task of group.tasks) visit(task);
  return rows;
}
