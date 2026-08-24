# LifeOS

LifeOS is a local personal almanac for answering three questions:

1. Where is my time going?
2. What is the state of my projects?
3. What should I do next?

It combines a compact editorial dashboard, a portable JSON data store, a command-line interface, and a Codex rail connected to the installed Codex application.

## Run it

Requirements: Node.js 20+ and the Codex desktop app or Codex CLI signed in with a ChatGPT account.

```bash
npm run dev
```

Open the local address printed in the terminal, normally `http://127.0.0.1:3000`. If that port is occupied, LifeOS selects the next available port.

No dependency installation, database server, API key, or OpenAI API billing is required.

## How it is built

```text
Browser UI
   |-- local JSON API --------> data/lifeos.json
   |                              ^
   |                              | atomic writes + backup + lock
   |                              v
   |                           LifeOS CLI
   |
   `-- local Codex bridge ----> installed `codex app-server`
                                  `-- signed-in ChatGPT account
```

- `public/` is a dependency-free HTML/CSS/JavaScript interface.
- `scripts/dev-server.mjs` is the local Node HTTP server and live-update stream.
- `src/lifeos-data.mjs` validates data and calculates every visible statistic.
- `src/codex-app-server.mjs` speaks the installed Codex app-server protocol over a local child process.
- `cli/lifeos.mjs` gives Codex a concise, stable way to operate the data without rereading the application.
- `data/lifeos.json` is the active, portable data store.
- `data/lifeos.demo.json` is a clean demonstration snapshot.

This is intentionally a small cross-platform foundation: Node and browser APIs work on macOS, Linux, and Windows. Codex executable discovery supports the macOS app bundle and normal `PATH` installations; `CODEX_EXECUTABLE` can override the location. A native shell such as Tauri can be added later without replacing the data or interface layers.

## Codex rail

The rail is a front end to Codex, not a separate chatbot:

- It uses the locally installed Codex executable and the account already signed into it.
- It lists only Codex tasks whose working directory is this LifeOS project.
- The most recent task is selected automatically; a saved selection is restored on reload.
- New and resumed tasks receive compact LifeOS instructions: use `AGENTS.md` and the CLI first, and inspect source files only for actual implementation work.
- Messages, streamed output, commands, file changes, approvals, and user questions are shown in the rail.
- Data changes made by Codex are detected and reflected in the dashboard automatically.

Voice is the one requested part that the installed Codex bridge cannot currently provide under the no-API constraint. A live check found that the app server does not expose the desktop application's dictation feature to ChatGPT-account clients; its separate realtime conversation route requires API-key authentication. LifeOS therefore leaves voice visibly unavailable instead of quietly adding Whisper, Ollama, browser speech services, or an OpenAI API key. Typed chat remains fully connected to the current Codex account. If Codex later exposes subscription-authenticated dictation through app-server, this boundary can be revisited.

## Demo data and real data

Every dashboard number is derived from `projects`, `timeEntries`, `settings`, `challenge`, and `milestones` in `data/lifeos.json`. There are no separate display totals to keep synchronized.

To prove the data path, change or add a time entry and refresh; the project hours, health, Today total, ranges, domain chart, composition, heatmap, deep-work counters, and recommendation will recompute. Changes made while the app is open appear automatically.

To restore the clean demonstration snapshot:

```bash
npm run demo:reset
```

This intentionally overwrites the active `data/lifeos.json`. Once you begin entering real data, keep `data/lifeos.demo.json` as the example and do not run that reset command.

The safest way to add time is through the Codex rail or CLI:

```bash
npm run lifeos -- log --project "Vulcano" --duration 180 --type creative --desc "Edited eclipse sequence"
npm run lifeos -- session start --project "Portia" --type creative --desc "Draft Act III"
npm run lifeos -- session stop
```

Other useful commands:

```bash
npm run lifeos -- projects --health
npm run lifeos -- stats --range month
npm run lifeos -- recommend
```

Writes are serialized with a short lock, written through a temporary file, and keep the preceding snapshot at `data/lifeos.json.bak`. Backup and lock files are ignored by Git.

## Controls now implemented

- All four primary tabs.
- Week, month, quarter, and year analytics ranges with URL state.
- Recommendation alternate, dismiss/restore, begin, and stop-and-log.
- Real Codex task selection, new task, refresh, send, stop, approvals, and questions.
- `Command/Ctrl + K` chat focus.
- An explicit voice-unavailable state that preserves the no-API/no-separate-model rule.
- Automatic refresh after local data changes.
- Clear inline errors instead of silent control failures.

## Deliberately deferred

The next phase is the larger set of management workflows: project creation/editing, manual time-entry editing, goals/deadlines, searchable almanac history, settings, import/export UI, and native desktop packaging. The data and local Codex architecture are ready for those additions, but they are not disguised as finished controls here.

## Verify

```bash
npm run check
```

This checks the browser and server JavaScript and runs the data, persistence, timer, and Codex-protocol tests.
