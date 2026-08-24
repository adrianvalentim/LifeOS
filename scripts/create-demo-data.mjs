#!/usr/bin/env node
import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const demoPath = path.join(root, 'data', 'lifeos.demo.json');
const activePath = path.join(root, 'data', 'lifeos.json');
const demoDate = process.env.LIFEOS_DEMO_DATE || '2026-08-22';
const writeActive = process.argv.includes('--write-active');

const domains = {
  filmmaking: { label: 'Filmmaking', short: 'FILM', color: '#b4502c' },
  research: { label: 'Research', short: 'RSCH', color: '#3a6b85' },
  education: { label: 'Education', short: 'EDU', color: '#5e7d2c' },
  content: { label: 'Content', short: 'CONT', color: '#a23c6b' },
  business: { label: 'Business', short: 'BIZ', color: '#9c7720' },
  personal: { label: 'Personal', short: 'PERS', color: '#5e4a9c' },
};

const projects = [
  project('portia', 'Portia', 'Short film - script', 'filmmaking', 5, 6, 3, 0.2, 'Acts III and IV still in outline. Deadline Tuesday.'),
  project('substack', 'Substack', 'Essay: Slow time', 'content', 4, 4, 3, 0.2, 'Draft at 20%. Outline solid; prose stalled.'),
  project('curriculum', 'Curriculum 2026', 'Graduate ML syllabus', 'education', 3, 4, 21, 0.35, 'Module 4 outline pending.'),
  project('sfprep', 'SF Move', 'Relocation logistics', 'personal', 3, 2, 56, 0.25, 'Visa paperwork next. Awaiting employer letter.'),
  project('vulcano', 'Vulcano', 'Documentary feature', 'filmmaking', 4, 12, 28, 0.62, 'Color pass on Act II. Cleared 6 shots.'),
  project('mechinterp', 'Mech Interp Lab', 'Graduate supervision', 'research', 4, 8, null, null, "Reviewed M.'s circuits notebook."),
  project('infinitamente', 'Infinitamente', 'YouTube channel', 'content', 4, 6, 5, 0.7, 'Episode 47 cut locked. B-roll pending.'),
  project('longnow', 'The Long Now', 'Podcast - ep. 23', 'content', 3, 3, 9, 0.55, 'Guest confirmed. Outline drafted.'),
  project('aurora', 'Aurora Store', 'Online shop - ops', 'business', 2, 3, null, null, 'August restock processed. 14 orders pending.'),
];

const history = {
  portia: [4.1, 3.2, 2.8, 1.6, 1.0, 0.4, 0],
  substack: [2.5, 2.0, 1.5, 1.0, 0.8, 0.7, 1.2],
  curriculum: [3.2, 4.0, 3.8, 3.5, 2.5, 2.0, 1.5],
  sfprep: [0, 0, 0.5, 1.0, 0.8, 1.5, 1.2],
  vulcano: [8.2, 9.1, 11.3, 10.8, 12.4, 13.0, 11.9],
  mechinterp: [6.5, 7.2, 8.0, 7.4, 7.0, 8.3, 8.1],
  infinitamente: [5.8, 6.0, 7.2, 6.5, 6.0, 6.8, 7.0],
  longnow: [3.5, 3.0, 2.8, 3.2, 3.0, 3.5, 3.0],
  aurora: [4.0, 3.8, 3.2, 4.5, 4.0, 3.5, 4.2],
};

const weekStart = startOfWeek(demoDate);
const timeEntries = [];

for (let historyIndex = 0; historyIndex < 7; historyIndex += 1) {
  const weeksAgo = 7 - historyIndex;
  const date = addDays(weekStart, -7 * weeksAgo);
  for (const item of projects) {
    const hours = history[item.id][historyIndex];
    if (!hours) continue;
    timeEntries.push({
      id: `demo-history-${date}-${item.id}`,
      projectId: item.id,
      date,
      time: null,
      durationMinutes: Math.round(hours * 60),
      activityType: defaultActivity(item.domain),
      description: 'Imported weekly total for demo history',
      rawInput: '',
      captureSource: 'demo_import',
      aggregation: 'weekly',
      createdAt: `${date}T12:00:00-03:00`,
    });
  }
}

const sessions = [
  [0, '08:30', 30, 'substack', 'creative', 'Outlined the closing section'],
  [0, '09:15', 240, 'vulcano', 'creative', 'Edited the eclipse and observatory sequence'],
  [0, '14:00', 120, 'mechinterp', 'research', 'Reviewed circuit-analysis notes'],
  [1, '08:30', 102, 'curriculum', 'research', 'Drafted Module 4 reading map'],
  [1, '10:30', 180, 'vulcano', 'creative', 'Color pass and animation timing'],
  [1, '15:00', 120, 'mechinterp', 'research', 'Prepared supervision feedback'],
  [2, '08:45', 72, 'sfprep', 'admin', 'Visa paperwork and relocation checklist'],
  [2, '10:15', 120, 'vulcano', 'creative', 'Refined the Le Verrier narration'],
  [2, '14:00', 120, 'mechinterp', 'research', 'Tested interpretability examples'],
  [3, '08:30', 192, 'vulcano', 'creative', 'Cut Act II and cleared six shots'],
  [3, '13:30', 180, 'infinitamente', 'creative', 'Locked episode 47 edit'],
  [4, '08:00', 120, 'vulcano', 'creative', 'Reviewed final color pass'],
  [4, '10:15', 204, 'infinitamente', 'creative', 'Selected B-roll and revised captions'],
  [4, '14:00', 141, 'longnow', 'research', 'Prepared the episode 23 interview outline'],
  [4, '16:30', 234, 'aurora', 'admin', 'Processed restock and pending orders'],
  [5, '07:02', 45, 'longnow', 'research', "Background reading - guest's 2023 paper"],
  [5, '07:47', 28, null, 'shallow_work', 'Inbox triage and scheduling'],
  [5, '08:15', 19, 'mechinterp', 'communication', 'Async reply about circuit visualization'],
  [5, '09:00', 89, 'mechinterp', 'research', 'Reviewed a circuits notebook'],
];

for (const [dayOffset, time, durationMinutes, projectId, activityType, description] of sessions) {
  const date = addDays(weekStart, dayOffset);
  timeEntries.push({
    id: `demo-session-${date}-${String(time).replace(':', '')}-${projectId || 'inbox'}`,
    projectId,
    date,
    time,
    durationMinutes,
    activityType,
    description,
    rawInput: description,
    captureSource: 'demo_seed',
    createdAt: `${date}T${time}:00-03:00`,
  });
}

const store = {
  meta: {
    schemaVersion: 2,
    appName: 'LifeOS',
    tagline: 'A personal almanac',
    timezone: 'America/Sao_Paulo',
    activeTab: 'projects',
    demo: true,
    demoGeneratedFor: demoDate,
  },
  domains,
  settings: {
    deepTarget: 0.65,
    defaultDailyPlanHours: 8,
    weeklyPlanByDomain: {
      filmmaking: 18,
      research: 8,
      education: 4,
      content: 13,
      business: 3,
      personal: 2,
    },
    health: {
      criticalInactiveDays: 5,
      attentionInactiveDays: 2.5,
    },
  },
  projects,
  timeEntries,
  activeSession: null,
  challenge: {
    id: 'portia-deep-work',
    text: 'Three deep-work sessions on Portia before Sunday.',
    projectId: 'portia',
    startDate: weekStart,
    endDate: addDays(weekStart, 6),
    target: 3,
    minDurationMinutes: 45,
    activityTypes: ['deep_work', 'creative'],
  },
  milestones: [
    { date: addDays(demoDate, -1), text: 'Vulcano: Act II color pass complete' },
    { date: addDays(demoDate, -3), text: 'Long Now ep. 22 published' },
    { date: addDays(demoDate, -5), text: 'Submitted mech-interp position paper draft' },
    { date: addDays(demoDate, -8), text: 'Infinitamente ep. 46 - 38k views first 48h' },
    { date: addDays(demoDate, -10), text: 'Curriculum: Module 3 finalized' },
    { date: addDays(demoDate, -13), text: 'Aurora Store: August restock shipped' },
  ],
};

await writeFile(demoPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
if (writeActive) await copyFile(demoPath, activePath);

console.log(`Wrote ${path.relative(root, demoPath)}${writeActive ? ' and reset data/lifeos.json' : ''}.`);

function project(id, name, subtitle, domain, priority, plannedHours, deadlineOffset, progress, note) {
  return {
    id,
    name,
    subtitle,
    domain,
    status: 'active',
    priority,
    plannedHours,
    deadline: deadlineOffset == null ? null : addDays(demoDate, deadlineOffset),
    progress,
    note,
    createdAt: `${addDays(demoDate, -180)}T12:00:00-03:00`,
  };
}

function defaultActivity(domain) {
  if (domain === 'filmmaking' || domain === 'content') return 'creative';
  if (domain === 'research' || domain === 'education') return 'research';
  return 'admin';
}

function dateNumber(date) {
  const [year, month, day] = String(date).slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateString(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(date, amount) {
  return dateString(dateNumber(date) + amount * 86_400_000);
}

function startOfWeek(date) {
  const value = new Date(dateNumber(date));
  const day = value.getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
