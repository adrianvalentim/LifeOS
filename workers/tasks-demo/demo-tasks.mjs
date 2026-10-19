// Explicit synthetic records. This module has no filesystem or personal-store input.
const base = {
  projectId: null, status: 'open', notes: '', priority: 'none', tags: ['demo'],
  schedule: { dueDate: null, startTime: null, durationMinutes: null, recurrence: null },
  createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
  completedAt: null, trashedAt: null,
};
const tasks = [
  { ...base, id: 'demo-mcp-check', title: 'Verify the synthetic task connection', parentTaskId: null,
    sortOrder: 0, priority: 'high', notes: 'Synthetic demo task.\nRead this from Mercury to verify direct MCP access.' },
  { ...base, id: 'demo-mcp-subtask', title: 'Read the synthetic task details', parentTaskId: 'demo-mcp-check',
    sortOrder: 0, schedule: { ...base.schedule, dueDate: '2026-10-10' } },
  { ...base, id: 'demo-mcp-finished', title: 'Prepare synthetic records', parentTaskId: null,
    sortOrder: 1, status: 'completed', completedAt: '2026-10-09T00:00:00.000Z' },
];
const normalize = (value) => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function createDemoTaskService() {
  return {
    async list({ scope = 'open', query, projectId, tag, dueFrom, dueThrough, limit = 50, offset = 0 } = {}) {
      if (projectId != null) throw new Error('Unknown project ID.');
      const selected = tasks.filter((task) => {
        if (scope === 'trash') return false;
        if (['open', 'completed'].includes(scope) && task.status !== scope) return false;
        if (tag && !task.tags.some((t) => normalize(t) === normalize(tag))) return false;
        if (query && !normalize([task.id, task.title, task.notes, ...task.tags].join('\n')).includes(normalize(query))) return false;
        if (dueFrom && (!task.schedule.dueDate || task.schedule.dueDate < dueFrom)) return false;
        if (dueThrough && (!task.schedule.dueDate || task.schedule.dueDate > dueThrough)) return false;
        return true;
      }).sort((a, b) => (a.parentTaskId || '').localeCompare(b.parentTaskId || '') || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
      return {
        tasks: selected.slice(offset, offset + limit).map(({ notes, ...task }) => structuredClone({ ...task, hasNotes: Boolean(notes) })),
        total: selected.length, nextOffset: offset + limit < selected.length ? offset + limit : null,
        timezone: 'Etc/UTC', dataset: 'synthetic-demo',
      };
    },
    async get({ taskId }) {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error('Task not found.');
      const descendants = new Set([taskId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of tasks) {
          if (descendants.has(candidate.parentTaskId) && !descendants.has(candidate.id)) {
            descendants.add(candidate.id); changed = true;
          }
        }
      }
      return { task: structuredClone(task), descendantCount: descendants.size - 1, timezone: 'Etc/UTC', dataset: 'synthetic-demo' };
    },
  };
}
