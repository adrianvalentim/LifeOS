#!/usr/bin/env node
import {
  ACTIVITY_TYPES,
  buildState,
  findProject,
  formatHours,
  formatMinutes,
  getState,
  logTime,
  readStore,
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
  lifeos stats [--project "Portia"] [--range week|month|quarter|year] [--json]
  lifeos recommend [--json]
  lifeos log --project "Portia" --duration 90 --type creative --desc "Act III draft"
  lifeos session start --project "Portia" --type creative --desc "Act III draft"
  lifeos session stop

Activity types:
  ${ACTIVITY_TYPES.join(', ')}
`);
}

async function projectsCommand(flags) {
  const json = flags.includes('--json');
  const state = await getState();
  if (json) {
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
