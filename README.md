# LifeOS

LifeOS is a local-first personal almanac for coordinating projects, tasks,
focused work, and reading. It is built to answer five practical questions:

1. Where is my time going?
2. What is the state of my projects?
3. What should I do next?
4. What concrete commitments are open, and how do they break down?
5. What am I reading now and next?

It combines an editorial dashboard, a portable JSON store, a concise CLI, and a
Codex rail connected to the Codex installation and ChatGPT account already on
the computer.

## What makes it different

- **Local-first by construction.** The live personal store sits in the
  operating system's application-data directory, outside the repository.
- **One source of truth.** Project health, recommendations, time allocation,
  streaks, and charts are derived from source records rather than maintained as
  separate display totals.
- **Codex without another AI account.** The rail uses the installed
  `codex app-server` and its signed-in ChatGPT account—no OpenAI API key, SDK
  client, alternate model, or per-request API billing.
- **Transparent and recoverable.** Writes are validated, locked, atomically
  replaced, and backed by a local recovery copy. Optional Google Drive snapshots
  go only to one explicitly selected folder.
- **A deliberately small stack.** The main app uses Node.js and browser-native
  HTML, CSS, JavaScript, JSON, and Server-Sent Events. There is no hosted
  backend, database daemon, or frontend framework.

## Current capabilities

- status-grouped, filterable Projects portfolio plus a focused Kanban backed by six persistent workflow states,
  reusable categories, deadlines, progress, health, streaks, weekly effort, and
  confirmed deletion that preserves historical analytics.
- First-class Tasks workspace with Inbox/project/tag scopes and Today and
  Next 7 days smart lists, priorities, tags, nested subtasks, completion
  progress, optional due dates, drag-and-drop ordering and nesting with keyboard
  and context-menu equivalents, grouping/sorting/density view options,
  click-through details with editable notes/title, a separate Completed scope,
  collapsed completed work in dated smart lists, 30-day recoverable Trash, and
  task controls in project details.
- Today view with recommendations and a real start/stop timer.
- Week, month, quarter, and year analytics derived from recorded work.
- Reading Kanban and full library with tags, queue ordering, date read,
  paginated Open Library search with exact ISBN lookup, local cover caching,
  and confirmed deletion.
- Workspace-scoped Codex tasks with streaming output, interruption, approvals,
  and user questions.
- Source-backed macOS Tauri development app plus browser mode.

## Privacy boundaries

The default live store is never read from or written to this Git repository:

```text
macOS    ~/Library/Application Support/LifeOS/lifeos.json
Windows  %APPDATA%/LifeOS/lifeos.json
Linux    $XDG_DATA_HOME/lifeos/lifeos.json
```

`LIFEOS_DATA_DIR` can override that location. The repository contains only the
deterministic demonstration data in `data/`; backups, locks, temporary files,
cached covers, environment files, and local Codex state are ignored.

LifeOS reads the signed-in Codex account and workspace tasks at runtime. It does
not copy Codex transcripts, prompts, approvals, account metadata, or
authentication material into the LifeOS store or repository. The selected task
ID stays in browser `localStorage`; the installed Codex application remains the
owner of Codex task history.

The server binds only to `127.0.0.1`. It has no remote-access authentication, so
that loopback boundary must be preserved. Book lookup sends a query to Open
Library only after an explicit search.

## Run locally

Requirements: Node.js 20 or newer. The Codex rail additionally requires the
Codex desktop app or CLI signed in with a ChatGPT account.

```bash
npm install
npm run dev
```

Open the printed loopback URL, normally `http://127.0.0.1:3000`. LifeOS chooses
a nearby free port when 3000 is occupied.

Useful CLI commands:

```bash
npm run lifeos -- projects --health
npm run lifeos -- tasks --project "Portia"
npm run lifeos -- tasks add --title "Draft Act III" --project "Portia" --due 2026-09-01
npm run lifeos -- tasks complete --task "Draft Act III"
npm run lifeos -- stats --range month
npm run lifeos -- recommend
npm run lifeos -- log --project "Vulcano" --duration 90 --type creative --desc "Edited sequence"
npm run lifeos -- session start --project "Portia" --type creative --desc "Draft Act III"
npm run lifeos -- session stop
npm run lifeos -- storage status
```

To regenerate the public-safe demonstration snapshot:

```bash
node scripts/create-demo-data.mjs
```

`npm run demo:reset` intentionally overwrites the live store. Do not use it
after entering real data.

## macOS development app

The Tauri shell is source-backed: it starts this repository's Node server in a
WKWebView and picks up normal source changes through **LifeOS Dev → Refresh
LifeOS** (`Command-R`). Rust 1.86 or newer is required to rebuild it.

```bash
npm run desktop:dev
npm run desktop:build
```

It is an ad-hoc-signed development shell, not a notarized or self-contained
distribution. Windows and Linux packaging are not yet implemented.

## Verify and contribute

```bash
npm run check
```

This runs JavaScript syntax checks, the Node test suite, and a Tauri compile
check. See [`AGENTS.md`](AGENTS.md) for repository invariants and
[`PROJECT_STATE.md`](PROJECT_STATE.md) for the architecture, data semantics,
maintenance workflows, and deliberately deferred work.
