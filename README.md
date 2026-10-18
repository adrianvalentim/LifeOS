# LifeOS

LifeOS is a local-first personal almanac for coordinating projects, tasks,
focused work, and reading. It is built to answer five practical questions:

1. Where is my time going?
2. What is the state of my projects?
3. What should I do next?
4. What concrete commitments are open, and how do they break down?
5. What am I reading now and next?

It combines an editorial interface, a portable JSON store, and one command
layer that people and agents share: everything you can do in the app, Codex,
Claude Code or any MCP client can do too — through MCP, a CLI, a JavaScript SDK
or local HTTP — and every change is journaled and undoable.

## What makes it different

- **Local-first by construction.** The live personal store sits in the
  operating system's application-data directory, outside the repository.
- **One source of truth.** Project health, recommendations, time allocation,
  streaks, and charts are derived from source records rather than maintained as
  separate display totals.
- **Agents with full parity.** 81 commands with schemas power the UI, the CLI,
  the SDK, local HTTP and a stdio MCP server, so agents never get a lesser API.
  They can also drive the open window and reshape it (views, sections, pins, theme).
- **Agents without another AI account.** The rail runs Codex through the
  installed `codex app-server` (ChatGPT account) and Claude Code through the
  installed `claude` CLI (Claude login) — no API keys, API SDK clients,
  alternate models, or per-request API billing. Their approvals always wait for
  you.
- **Every change is undoable.** Yours or an agent's: Activity shows who changed
  what, and ⌘Z, `lifeos undo` or the `history.undo` tool reverts it safely.
- **Transparent and recoverable.** Writes are validated, locked, atomically
  replaced, and backed by a local recovery copy. Optional Google Drive snapshots
  go only to one explicitly selected folder.
- **A deliberately small stack.** The main app uses Node.js and browser-native
  HTML, CSS, JavaScript, JSON, and Server-Sent Events. There is no hosted
  backend, database daemon, or frontend framework.

## Current capabilities

- An editorial interface in warm-paper light and ink dark themes: ⌘K command
  palette, natural-language quick capture (`Call the lab tomorrow 3pm !high
  #film @Vulcano`, English or Portuguese), keyboard navigation and multi-select,
  one consistent menu system, Undo toasts, and layouts down to phone width.

- [One-click Brave webpage capture](extensions/lifeos-capture/README.md), verified
  in Brave: save the current title and link to Web Articles with
  low priority and today's due date, using an on-demand macOS helper.
- Projects portfolio and board with six workflow states, plus project pages
  edited in place: next action, notes, domain, categories, priority, deadline,
  weekly plan, progress, tasks, sessions and eight-week history.
- Tasks with Inbox, Today, Upcoming, project, tag and saved-view lists, nested
  subtasks, priorities, tags, dates and estimates, drag to reorder/nest/move,
  bulk edits, a full detail sheet, Completed and 30-day Trash.
- Today: day ring, live focus timer, recommendation, today's tasks, an editable
  day log, week bars and what's coming up.
- Insights for week, month, quarter and year, with an editable time log.
- Almanac: year in numbers, challenge, streaks and a searchable milestone
  timeline.
- Creation board and Markdown editor; dated Shorts become tasks.
- Settings for appearance, the masthead, planning, domains, categories, saved views,
  agents and backups.
- Reading Kanban and full library with tags, queue ordering, date read,
  paginated Open Library search with exact ISBN lookup, local cover caching,
  and confirmed deletion.
- Agent rail with Codex and Claude Code side by side (streaming, tool steps,
  stop, approvals, questions, attached record context) and an Activity feed.
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

LifeOS reads the signed-in Codex and Claude Code accounts and conversations at
runtime. It does not copy transcripts, prompts, approvals, account metadata, or
authentication material into the LifeOS store or repository; Claude rail
conversations are indexed by ID and title beside the store, and the installed
applications remain the owners of their history. The change journal and
workspace settings live beside the store, outside Git.

The browser server binds only to `127.0.0.1`. It has no remote-access
authentication, so that loopback boundary must be preserved. Book lookup sends
a query to Open Library only after an explicit search.

A separate [task-only MCP proof](docs/tasks-mcp.md) uses the same local store,
requires authentication, and defaults to read-only on a separate loopback port.
An isolated synthetic-only Cloudflare Worker is deployed on the verified Free
account, with live HTTPS authentication-boundary checks passing. The final
private Worker and task database are deployed after direct approval. The owner
completed secure secret entry and connected the private LifeOS Tasks plugin
through GitHub public identity and OAuth. ChatGPT discovered all eight tools.
The [private task cloud implementation](docs/tasks-cloud.md) adds D1 revision
writes, a verified-backup cutover, a cloud CLI and an opt-in desktop/capture
adapter to the same task store. Guarded activation imported and verified all 37
existing tasks against a fresh full backup. Desktop and the installed capture
helper read the shared store; cached tasks remain readable offline and task
edits require connectivity. Live write tests used a separate fictional table.
Mercury successfully read the 37 real tasks directly in the main conversation,
without creating a Codex thread for the lookup.

## Run locally

Requirements: Node.js 22 or newer (including the Worker development tools).
The agent rail additionally uses the Codex desktop app or CLI signed in with a
ChatGPT account, and/or Claude Code signed in (`claude auth login`).

```bash
npm install
npm run dev
```

Open the printed loopback URL, normally `http://127.0.0.1:3000`. LifeOS chooses
a nearby free port when 3000 is occupied.

## Use LifeOS from agents and code

Connect any MCP client to the full command layer (it runs locally over stdio):

```bash
claude mcp add lifeos -- node "$PWD/scripts/lifeos-mcp.mjs"
codex mcp add lifeos -- node "$PWD/scripts/lifeos-mcp.mjs"
```

This folder's `.mcp.json` registers it automatically for agents started here.
From code, `import { createLifeOS } from './src/sdk.mjs'` gives the same
commands as JavaScript methods; `POST /api/run/<command>` exposes them over
loopback HTTP. Settings → Agents in the app lists every command and its schema.

Useful CLI commands:

```bash
npm run lifeos -- overview
npm run lifeos -- commands
npm run lifeos -- run tasks.create --title "Draft Act III" --projectId portia --dueDate 2026-09-01
npm run lifeos -- activity
npm run lifeos -- undo
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

This runs JavaScript syntax checks, the Node test suite, browser end-to-end
tests (Playwright with a pinned Chromium, downloaded on first use; run them
alone with `npm run test:e2e`), and a Tauri compile check. See
[`AGENTS.md`](AGENTS.md) for repository invariants and
[`PROJECT_STATE.md`](PROJECT_STATE.md) for the architecture, data semantics,
maintenance workflows, and deliberately deferred work.
