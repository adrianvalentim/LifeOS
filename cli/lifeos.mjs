#!/usr/bin/env node
import {
  ACTIVITY_TYPES,
  addProjectCategory,
  buildCategoryStats,
  buildState,
  deleteProject,
  findProject,
  formatHours,
  formatMinutes,
  getState,
  logTime,
  readStore,
  requireProject,
  setProjectStatus,
  startSession,
  stopSession,
} from '../src/lifeos-data.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'help';

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
  } else if (command === 'projects') {
    await projectsCommand(args.slice(1));
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
  lifeos projects [--health] [--json]
  lifeos projects categorize --project "Portia" --category "Infinitamente"
  lifeos projects status --project "Vulcano" --status done
  lifeos projects delete --project "Infinitamente" --preserve-category "Infinitamente"
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
      const result = await addProjectCategory({ projectId: project.id, category: parsed.category });
      console.log(`Categorized ${result.project.name} as ${result.category.label}.`);
      return;
    }
    if (action === 'status') {
      if (!parsed.status) throw new Error('projects status requires --status.');
      const result = await setProjectStatus({ projectId: project.id, status: parsed.status });
      console.log(`${result.project.name} is ${result.project.status}.`);
      return;
    }
    if (action === 'delete') {
      const result = await deleteProject({
        projectId: project.id,
        preserveCategory: parsed['preserve-category'],
      });
      const preserved = result.preservedEntryCount
        ? ` Preserved ${result.preservedEntryCount} time entries${result.preservedCategory ? ` under ${result.preservedCategory.label}` : ''}.`
        : '';
      console.log(`Deleted project ${result.project.name}.${preserved}`);
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
  const result = await logTime({
    project: parsed.project,
    durationMinutes: duration,
    activityType: parsed.type,
    description: parsed.desc || rawInput,
    rawInput: rawInput || parsed.desc,
    date: parsed.date,
    time: parsed.time,
    source: 'cli',
  });

  const project = result.entry.projectId
    ? result.state.projects.find((candidate) => candidate.id === result.entry.projectId)?.name
    : 'Inbox';
  console.log(`Logged ${formatMinutes(result.entry.durationMinutes)} ${result.entry.activityType} - ${project}`);
}

async function sessionCommand(flags) {
  const action = flags[0] || 'status';
  const parsed = parseFlags(flags.slice(1));
  if (action === 'start') {
    const result = await startSession({
      project: parsed.project,
      activityType: parsed.type,
      description: parsed.desc,
      rawInput: flags.join(' '),
    });
    const project = result.session.projectId
      ? result.state.projects.find((candidate) => candidate.id === result.session.projectId)?.name
      : 'Inbox';
    console.log(`Started ${result.session.activityType} - ${project}`);
    return;
  }
  if (action === 'stop') {
    const result = await stopSession();
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
    if (key === 'json' || key === 'health') {
      parsed[key] = true;
      continue;
    }
    parsed[key] = values[i + 1];
    i += 1;
  }
  return parsed;
}
