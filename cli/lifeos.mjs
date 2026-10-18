#!/usr/bin/env node
import {
  DEFAULT_STORE_PATH,
  ACTIVITY_TYPES,
  buildCategoryStats,
  buildState,
  findProject,
  formatHours,
  formatMinutes,
  getState,
  readStore,
  requireProject,
  requireTask,
} from '../src/lifeos-data.mjs';
import { readTaskAuthority } from '../src/task-authority.mjs';
import { describeCommand, getCommand, listCommands, runCommand } from '../src/commands/index.mjs';

const ACTOR = process.env.LIFEOS_ACTOR || null;
const SOURCE = process.env.LIFEOS_SOURCE === 'codex' ? 'codex' : 'cli';
// Every CLI write goes through the shared command layer, so it is validated,
// journaled for Undo and visible in the app's Activity feed.
const run = async (name, input) => (await runCommand(name, input, { source: SOURCE, actor: ACTOR }));

const args = process.argv.slice(2);
const command = args[0] || 'help';

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
  } else if (command === 'projects') {
    await projectsCommand(args.slice(1));
  } else if (command === 'tasks') {
    await tasksCommand(args.slice(1));
  } else if (command === 'stats') {
    await statsCommand(args.slice(1));
  } else if (command === 'recommend') {
    await recommendCommand(args.slice(1));
  } else if (command === 'log') {
    await logCommand(args.slice(1));
  } else if (command === 'session') {
    await sessionCommand(args.slice(1));
  } else if (command === 'storage') {
    await storageCommand(args.slice(1));
  } else if (command === 'run') {
    await runGenericCommand(args.slice(1));
  } else if (command === 'commands') {
    commandsCommand(args.slice(1));
  } else if (command === 'describe') {
    describeGenericCommand(args.slice(1));
  } else if (command === 'overview') {
    await overviewCommand(args.slice(1));
  } else if (command === 'undo' || command === 'redo') {
    await undoCommand(command, args.slice(1));
  } else if (command === 'activity') {
    await activityCommand(args.slice(1));
  } else if (command === 'mcp') {
    await import('../scripts/lifeos-mcp.mjs');
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`lifeos: ${error.message}`);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`LifeOS

Usage:
  lifeos overview [--json]                       Compact digest of today
  lifeos run <command> [JSON | --field value ...] Run any LifeOS command (prints JSON)
  lifeos commands [group] [--json]               List every command
  lifeos describe <command>                      Show a command's input schema
  lifeos activity [--limit 20] [--json]          Recent changes by you and agents
  lifeos undo [operationId] | lifeos redo        Revert or reapply a change
  lifeos mcp                                     Start the full LifeOS MCP server (stdio)

  lifeos projects [--health] [--json]
  lifeos projects categorize --project "Portia" --category "Infinitamente"
  lifeos projects status --project "Vulcano" --status done
  lifeos projects delete --project "Infinitamente" --preserve-category "Infinitamente"
  lifeos tasks [--project "Portia" | --inbox | --tag "writing" | --completed | --trash] [--json]
  lifeos tasks add --title "Draft Act III" [--project "Portia"] [--parent "Outline film"] [--due YYYY-MM-DD] [--priority high|medium|low|none] [--tag writing]
  lifeos tasks complete --task "Draft Act III"
  lifeos tasks reopen --task "Draft Act III"
  lifeos tasks trash --task "Draft Act III"
  lifeos tasks restore --task "Draft Act III"
  lifeos tasks delete --task "Draft Act III"
  lifeos tasks assign --task "Draft Act III" --project "Portia"|inbox
  lifeos tasks priority --task "Draft Act III" --priority high|medium|low|none
  lifeos tasks tag --task "Draft Act III" --tag writing --tag "deep work"
  lifeos tasks tag --task "Draft Act III" --clear
  lifeos stats [--project "Portia" | --category "Infinitamente"] [--range week|month|quarter|year] [--json]
  lifeos recommend [--json]
  lifeos log --project "Portia" --duration 90 --type creative --desc "Act III draft"
  lifeos session start --project "Portia" --type creative --desc "Act III draft"
  lifeos session stop
  lifeos storage status [--json]
  lifeos storage configure-backup --path "/path/to/Google Drive/LifeOS Backups"
  lifeos storage disable-backup

Activity types:
  ${ACTIVITY_TYPES.join(', ')}
`);
}

async function tasksCommand(flags) {
  const authority = await readTaskAuthority(DEFAULT_STORE_PATH);
  if (authority && !(authority.mode === 'online' && authority.phase === 'active')) throw new Error('Task storage transfer is pending. Try again after activation.');
  const action = flags[0]?.startsWith('--') || !flags[0] ? 'list' : flags[0];
  const parsed = parseFlags(action === 'list' ? flags : flags.slice(1));

  if (action === 'add') {
    const title = String(parsed.title || parsed._.join(' ')).trim();
    if (!title) throw new Error('tasks add requires --title.');
    const store = await readStore();
    const parent = parsed.parent ? requireTask(store, parsed.parent) : null;
    const projectId = parsed.project
      ? resolveTaskProject(store, parsed.project)
      : parent?.projectId;
    const { result } = await run('tasks.create', clean({
      title,
      parentTaskId: parent?.id,
      ...(projectId !== undefined ? { projectId } : {}),
      dueDate: parsed.due,
      startTime: parsed.start,
      durationMinutes: parsed.duration === undefined ? undefined : Number(parsed.duration),
      priority: parsed.priority,
      tags: parsed.tag,
    }));
    const project = result.task.projectId
      ? store.projects.find((candidate) => candidate.id === result.task.projectId)?.name
      : 'Inbox';
    console.log(`Added task: ${result.task.title} - ${project}${parent ? ` under ${parent.title}` : ''}.`);
    return;
  }

  if (['complete', 'reopen', 'assign', 'priority', 'tag', 'trash', 'restore', 'delete'].includes(action)) {
    if (!parsed.task) throw new Error(`tasks ${action} requires --task.`);
    const store = await readStore();
    const task = requireTask(store, parsed.task);
    if (action === 'trash') {
      const { result } = await run('tasks.trash', { taskId: task.id });
      console.log(`Moved ${result.task.title}${result.trashedCount > 1 ? ` and ${result.trashedCount - 1} subtasks` : ''} to Trash.`);
      return;
    }
    if (action === 'restore') {
      const { result } = await run('tasks.restore', { taskId: task.id });
      console.log(`Restored ${result.task.title}${result.restoredCount > 1 ? ` and ${result.restoredCount - 1} related tasks` : ''}.`);
      return;
    }
    if (action === 'delete') {
      const { result } = await run('tasks.deleteForever', { taskId: task.id });
      console.log(`Permanently deleted ${result.task.title}${result.deletedCount > 1 ? ` and ${result.deletedCount - 1} subtasks` : ''}.`);
      return;
    }
    if (action === 'assign') {
      if (!parsed.project) throw new Error('tasks assign requires --project (use inbox for no project).');
      const projectId = resolveTaskProject(store, parsed.project);
      const { result } = await run('tasks.move', { taskId: task.id, projectId });
      const project = projectId
        ? store.projects.find((candidate) => candidate.id === projectId)?.name
        : 'Inbox';
      console.log(`Assigned ${result.task.title} to ${project}.`);
      return;
    }
    if (action === 'priority') {
      if (!parsed.priority) throw new Error('tasks priority requires --priority (high, medium, low, or none).');
      const { result } = await run('tasks.update', { taskId: task.id, priority: parsed.priority });
      console.log(`${result.task.title} is ${result.task.priority} priority.`);
      return;
    }
    if (action === 'tag') {
      if (!parsed.clear && !parsed.tag?.length) {
        throw new Error('tasks tag requires --tag (repeatable) or --clear.');
      }
      const { result } = await run('tasks.update', { taskId: task.id, tags: parsed.clear ? [] : parsed.tag });
      console.log(`${result.task.title} is tagged ${result.task.tags.length ? result.task.tags.join(', ') : '(none)'}.`);
      return;
    }
    const { result } = await run('tasks.complete', { taskId: task.id, completed: action === 'complete' });
    console.log(`${result.task.title} is ${result.task.status}.${result.affectedCount > 1 ? ` Updated ${result.affectedCount} tasks including subtasks.` : ''}`);
    return;
  }

  if (action !== 'list') throw new Error(`Unknown tasks action: ${action}`);
  if (parsed.completed && parsed.trash) throw new Error('Choose either --completed or --trash.');
  const state = await getState();
  const projectId = parsed.project ? resolveTaskProject(await readStore(), parsed.project) : null;
  const items = state.tasks.items.filter((task) => {
    if (parsed.trash ? !task.trashedAt : task.trashedAt) return false;
    if (parsed.completed ? task.status !== 'completed' : !parsed.trash && task.status !== 'open') return false;
    if (parsed.tag?.length && !task.tags.some((tag) => parsed.tag.some((needle) => (
      tag.toLowerCase() === String(needle).toLowerCase()
    )))) return false;
    if (parsed.inbox) return task.projectId == null;
    if (parsed.project) return task.projectId === projectId;
    return true;
  });
  if (parsed.json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  if (!items.length) {
    console.log('No tasks in this scope.');
    return;
  }
  for (const task of items) {
    const mark = task.trashedAt ? '[trash]' : task.status === 'completed' ? '[x]' : '[ ]';
    const indent = '  '.repeat(task.depth);
    const project = task.projectId
      ? state.projects.find((candidate) => candidate.id === task.projectId)?.name
      : 'Inbox';
    const due = task.schedule.dueDate ? ` due ${task.schedule.dueDate}` : '';
    const priority = task.priority === 'none' ? '' : ` !${task.priority}`;
    const tags = task.tags.length ? ` ${task.tags.map((tag) => `#${tag}`).join(' ')}` : '';
    console.log(`${indent}${mark} ${task.title} - ${project}${due}${priority}${tags}`);
  }
}

function resolveTaskProject(store, query) {
  if (['inbox', 'none', 'general'].includes(String(query).trim().toLowerCase())) return null;
  return requireProject(store, query).id;
}

async function storageCommand(flags) {
  const { backUpStore, configureBackupDirectory, disableBackupDirectory, getStorageStatus } = await import('../src/lifeos-storage.mjs');
  const action = flags[0] || 'status';
  const parsed = parseFlags(flags.slice(1));
  if (action === 'configure-backup') {
    if (!parsed.path) throw new Error('storage configure-backup requires --path.');
    const status = await configureBackupDirectory(parsed.path, await readStore());
    console.log(`Cloud snapshots enabled: ${status.backupDirectory}`);
    console.log(`Latest snapshot: ${status.latestSnapshotAt || 'created'}`);
    return;
  }
  if (action === 'disable-backup') {
    await disableBackupDirectory();
    console.log('Cloud snapshots disabled. Existing backups were preserved.');
    return;
  }
  if (action === 'backup-now') {
    const result = await backUpStore(await readStore());
    if (!result.configured) throw new Error('No cloud backup directory is configured.');
    if (!result.ok) throw new Error(`Cloud backup failed: ${result.error}`);
    console.log(`Snapshot written: ${result.latestPath}`);
    return;
  }
  if (action !== 'status') throw new Error(`Unknown storage action: ${action}`);
  const status = await getStorageStatus();
  if (parsed.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`Personal data: ${status.storePath}`);
  console.log(`Cloud backup: ${status.backupConfigured ? status.backupDirectory : 'not configured'}`);
  console.log(`Latest snapshot: ${status.latestSnapshotAt || '-'}`);
  if (status.lastBackup?.ok === false) console.log(`Last backup error: ${status.lastBackup.error}`);
  if (!status.backupConfigured && status.detectedGoogleDrives.length) {
    console.log('Detected Google Drive folders:');
    for (const drive of status.detectedGoogleDrives) console.log(`  ${drive}`);
  }
}

async function projectsCommand(flags) {
  const action = flags[0]?.startsWith('--') || !flags[0] ? 'list' : flags[0];
  const parsed = parseFlags(action === 'list' ? flags : flags.slice(1));

  if (action !== 'list') {
    if (!parsed.project) throw new Error(`projects ${action} requires --project.`);
    const store = await readStore();
    const project = requireProject(store, parsed.project);
    if (action === 'categorize') {
      if (!parsed.category) throw new Error('projects categorize requires --category.');
      const { result } = await run('projects.addCategory', { projectId: project.id, category: parsed.category });
      console.log(`Categorized ${result.project.name} as ${result.category.label}.`);
      return;
    }
    if (action === 'status') {
      if (!parsed.status) throw new Error('projects status requires --status.');
      const { result } = await run('projects.setStatus', { projectId: project.id, status: parsed.status });
      console.log(`${result.project.name} is ${result.project.status}.`);
      return;
    }
    if (action === 'delete') {
      const { result } = await run('projects.delete', clean({
        projectId: project.id,
        preserveCategory: parsed['preserve-category'],
      }));
      const preserved = result.preservedEntryCount
        ? ` Preserved ${result.preservedEntryCount} time entries${result.preservedCategory ? ` under ${result.preservedCategory.label}` : ''}.`
        : '';
      const detachedTasks = result.detachedTaskCount
        ? ` Moved ${result.detachedTaskCount} associated ${result.detachedTaskCount === 1 ? 'task' : 'tasks'} to Inbox.`
        : '';
      console.log(`Deleted project ${result.project.name}.${preserved}${detachedTasks}`);
      return;
    }
    throw new Error(`Unknown projects action: ${action}`);
  }

  const state = await getState();
  if (parsed.json) {
    console.log(JSON.stringify(state.projects, null, 2));
    return;
  }

  for (const project of state.projects) {
    const due = project.dueInDays == null ? 'due -' : `due ${project.dueInDays}d`;
    console.log(`${project.name.padEnd(18)} ${project.health.padEnd(9)} last ${project.lastTouchedLabel.padEnd(7)} week ${project.weekHoursLabel.padEnd(7)} ${due}`);
  }
}

async function statsCommand(flags) {
  const parsed = parseFlags(flags);
  if (parsed.category) {
    const stats = buildCategoryStats(await readStore(), parsed.category, { range: parsed.range || 'week' });
    if (parsed.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log(`${stats.category.label}`);
    console.log(`  ${stats.rangeLabel}: ${stats.totalLabel} across ${stats.entryCount} entries`);
    console.log(`  projects: ${stats.projects.length ? stats.projects.map((project) => project.name).join(', ') : '-'}`);
    return;
  }
  const state = await getState(undefined, { range: parsed.range || 'week' });
  if (parsed.json) {
    console.log(JSON.stringify(state.summary, null, 2));
    return;
  }

  if (parsed.project) {
    const store = await readStore();
    const project = findProject(store, parsed.project);
    if (!project) throw new Error(`Project not found: ${parsed.project}`);
    const hydrated = buildState(store).projects.find((candidate) => candidate.id === project.id);
    console.log(`${hydrated.name}`);
    console.log(`  health: ${hydrated.health}`);
    console.log(`  last:   ${hydrated.lastTouchedLabel}`);
    console.log(`  week:   ${hydrated.weekHoursLabel} of ${formatHours(hydrated.plannedHours)} planned`);
    console.log(`  due:    ${hydrated.dueInDays == null ? '-' : `${hydrated.dueInDays}d`}`);
    console.log(`  note:   ${hydrated.note}`);
    return;
  }

  console.log(`${state.summary.rangeLabel}: ${state.summary.totalRangeLabel} / ${state.summary.plannedRangeLabel} planned`);
  console.log(`Today: ${state.summary.todayLabel} across ${state.todayEntries.length} entries`);
  console.log(`Deep ratio: ${Math.round(state.summary.deepRatio * 100)}%`);
  console.log(`Projects: ${state.summary.activeCount} active, ${state.summary.criticalCount} critical`);
}

async function recommendCommand(flags) {
  const state = await getState();
  const rec = state.recommendation;
  if (flags.includes('--json')) {
    console.log(JSON.stringify(rec, null, 2));
    return;
  }
  if (!rec) {
    console.log('No recommendation available.');
    return;
  }
  console.log(`${rec.projectName}: ${rec.action}`);
  console.log(rec.reasonLong);
  if (rec.alternatives.length) {
    console.log(`Alternatives: ${rec.alternatives.map((item) => `${item.projectName} ${formatMinutes(item.durationMinutes)}`).join(' | ')}`);
  }
}

async function logCommand(flags) {
  const parsed = parseFlags(flags);
  const rawInput = parsed._.join(' ').trim();
  const duration = parsed.duration ? Number(parsed.duration) : null;
  const { result } = await run('time.log', clean({
    project: parsed.project,
    durationMinutes: duration || undefined,
    activityType: parsed.type,
    description: parsed.desc || rawInput || undefined,
    rawInput: rawInput || parsed.desc,
    date: parsed.date,
    time: parsed.time,
  }));

  const project = result.entry.projectId
    ? (await readStore()).projects.find((candidate) => candidate.id === result.entry.projectId)?.name
    : 'Inbox';
  console.log(`Logged ${formatMinutes(result.entry.durationMinutes)} ${result.entry.activityType} - ${project}`);
}

async function sessionCommand(flags) {
  const action = flags[0] || 'status';
  const parsed = parseFlags(flags.slice(1));
  if (action === 'start') {
    const { result } = await run('timer.start', clean({
      project: parsed.project,
      activityType: parsed.type,
      description: parsed.desc,
    }));
    const project = result.session.projectId
      ? (await readStore()).projects.find((candidate) => candidate.id === result.session.projectId)?.name
      : 'Inbox';
    console.log(`Started ${result.session.activityType} - ${project}`);
    return;
  }
  if (action === 'stop') {
    const { result } = await run('timer.stop', {});
    console.log(`Stopped and logged ${formatMinutes(result.entry.durationMinutes)} ${result.entry.activityType}`);
    return;
  }
  if (action !== 'status') throw new Error(`Unknown session action: ${action}`);
  const state = await getState();
  if (!state.activeSession) {
    console.log('No active session.');
    return;
  }
  const project = state.projects.find((candidate) => candidate.id === state.activeSession.projectId)?.name || 'Inbox';
  console.log(`Active since ${state.activeSession.startedAt}: ${project} - ${state.activeSession.description}`);
}

function parseFlags(values) {
  const parsed = { _: [] };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith('--')) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === 'json' || key === 'health' || key === 'inbox' || key === 'clear' || key === 'completed' || key === 'trash') {
      parsed[key] = true;
      continue;
    }
    if (key === 'tag') {
      parsed.tag = [...(parsed.tag || []), values[i + 1]];
      i += 1;
      continue;
    }
    parsed[key] = values[i + 1];
    i += 1;
  }
  return parsed;
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

// `lifeos run tasks.create '{"title":"Draft"}'` or
// `lifeos run tasks.create --title Draft --project Portia --tags a --tags b`.
async function runGenericCommand(values) {
  const name = values[0];
  if (!name) throw new Error('lifeos run needs a command name. Try: lifeos commands');
  const command = getCommand(name);
  if (!command) throw new Error(`Unknown command: ${name}. Try: lifeos commands`);
  const rest = values.slice(1);
  let input = {};
  if (rest[0] && !rest[0].startsWith('--')) {
    try { input = JSON.parse(rest[0]); } catch { throw new Error('The first argument after the command must be a JSON object, or use --field value flags.'); }
    rest.shift();
  }
  const schema = describeCommand(command).inputSchema?.properties || {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    const key = flag.slice(2);
    const property = schema[key] || {};
    const types = [property.type, ...(property.anyOf || []).map((option) => option.type)].filter(Boolean);
    const next = rest[index + 1];
    if (types.includes('boolean') && (next === undefined || next.startsWith('--'))) { input[key] = true; continue; }
    index += 1;
    let value = next;
    if (value === 'null' && types.includes('null')) value = null;
    else if (types.includes('number') || types.includes('integer')) value = Number(value);
    else if (types.includes('boolean')) value = value === 'true';
    else if (types.includes('object')) value = JSON.parse(value);
    if (types.includes('array')) input[key] = [...(input[key] || []), value];
    else input[key] = value;
  }
  const output = await run(name, input);
  const { state: _state, ...printable } = output;
  console.log(JSON.stringify(printable, null, 2));
}

function commandsCommand(values) {
  const parsed = parseFlags(values);
  const group = parsed._[0];
  const commands = listCommands().filter((command) => !group || command.group === group);
  if (parsed.json) {
    console.log(JSON.stringify(commands, null, 2));
    return;
  }
  let current = '';
  for (const command of commands) {
    if (command.group !== current) {
      current = command.group;
      console.log(`\n${current}`);
    }
    const marks = [command.kind === 'read' ? 'read' : command.kind === 'ui' ? 'ui' : 'write', command.destructive ? 'destructive' : ''].filter(Boolean).join(', ');
    console.log(`  ${command.name.padEnd(26)} ${command.title} (${marks})`);
  }
  console.log('\nRun one with: lifeos run <command> --field value   ·   Schema: lifeos describe <command>');
}

function describeGenericCommand(values) {
  const command = values[0] && getCommand(values[0]);
  if (!command) throw new Error(`Unknown command: ${values[0] || '(none)'}. Try: lifeos commands`);
  console.log(JSON.stringify(describeCommand(command), null, 2));
}

async function overviewCommand(values) {
  const { result } = await run('overview', {});
  if (values.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`${result.today} · week ${result.week}`);
  if (result.timer) console.log(`Timer: ${result.timer.project || 'General'} — ${result.timer.description} (${result.timer.elapsedMinutes}m)`);
  console.log(`Today: ${result.todayLogged.label} logged of ${result.todayLogged.planHours}h planned · this week ${result.thisWeek.label}`);
  if (result.recommendation) console.log(`Next: ${result.recommendation.project} — ${result.recommendation.action}`);
  console.log(`Projects: ${result.projects.active} active, ${result.projects.critical} critical`);
  console.log(`Tasks: ${result.tasks.open} open, ${result.tasks.overdue.length} overdue, ${result.tasks.dueToday.length} due today, ${result.tasks.inbox} in Inbox`);
  for (const task of [...result.tasks.overdue, ...result.tasks.dueToday].slice(0, 10)) {
    console.log(`  [ ] ${task.title} — ${task.project}${task.dueDate ? ` (due ${task.dueDate})` : ''}`);
  }
  if (result.reading.reading.length) console.log(`Reading: ${result.reading.reading.map((book) => book.title).join(', ')}`);
}

async function undoCommand(action, values) {
  const output = action === 'undo'
    ? await run('history.undo', values[0] ? { operationId: values[0] } : {})
    : await run('history.redo', {});
  console.log(output.label || (action === 'undo' ? 'Undone.' : 'Redone.'));
}

async function activityCommand(values) {
  const parsed = parseFlags(values);
  const { result } = await run('history.list', { limit: Number(parsed.limit || 20) });
  if (parsed.json) {
    console.log(JSON.stringify(result.entries, null, 2));
    return;
  }
  if (!result.entries.length) {
    console.log('No recorded changes yet.');
    return;
  }
  for (const entry of result.entries) {
    const when = new Date(entry.at).toLocaleString();
    const who = entry.actor ? `${entry.source}:${entry.actor}` : entry.source;
    console.log(`${when.padEnd(22)} ${who.padEnd(16)} ${entry.undoneBy ? '(undone) ' : ''}${entry.label}  [${entry.id}]`);
  }
}
