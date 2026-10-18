# LifeOS project state and maintainer handoff

> Canonical implementation handoff for agents and maintainers. Use
> [`AGENTS.md`](AGENTS.md) to select the sections relevant to the task; consult
> architecture and rationale before making a structural change.

- Last updated: 2026-10-18
- Implementation baseline: branch `claude/redesign` — the unified command layer
  (UI, CLI, SDK, HTTP, MCP), change journal with undo, workspace configuration,
  the rebuilt interface, and Claude Code beside Codex in the agent rail
- Remote: `adrianvalentim/LifeOS`, public, default branch `main`

## 1. Executive summary

LifeOS is a local, single-user personal almanac. It is meant to reduce the cost
of coordinating many concurrent projects and a personal reading queue by
answering five questions:

1. Where is my time going?
2. What is the state of my projects?
3. What should I do next?
4. What concrete commitments are open, and how do they break down?
5. What am I reading now and next?

The interface is the legibility layer. Agents are a first-class operating layer:
every capability the person has in the app is one named command that the UI,
CLI, JavaScript SDK, local HTTP and an MCP server all share, so Codex, Claude
Code or any MCP client can log work, plan, inspect state, rearrange the app, or
modify LifeOS itself — with every change journaled and undoable.

The current foundation is deliberately small:

- a dependency-free browser interface;
- a local Node.js server (Node 22+ including Worker development tools);
- one portable JSON personal store outside Git;
- one command registry (`src/commands/`) behind the UI, CLI, SDK, HTTP and a
  stdio MCP server, with a change journal for Activity and undo;
- bridges to the **installed** `codex app-server` (signed-in ChatGPT account)
  and the **installed** `claude` CLI (signed-in Claude login);
- a source-backed Tauri/WKWebView macOS development app;
- optional latest, daily, and monthly snapshots to one explicitly configured Google Drive folder.

There is no hosted backend, database daemon, AI API key, API SDK client, or
separate AI model. The server binds to loopback only. The development shell is
usable now without freezing the application: it starts the Node server directly
from this workspace, so normal browser assets remain refreshable. Self-contained
sidecar packaging, notarized distribution, and updates remain deferred.

## 2. Current state at a glance

| Area | State | What is true now |
| --- | --- | --- |
| Interface | Rebuilt (V2 Editorial in two inks, 2026-10) | Vanilla ES-module app (`public/app/`) with keyed DOM morphing, day/night/system editions, accent and density, a masthead with sections, pins and a live day strip, configurable start screen, ⌘K palette, natural-language quick capture, one menu system, keyboard map, Undo toasts, and responsive layouts down to phone width |
| Command layer and MCP | Implemented | 81 commands with zod schemas; `POST /api/run/<name>`, `lifeos run`, `createLifeOS()` SDK and `scripts/lifeos-mcp.mjs` expose the same surface; `ui.*` commands drive the open window |
| Activity and undo | Implemented | Journal of exact record patches per change (`lifeos.json.history.jsonl`) with actor/source, conflict-checked undo/redo in the app (⌘Z), CLI and MCP |
| Project dashboard | Implemented | Status-grouped list and three-column board with drag, project pages with in-place editing (name, subtitle, next action, note, domain, categories, priority, deadline, weekly plan, progress), creation, pins, focus timer, sessions and week history |
| Tasks | Implemented | Inbox, Today, Upcoming, project, tag and saved-view lists; Completed and 30-day Trash; nested subtasks; grouping/sorting; drag reorder/nest/move; keyboard navigation, multi-select and bulk edits; detail sheet with every field; natural-language capture |
| Web capture | Implemented and live-tested in Brave | Manifest V3 extension and on-demand native helper; captures are journaled like other writes |
| Today | Implemented | Day ring, live focus timer with editable project/type/description, recommendations, today's tasks, editable day log, week bars, attention, coming up, reading now and challenge |
| Insights | Implemented | Range KPIs, domains vs plan, composition, rhythm heatmap, project trends, categories, and an editable, filterable time log |
| Almanac | Implemented | Year in numbers, challenge set/edit/clear, streaks, searchable milestone timeline with add/edit/delete |
| Reading | Implemented | Cover-led shelf, sortable library, book sheet with tags/date read/edit, Open Library search and manual add |
| Creation | Implemented | Five-lane board and list, Markdown editor with split preview and auto-save, dated Shorts linked to tasks |
| Settings | Implemented | General, appearance, masthead, planning (daily plan, deep target, health thresholds, domains, weekly plan, categories), saved views, agents & MCP setup, data & backups, keyboard |
| Data source | Implemented, demo-derived | macOS Application Support contains the active copy; `data/lifeos.demo.json` remains deterministic |
| Persistence | Implemented | Validation, cross-process lock, atomic replacement, one local `.bak`, optional Google Drive snapshots, workspace sidecar and change journal beside the store |
| Agent rail | Implemented | Codex and Claude Code side by side: conversations, streaming, tool steps, stop, approvals and questions routed to the person, attached record context; Activity tab |
| Voice | Intentionally unavailable | No subscription-authenticated dictation path exists; no fallback is allowed |
| Native desktop app | Development shell implemented | `/Applications/LifeOS Dev.app` is source-backed and refreshes the workspace service in place; self-contained distribution is deferred |

The public repository does not record the current personal-store contents,
backup destination, Codex account, or Codex task history. Its deterministic
demo snapshot is the only publishable data baseline. Inspect the active store
locally when maintenance depends on its current state; do not copy that snapshot
into this handoff.

The directed Reading feature and focused Tasks release are now part of the
foundation. The next broad product step is still **not** generic feature
expansion. It is to safely move
from demo data to the user's real domains, projects, history, deadlines,
milestones, and weekly plan, then adjust the model based on what the real data
reveals.

## 3. Source-of-truth hierarchy

When documents disagree, use this order:

1. [`AGENTS.md`](AGENTS.md) for operating rules and invariants.
2. Current source and tests for actual behavior.
3. This file for architecture, state, rationale, and maintenance guidance.
4. [`README.md`](README.md) for the concise user-facing overview.
5. [`life-tracker-plan.md`](life-tracker-plan.md) for the implementation plan and
   deferred roadmap.
6. `design plan/` for visual references only.

Update this file when an architectural boundary, schema, completed/deferred
status, major workflow, or maintenance requirement changes. Do not turn it into
a chronological diary; keep it as a current-state handoff.

## 4. Architecture

```text
Browser or LifeOS Dev.app WKWebView at http://127.0.0.1:<port>
  |
  |-- POST /api/run/<command> + GET /api/state + Server-Sent Events
  v
scripts/dev-server.mjs
  |-- /api/run, /api/commands ----------> src/commands/ (registry, zod schemas)
  |                                           |-- journaled writes: operationContext -> mutateStore
  |                                           |                       -> lifeos.json.history.jsonl
  |                                           |-- workspace: lifeos.json.workspace.json
  |                                           `-- ui.*: SSE `ui` events to the open window
  |-- state/history routes -------------> src/lifeos-data.mjs, src/lifeos-history.mjs
  |                                           |-- validates and derives state
  |                                           `-- reads/writes platform Application Support/lifeos.json
  |-- book search -----------------------> src/book-catalog.mjs
  |                                           `-- explicit low-volume Open Library requests
  |
  |-- Codex routes ----------------------> src/codex-app-server.mjs
  |                                           `-- child process:
  |                                               installed codex app-server --stdio
  |-- Claude routes ---------------------> src/claude-code-agent.mjs
  |                                           `-- child process per conversation:
  |                                               installed claude -p (stream-json)
  |                                               + LifeOS MCP server
  |
  `-- static files ----------------------> public/ (index.html, app/, styles/)

cli/lifeos.mjs, src/sdk.mjs -------------> src/commands/ (same registry)
scripts/lifeos-mcp.mjs (stdio MCP) ------> src/commands/ (every command as a tool)

scripts/tasks-mcp-server.mjs (separate authenticated loopback MCP)
  `-- src/tasks-mcp*.mjs -> src/task-service.mjs -> src/lifeos-data.mjs

workers/tasks-demo/worker.mjs (separate synthetic-only HTTPS MCP proof)
  `-- Workers OAuth Provider + OAuth KV -> src/tasks-mcp.mjs -> demo-tasks.mjs
      (no personal store, task database, app assets, or Mac proxy)

filesystem change to the active Application Support lifeos.json
  `-- fs.watch -> SSE lifeos event -> browser refetches derived state

Codex app-server notification
  `-- local bridge -> SSE codex event -> browser updates the rail

LifeOS Dev.app
  `-- resolves this workspace and installed Node
      `-- starts scripts/dev-server.mjs with PORT=0, loads its printed URL,
          refreshes it in place from LifeOS Dev > Refresh LifeOS,
          and sends SIGTERM on app exit

successful supported write
  `-- optional explicit Google Drive folder
      |-- latest.json
      |-- daily/YYYY-MM-DD.json
      `-- monthly/YYYY-MM.json
```

There are four important boundaries:

1. **Persisted facts** live in the platform Application Support `lifeos.json`.
2. **Derived state** is recalculated by `src/lifeos-data.mjs`; the browser does
   not own dashboard totals.
3. **Data operations** go through named commands (UI, CLI, SDK, HTTP or MCP);
   every write is journaled with its source and actor and can be undone.
4. **AI transport** is only the installed, signed-in Codex app-server and
   Claude Code CLI. The browser never talks to an AI service directly.

Do not open `public/index.html` with a `file://` URL for normal use. The page
depends on `/api/...` routes, SSE, root-relative assets, and the agent bridges.
Run `npm run dev` and use the printed loopback URL.

## 5. Repository map

| Path | Responsibility |
| --- | --- |
| `AGENTS.md` | Compact instructions every incoming Codex agent should follow |
| `PROJECT_STATE.md` | This detailed architecture and maintenance handoff |
| `README.md` | Concise product and usage documentation |
| `package.json` and `package-lock.json` | Node version, Tauri development CLI, and verification/build commands |
| `data/lifeos.json` | Legacy demo-derived seed used only for safe first-run migration; not active personal data |
| `data/lifeos.demo.json` | Deterministic public-safe demonstration snapshot; never replace it with private data |
| `src/lifeos-data.mjs` | Schema checks, date helpers, writes, logs, timer, task hierarchy/operations, calculations, health, and recommendations |
| `src/lifeos-storage.mjs` | Platform paths, first-run migration, Drive discovery/configuration, snapshot writing, and backup status |
| `src/book-catalog.mjs` | Paginated Open Library search, exact ISBN detection, normalized metadata and covers, and best-effort work-detail enrichment |
| `src/book-cover-cache.mjs` | Bounded medium-size local cover caching for saved Open Library books |
| `src/commands/` | The command registry: one zod-validated command per capability (core, tasks, projects, time, reading, creation, planning, workspace, history, ui) |
| `src/lifeos-history.mjs` | Change journal: patch diffing, append/coalesce/compaction, conflict-checked revert |
| `src/lifeos-manage.mjs` | Project, time-entry, domain, category, settings, milestone, challenge and book-detail management operations |
| `src/lifeos-workspace.mjs` | Workspace sidecar: start screen, theme, density, section order, saved views, pins |
| `src/sdk.mjs` | `createLifeOS()` — the command layer as a JavaScript API (in-process or against the running app) |
| `scripts/lifeos-mcp.mjs` and `.mcp.json` | Full stdio MCP server (every command as a tool) and its project registration |
| `src/codex-app-server.mjs` | JSON-RPC bridge to the installed Codex executable |
| `src/claude-code-agent.mjs` | Bridge to the installed `claude` CLI (stream-json control protocol), translated to the Codex item shapes |
| `cli/lifeos.mjs` | Operational interface for humans and agents: `run`, `commands`, `describe`, `overview`, `activity`, `undo`, plus focused verbs |
| `scripts/dev-server.mjs` | Local static server, command/state/history routes, SSE, file watcher, agent relays and UI channel |
| `scripts/check-syntax.mjs` | Syntax-checks every shipped JavaScript file for `npm run check` |
| `extensions/lifeos-capture/` | Unpacked Brave extension, fixed public identity, popup/worker/icons, and installation guide |
| `scripts/capture-native-host.mjs` and `scripts/install-capture-host.mjs` | One-message native capture bridge and local macOS release installation with Brave registration |
| `public/web-links.js` and `src/task-web-links.mjs` | Safe links derived from task notes and desktop opening of an exact saved HTTP(S) URL |
| `scripts/desktop.mjs` | Cross-platform Tauri command wrapper and APFS cache target selection for macOS builds |
| `scripts/create-demo-data.mjs` | Deterministically generates demo data; can intentionally reset the active store |
| `public/index.html` | Minimal entry: fonts, `public/styles/*.css`, `public/app/main.js` |
| `public/app/main.js` | Shell (masthead with sections and day strip, contents page, sheet, rail), delegated events, keyboard map, SSE handlers, presence |
| `public/app/{store,api,router,dom,actions,menus,commands-ui,task-model,nlp,format,icons,agent-context,rail}.js` | Client state and batched rendering, command calls with optimistic updates/rollback, path routing, templates and DOM morphing, user intents, menus, palette actions and shortcuts, task scopes/grouping, capture parsing, formatting, icons, record context for agents, and the agent/Activity rail |
| `public/app/ui/` | Menu, dialog, pickers (date/priority/project/tags), capture, palette, toast and pointer drag-and-drop primitives |
| `public/app/components/` and `public/app/screens/` | Task list/sheet components and the Today, Tasks, Projects, Creation, Reading, Insights, Almanac and Settings screens |
| `public/styles/` | Design tokens and themes (`base.css`), shell, components and screens |
| `public/fonts/` | Self-hosted Newsreader, IBM Plex Sans and JetBrains Mono (OFL) |
| `src/creation-markdown.mjs` and `scripts/build-creation-markdown.mjs` | Local sanitized Markdown preview entry and reproducible browser bundle |
| `tests/creation.test.mjs` | Idea migration, validation, conflicts, scheduling/Trash, cloud/offline atomicity and UI projection tests |
| `tests/commands.test.mjs` | Command layer, journal/undo/redo, workspace, views, validation and MCP |
| `tests/ui.test.mjs` and `tests/ui-harness.mjs` | Interface rendered in Node from derived state: scopes, grouping, drop targets, rows, sheets, screens, context, capture parsing, escaping, optimistic updates |
| `tests/claude-code-agent.test.mjs` | Claude bridge against a protocol-faithful fake CLI: streaming, approvals, decline, transcript reload |
| `tests/lifeos-data.test.mjs` | Data derivation, range, write safety, project matching, timer, and timezone tests |
| `tests/lifeos-storage.test.mjs` | Platform data paths, Google Drive root discovery, and versioned snapshot tests |
| `tests/book-catalog.test.mjs` | Open Library normalization, pagination, exact ISBN lookup, enrichment, and offline-fallback tests |
| `tests/codex-app-server.test.mjs` | Executable discovery, approval relay, and voice-boundary tests |
| `life-tracker-plan.md` | Original implementation choice and ordered next phase |
| `src-tauri/` | Source-backed Tauri shell, Cargo lock/config, bundle settings, and macOS icon assets |
| `design plan/` | Original V1/V2/V3 explorations; preserve unless the user explicitly asks to change them |

macOS metadata files beginning with `._` exist under the design references. They
are not runtime dependencies.

## 6. Starting and stopping the system

Requirements:

- Node.js 22 or newer (required by Wrangler/workerd development tooling);
- the Codex desktop app or Codex CLI installed and signed in with a ChatGPT
  account for the rail;
- `npm install` once for the pinned Tauri CLI development dependency;
- Rust 1.86 or newer to rebuild the desktop shell. Cargo is configured to select
  dependencies compatible with the installed compiler.

Normal macOS use:

```bash
open "/Applications/LifeOS Dev.app"
```

Desktop development and rebuild:

```bash
npm run desktop:dev
npm run desktop:build
```

`scripts/desktop.mjs` places Cargo build products in
`/Volumes/sisyphus/Library/Caches/LifeOS/cargo-target` on macOS, falling back to
`~/Library/Caches/LifeOS/cargo-target` when sisyphus isn't mounted (`CARGO_TARGET_DIR`
overrides both). The repository is on an external
volume that produces `._*` AppleDouble metadata; keeping build-script permission
files on APFS prevents Tauri from attempting to parse those sidecars. Sisyphus is
APFS and keeps the build off the small internal disk. The built
app is ad-hoc signed and the current bundle is about 8.1 MB.

Browser-only start:

Start:

```bash
npm run dev
```

The server tries `PORT` or port 3000, then increments through nearby ports when
one is occupied. It binds to `127.0.0.1`, prints the actual URL, serves assets
with `cache-control: no-store`, watches the data directory, and does not start
an agent child process until the rail requests that agent's bootstrap data.

At browser startup:

1. The server injects the workspace theme and density into `index.html`, so the
   first paint already has the right colors.
2. `public/app/main.js` fetches `/api/state` (derived state, workspace, store
   mtime) and routes from the path; with no section it opens the workspace's
   start screen (Projects by default).
3. It opens `/api/events` for data, journal, workspace, UI-control and agent
   events.
4. The rail bootstraps the selected agent asynchronously (`/api/codex/bootstrap`
   or `/api/claude/bootstrap`), so an agent failure never blocks the app, and
   reopens that agent's last LifeOS conversation from `localStorage`.

`SIGINT` and `SIGTERM` close data watchers and event streams, stop the Codex
and Claude child processes, and shut down the HTTP server.

The Tauri shell resolves `LIFEOS_WORKSPACE` or its compile-time repository path,
finds `LIFEOS_NODE` or a standard absolute Node installation, starts the server
with an OS-assigned loopback port, waits for the printed ready URL, and opens it
in WKWebView. Quitting the app sends `SIGTERM` and waits briefly before a forced
fallback. **LifeOS Dev → Refresh LifeOS** (`Command-R`) starts the updated server
first, navigates the existing window to its new loopback port while preserving
the current path and query, and then stops the preceding child. A failed startup
leaves the existing server and window intact. Concurrent refresh requests are
coalesced. The shell does not bundle Node or copy the browser application.

### Brave webpage capture

Run `npm run capture:install` on macOS, then load
`~/Library/Application Support/LifeOS/browser-capture/extensions/lifeos-capture`
unpacked in Brave. The installer copies an explicit helper runtime and the
extension into Application Support without personal data or development packages.
The small extension uses only `activeTab`
and `nativeMessaging`. Its popup starts saving immediately; a service worker owns
the write so closing the popup does not cancel it. No hosted service, API key,
page scraping, content script, broad host permission, or polling is involved.
The popup shows status, page title, source link and Open LifeOS; metadata chips
and routine explanatory text are omitted. Real errors and backup warnings remain.

Brave launches `scripts/capture-native-host.mjs` through a per-user, executable
launcher for each capture, then the helper exits. Its native host registration
uses `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` because
Brave overrides macOS helper discovery to Chrome's locations; registering under
Brave's profile directory fails. It allows only the extension's fixed ID. The
launcher pins the installed runtime and configured data directory using absolute,
shell-quoted paths. Rerun the installer after source updates or a data-directory
move, then reload the extension. Capture needs Node and the local store, but not
Atlas, the desktop app's dynamic HTTP port, or an open app window. Open LifeOS
still launches the source-backed desktop app, which needs its workspace.

`captureWebPage` creates the task and an exact-named Web Articles project in one
locked transaction, using the common task constructor. Existing domains are
reused (learning, research, personal, general, then the first configured domain).
No schema change is needed: the full URL stays in ordinary task Notes. Priority
is low, tags are empty, and due date uses `meta.timezone`. An exact URL match in
non-trashed task notes returns the existing task, preserving edits and completion;
Trash allows a fresh capture. Removing that URL removes the duplicate identity.
HTTP(S) is required and embedded credentials are rejected.

Task details derive clickable links from saved notes. Browser sessions use normal
anchors. The macOS shell routes these clicks through a same-origin-only
`POST /api/tasks/open-link`; the server verifies the exact URL still belongs to
the non-trashed task before opening it in the system browser. This is necessary
because the existing WKWebView does not handle new-window links. Backup exceptions
after a successful local transaction are reported as warnings, including an
invalid backup configuration. Native captures bound optional backup I/O to two
seconds and report a local-save success plus a backup warning on timeout. Optional
snapshot work runs in a short-lived child that is terminated at the deadline, so
blocked cloud filesystem calls cannot leave the capture helper running. The local
store and recovery copy are complete before that child starts. Timed-out cloud
work may be incomplete.
Ordinary app and CLI writes retain their existing backup behavior.

See [the installation guide](extensions/lifeos-capture/README.md). Native protocol,
data integrity, duplicate, failure, and rendered popup/task checks use isolated
fixtures. A real Brave toolbar capture and duplicate retry are now verified after
the user loaded the extension. The installed runtime also passes framed ping and
capture tests in an isolated directory. Loading the new Application Support
extension folder and verifying persistence across a full Brave restart remain
manual steps; the browser-control policy still blocks the extension manager.

## 7. Persisted data model

The active store is a single JSON object. `schemaVersion` is currently 11, with
explicit compatibility migrations from versions 2 through 10; there is no
general migration framework yet.

### `meta`

Persisted display and calendar configuration:

- `schemaVersion`: current shape marker; not yet enforced by validation;
- `appName`, `tagline`: masthead copy;
- `timezone`: required IANA timezone used for calendar dates and local times;
- `activeTab`: default browser tab;
- `demo`, `demoGeneratedFor`: identify seeded data.

`today`, `now`, ISO `weekNumber`, and day-of-year `issueNumber` are added only to
the derived response. They are not source facts.

### `domains`

An object keyed by stable domain ID. Each current domain has:

- `label` for full display;
- `short` for compact display metadata;
- `color` for charts and cards.

Every project must reference a defined domain. Domain allocations are computed
from project-bound entries and preserved category-only history that retains its
former domain; general/inbox entries contribute to overall time and composition
but not to a domain total.

### `categories`

An object keyed by stable category ID. Each category has a display `label`.
Unlike domains, categories overlap: multiple projects can share one category and
a project can reference multiple categories. Category totals therefore are not
assumed to add up to total tracked time.

### `settings`

- `deepTarget`: desired proportion of deep-classified time;
- `defaultDailyPlanHours`: Today-plan denominator;
- `weeklyPlanByDomain`: required weekly hours by domain;
- `health.criticalInactiveDays` and `health.attentionInactiveDays`: inactivity
  thresholds.

Range plans are scaled from the weekly domain plan by the number of calendar
days in the selected full week, month, quarter, or year.

### `projects[]`

Required by the current validator:

- unique `id`;
- `name`;
- valid `domain`;
- a `categoryIds` array containing only defined reusable category IDs.

Fields used by the current application:

- `subtitle` and `note`;
- `status`, one of `to_do`, `next_up`, `doing`, `paused`, `done`, or `dropped`;
  the first three count toward active/critical summaries and recommendations.
  `paused` means intentionally on hold and is not an archive or a dropped project;
- numeric `priority`;
- `plannedHours` for the current week;
- `deadline` as `YYYY-MM-DD` or `null`;
- `progress` as a 0–1 fraction or `null`;
- `createdAt`;
- optional `statusChangedAt`, updated by supported status moves;
- optional `nextAction`, which overrides generated recommendation wording.

Health, risk, last touch, weekly hours, due days, streak, and eight-week history
are derived. Do not persist them as parallel display fields.

### `tasks.items[]`

Schema version 7 added one shared task collection; version 8 adds persisted task
notes; version 9 adds priority and tags; version 10 adds recoverable task Trash
through `trashedAt`. Tasks are independent records,
not embedded inside projects, so Inbox tasks and project tasks use the same
operations and can be reassigned without copying data. Every task requires:

- a unique `id`, non-empty `title` of at most 300 characters, and `notes` string
  of at most 20,000 characters;
- `projectId`, either `null` for Inbox or one existing project ID;
- `parentTaskId`, either `null` for a root or one existing task ID;
- `status`, either `open` or `completed`;
- `priority`, one of `none`, `low`, `medium`, or `high`;
- a `tags` array of at most 12 free-form labels of at most 40 characters,
  normalized and deduplicated case-insensitively like reading tags;
- finite `sortOrder` among siblings;
- valid `createdAt` and `updatedAt` timestamps;
- `completedAt`, required for completed tasks and `null` for open tasks;
- `trashedAt`, either the timestamp at which its subtree entered Trash or `null`;
- a `schedule` object with `dueDate`, `startTime`, `durationMinutes`, and
  `recurrence`.

The first release exposes optional `dueDate` (`YYYY-MM-DD`) but already validates
the complete schedule envelope. `startTime` is `HH:MM` or `null` and requires a
due date; `durationMinutes` is a positive whole number or `null`; `recurrence`
must remain `null` until a later schema revision defines recurrence semantics.
The envelope avoids a disruptive task-shape rewrite when time-blocking is added.

A subtask must share its parent's project. Project reassignment is therefore
allowed only on a root and cascades to every descendant. Completing a parent
completes all non-trashed descendants; reopening affects only the selected task.
Adding or restoring open work beneath completed work reopens its completed
ancestors but preserves the status of existing completed siblings. Completing a
task moves it out of all active scopes and into Completed without changing its
identity or hierarchy. Deleting a task timestamps that task and all descendants
into recoverable Trash; restoring clears those timestamps, while explicit
permanent deletion and the 30-day cleanup remove the subtree. Deleting a child
leaves its parent and siblings intact. Project deletion detaches its task tree to
Inbox instead of deleting it.

`sortOrder` is the manual order among siblings. `reorderTask` renumbers one
sibling set from 1 and can re-parent in the same call, which carries the whole
subtree into the new parent's project; it rejects nesting a task under itself or
under one of its own descendants. Manual order is deliberately independent of
status: the display comparator sorts completed work last, so reopening a task
must not shuffle it. `duplicateTask` copies a task and its subtree with fresh
IDs directly after the original.

Priority, tags, and due date are the labels the Tasks workspace groups, sorts,
and filters on. They are stored on each task; grouping, sorting, smart-list
membership, and tag counts are all derived in the browser from those fields plus
`meta.today`. Never persist a group, a smart-list membership, or a tag index.

`depth`, `childIds`, subtree counts/progress, global counts, Inbox counts, and
per-project task summaries are all derived in `buildState`. Never persist those
values or a second project task list. Hierarchy validation rejects missing
parents, cross-project parentage, self-parentage, and cycles.

### `reading.books[]`

Schema version 3 added one shared reading collection; schema version 4 adds
persistent tags. Every book requires:

- a unique local `id`;
- `title` and an `authors` array;
- `status`, one of `to_read`, `next_up`, `reading`, `finished`, or `dropped`;
- finite `sortOrder` within its current status;
- a `tags` array of free-form labels, normalized and deduplicated
  case-insensitively.

Imported catalog snapshots can also contain subtitle, description, the original cover URL,
ISBN-10/13, publisher, publication year, language, page count, subjects, and an
Open Library source record. LifeOS stores only explicitly selected results.
Search result sets are ephemeral and never enter the portable store.

`addedAt`, `statusChangedAt`, and `updatedAt` preserve local workflow history.
Moving into reading, finished, or dropped records the corresponding first
`startedAt`, `finishedAt`, or `droppedAt` timestamp. A finished book's
`finishedAt` date can then be corrected from the Library or book details for
historical reads; future dates are rejected. Status counts are derived in
`buildState`; they are not persisted display totals.

The Kanban is intentionally a projection of `next_up`, `reading`, and
`finished`, with Finished limited to books whose configured-timezone date read
falls in the current calendar year. The complete Library view is the only
surface that shows all five statuses and the all-time finished collection, and
can filter by tag. Both views mutate the same record through narrow local
routes. Permanent deletion removes exactly one local book by ID after a named
browser confirmation and removes its deterministic cached cover.

### `creation.ideas[]`

Schema version 11 adds a local idea collection; older stores migrate to an empty
`creation.ideas` without changing existing records. Each idea has a unique `id`,
`title` (1–300 characters), `markdown` (up to 200,000 characters), `type` (1–40
characters), `status`, nullable calendar `date`, finite `sortOrder`, `createdAt`,
`updatedAt`, and nullable `taskId`. States are `to_do`, `next_up`, `doing`, `done`,
and `dropped`. Built-in types are `short` and `long_video`; custom type labels
are supported. All counts, filters and sorts derive from the idea collection.

A dated Short outside Dropped creates one Inbox task, tagged Creation and Shorts,
inside the same locked transaction. The idea holds the link; scripts and Markdown
never enter task notes or cloud task documents. Later title/date changes update
that task while retaining notes, priority, tags, project and subtree identity.
Moving an idea to Done completes its non-trashed task subtree; leaving Done reopens
only its linked task. Removing the date, changing away from Short, or dropping the
idea moves the linked subtree to recoverable Trash. Re-scheduling restores the
same task/subtree, restoring trashed ancestors and reopening completed ancestors
as required by the task contract. Ordinary body edits do not rewrite task fields
or restore a task manually put in Trash. Edits made directly in Tasks do not
change the source idea; Creation metadata changes flow toward the linked task.
A stale link after task purging is allowed and replaced on a later scheduling edit.

Idea edits require `expectedUpdatedAt`; stale editors retain their draft and must
reload before overwriting a newer save. Browser-created IDs make create retries
idempotent. Task-affecting changes use the existing online coordinator when cloud
authority is active: an offline failure leaves both records unchanged. Markdown
edits remain local and can save offline unless a pending cloud transaction blocks
all local writes. Creation currently has browser/HTTP operations; no CLI command
or idea deletion endpoint is exposed.

### `timeEntries[]`

Required by validation:

- unique `id`;
- `date`;
- finite `durationMinutes`;
- a valid `activityType`;
- an existing `projectId` when one is present;
- a `categoryIds` array. Project-bound entries inherit the project's current
  categories for analytics; category-only entries retain explicit IDs;
- optional `domain` only for preserved category-only history from a deleted
  project, so domain allocation remains intact.

Normal entries also carry:

- `time` (`HH:MM`) or `null`;
- `description`;
- `rawInput` preserving the user's original language;
- `captureSource` such as `cli`, `codex_cli`, `lifeos_timer`, `demo_seed`, or
  `demo_import`;
- `createdAt`.

Allowed activity types are:

```text
deep_work
shallow_work
admin
research
creative
communication
```

The demo also contains weekly imported aggregates marked with
`aggregation: "weekly"`. Aggregates participate in period totals and project
history. They are excluded from Today, the hourly heatmap, streaks, and challenge
session counts. Preserve this distinction when importing summarized history to
avoid double-counting it alongside granular sessions.

### `activeSession`

Either `null` or one running timer containing:

- generated `id`;
- optional `projectId`;
- a `categoryIds` array;
- optional `domain`, used only when project deletion detaches a running session
  while retaining its future domain allocation;
- `activityType`;
- `description` and `rawInput`;
- `startedAt`.

Stopping computes elapsed whole minutes (minimum one), creates exactly one time
entry dated and timed at the session start, and clears the session. A session
crossing midnight is not split across dates in the current implementation.

### `challenge`

Optional current challenge with project, date range, target count, minimum
duration, and allowed activity types. Progress is the count of qualifying
non-aggregate entries, capped at the target. `daysLeft` is derived.

### `milestones[]`

Currently simple `{ date, text }` records. They are sorted newest-first in the
derived state and displayed read-only in Almanac.

### Validation limits

Validation intentionally catches broken references and the most dangerous shape
errors, but it is not a complete JSON Schema. It validates project, task, and
reading statuses; task identifiers, hierarchy, project references, notes,
priority, tags, schedule, and timestamps; and reading identifiers, ordering,
tags, and any `finishedAt` timestamp. It still does not enforce every optional project/entry field, ISO
date formatting for all older record types, positive time-entry durations in
files edited by hand, or project progress bounds.
`createTimeEntry` does enforce positive duration for supported write paths.

Reads migrate schema version 2 stores in memory by adding an empty Reading
collection, migrate version 3 books by adding empty tag arrays, migrate legacy
project statuses into the original five-state workflow, migrate version 5 by adding the
category registry and category reference arrays, migrate version 6 by adding
`tasks: { items: [] }`, migrate version 7 tasks by adding empty note strings,
and migrate version 8 tasks by adding `priority: 'none'` and empty tag arrays.
Schema version 9 safely expands the accepted project workflow with `paused`,
and version 10 adds `trashedAt: null` to every existing task
without rewriting any existing status. Existing user data therefore gains the
task collection, notes, priority, tags, and recoverable Trash without rewriting projects or
reading records. The migrated
shape is persisted on the next supported write. Any
further schema evolution must likewise add
validation and migration/compatibility behavior; incrementing `schemaVersion`
alone is insufficient.

## 8. Derived calculations

All visible totals must remain functions of persisted records and settings.

### Calendar and ranges

- Dates use `meta.timezone`, not the machine's implicit timezone.
- Weeks run Monday through Sunday.
- Month, quarter, and year ranges cover the full containing calendar period,
  including future dates in that period.
- Period filtering compares `YYYY-MM-DD` strings inclusively.

### Project hydration and health

For every project, LifeOS derives current-week hours, most recent touch, elapsed
days since touch, deadline distance, streak, and eight weekly totals.

Health is currently rule-based:

- **critical** when a project is due within three days with progress below 50%,
  or it has exceeded the configured critical inactivity threshold;
- **attention** when it has exceeded the attention inactivity threshold, or it
  has logged less than half of its weekly plan;
- **healthy** otherwise.

A project with no entries is treated as highly inactive. Health sorting is
critical, then attention, then healthy; ties use priority and name.

Each hydrated project also receives one `taskSummary` computed from all non-trashed
task records currently associated with that project. It contains total, open,
completed, and progress values and is the source for project cards and details.

State construction indexes project-entry metrics and per-project task counts in
single passes. Keep that linear scaling when extending derived state; do not
reintroduce a full entry or task scan for every project.

### Task hierarchy and progress

`hydrateTasks` builds a parent-to-children index, orders open siblings before
completed siblings and then by `sortOrder`, and returns a pre-order flat list for
compact transport. Each task receives its depth, direct child IDs/count, active
and all-record subtree totals, trash-subtree total, completed count, and progress
fraction. A progress subtree excludes trashed records: two completed subtasks
beneath an open parent are 2/3 complete until the parent itself is completed,
while moving one of those subtasks to Trash makes the remaining active subtree
1/2 complete. Global, Inbox, and project summaries likewise exclude Trash; the
browser never recalculates a competing persisted total. Expired Trash is hidden
from derived state and physically pruned at server startup, hourly while the app
runs, or on the explicit cleanup operation.

### Recommendations

Only active projects are ranked. The risk score combines:

- project priority;
- health state;
- inactivity, capped in its contribution;
- urgency of the deadline;
- weekly planned-hours gap.

The recommendation duration is currently 90 minutes for a critical priority-5
project, 45 minutes for a healthy project, and 60 minutes otherwise. Confidence
is a bounded presentation of the rule score, not a learned probability. The UI
can rotate through the ranked list, dismiss it for the current page visit,
restore it, or begin a real timer.

### Time composition

Range analytics also derives overlapping category hours from the union of each
entry's explicit `categoryIds` and its current project's category membership.
This preserves category-only history after exact project deletion without
double-counting the same entry within one category.

- Deep: `deep_work`, `research`, and `creative`.
- Shallow: `shallow_work` and `communication`.
- Admin: `admin`.

The deep ratio uses all minutes in those classes. The separate monthly/yearly
deep-work counter includes only deep-classified entries of at least 45 minutes.

Production/consumption is another opinionated view:

- production: `creative`, `deep_work`, and `communication`;
- consumption: `research`;
- support: everything else.

Production and consumption percentages exclude support time from their
denominator.

### Heatmap, trends, and streaks

- The rhythm heatmap distributes each granular timed entry minute-by-minute
  across 24 hourly cells for the last 14 days, then normalizes to the busiest
  cell.
- Project trends show eight Monday-based weekly totals and include historical
  aggregates.
- A project streak counts consecutive calendar days with at least 30 granular
  minutes. If today has not reached 30 minutes, counting begins yesterday.

## 9. Persistence and recovery

### Active personal-data path

The default active store is outside the repository:

- macOS: `~/Library/Application Support/LifeOS/lifeos.json`;
- Windows: `%APPDATA%/LifeOS/lifeos.json`;
- Linux: `$XDG_DATA_HOME/lifeos/lifeos.json` or `~/.local/share/lifeos/lifeos.json`;
- override: `LIFEOS_DATA_DIR`.

On first default-store access, LifeOS creates the platform directory with
restricted permissions and copies `data/lifeos.json` when that legacy seed
exists, otherwise `data/lifeos.demo.json`. The current macOS personal copy was
verified byte-for-byte against the legacy demo-derived store at migration and
has mode `0600`. Tests and explicit custom paths are never auto-seeded.

Supported writes use `mutateStore`:

1. Acquire the active store's `.lock` with exclusive creation.
2. Retry for up to five seconds.
3. Remove a lock older than 30 seconds as stale.
4. Read and validate the latest store while holding the lock.
5. Apply the mutation.
6. Validate the complete result.
7. Copy the preceding store to the adjacent `.bak` recovery file.
8. Write formatted JSON to a mode-0600 temporary file.
9. Rename it over the active store, with a Windows-compatible fallback.
10. Remove the temporary file and release the lock.
11. If one explicit cloud folder is configured, update `latest.json`, the
    current daily snapshot, and the current monthly snapshot.

This protects the normal single-user app from overlapping CLI/server writes and
partially written JSON. A cloud failure is recorded and warned but never turns a
successful local mutation into a failed or rolled-back save. Google Drive is a
secondary snapshot destination, not the live store or a multi-device merge
engine.

Recovery procedure:

1. Stop LifeOS so no writer is active.
2. Inspect both the Application Support `lifeos.json` and `lifeos.json.bak`.
3. Validate that the backup is the desired snapshot.
4. Copy it back deliberately; do not treat `.bak` as an ongoing source.
5. Run `npm run check` and a CLI read command before continuing.

Backup, lock, and temporary files are ignored by Git and must never be committed.

### Google Drive snapshots

`src/lifeos-storage.mjs` discovers installed macOS Drive roots but never chooses
between accounts. `storage configure-backup --path` must name one exact folder;
it validates the destination by writing a complete snapshot before saving the
mode-0600 local configuration. Account-specific paths and current backup status
are local operational state and must not be recorded in repository documents.

Each backup set contains:

- `latest.json`, overwritten after each successful supported mutation;
- `daily/YYYY-MM-DD.json`, the latest valid state for that configured timezone day;
- `monthly/YYYY-MM.json`, the latest valid state for that month.

`backup-status.json` records the latest success or error beside the active store.
Disabling backup clears only the local destination setting and preserves all
existing snapshots. No Google API, OAuth token, plugin, hosted database, or
additional subscription is involved; Drive for desktop syncs ordinary files.

Direct manual edits do not acquire the lock. Prefer the CLI. If a bulk import
must edit JSON, stop the server or use the data module's mutation path, validate
the entire result, and retain an out-of-repository backup first.

## 10. Command layer, local HTTP and events

The separate task-only MCP server is documented in
[`docs/tasks-mcp.md`](docs/tasks-mcp.md). `npm run mcp:tasks` requires a private
out-of-workspace authentication file and an existing store. It defaults to
read-only, binds to `127.0.0.1:3010`, and serves stateless Streamable HTTP at
`/mcp`. It exposes list/search/get plus optionally create/edit/complete/Trash/
restore, never permanent deletion, `/api/state`, or the Codex rail. Reads use
`readStore(..., { initialize: false })`; multi-field `editTask` uses one locked
transaction with optional `ifUpdatedAt` concurrency protection. OAuth resource
metadata and JWT/owner/scope verification prepare approved HTTPS forwarding;
no real-task remote deployment, task access grant, plugin installation, or
migration has occurred. The existing local JSON remains the task authority.

`workers/tasks-demo/` implements the deployed Cloudflare Free demo with three
compile-time synthetic tasks and only list/search/get. It uses current Workers
OAuth Provider 1.x, CIMD public clients, S256 PKCE, browser-bound consent/state,
canonical resource audiences, an exact numeric GitHub-owner allowlist and
per-request `tasks:read` checks. GitHub is used for public identity only;
upstream tokens are not stored. MCP access lasts one hour, with no refresh
tokens or remembered consent. It has no D1 binding, assets or connection to the
Mac. Wrangler dry-run and mocked workerd OAuth/MCP tests pass. Existing-account
Cloudflare sign-in and Workers Free were verified. Direct owner approval enabled
Wrangler's account/user read, Workers scripts/KV write and offline grant;
`whoami` verified encrypted credential storage with its key in macOS Keychain.
Separate direct approval enabled creation of one isolated OAuth KV namespace
and deployment of only the synthetic Worker. All 13 live HTTPS boundary checks
passed: metadata advertises the canonical resource, CIMD and S256; missing/invalid
tokens, hostile Origin, queries, methods, oversized bodies and unrelated routes
are rejected. Demo owner sign-in remains unconfigured (503). The final private
setup has since been directly approved, as described below. The synthetic
Worker remains unlinked; private acceptance is described below. Actual
destination/configuration and verification evidence remain outside Git. See the
runbook for exact access needs.

The owner subsequently approved private task storage and full editing. The
final implementation in `workers/tasks/` uses the shared OAuth boundary
`src/tasks-worker.mjs` and a private D1 task-only JSON row with a revision.
`src/cloud-task-service.mjs` implements primary reads and conditional revision
writes/retries, retaining IDs/content and subtree lifecycle semantics. A full
byte-identical local backup and task-only staged artifact were verified outside
Git. Direct typed approval covered exact
Wrangler `d1:write`, a dedicated GitHub public-identity app, the final ChatGPT
read/write/renewable grant and online task edits/cached reads. The exact six
Wrangler scopes were verified, the private D1 database was created, and
the private Worker deployed on Free. The GitHub app is registered with the
exact HTTPS callback and public client ID configured. The user generated and
submitted the secret directly, completed owner OAuth and connected the private
LifeOS Tasks plugin. ChatGPT discovered all eight authenticated tools. A fresh
full backup preceded guarded import and activation of all 37 existing tasks.
Post-activation reads verified every task field and unrelated local records
unchanged. The first direct Mercury call preceded activation and returned an
uninitialized-store error. Its direct retry after activation succeeded in the
main conversation, returning 37 real tasks at revision 2. Routine task reads
can now use the installed plugin without a Codex thread. Mercury also created,
read, edited with `ifUpdatedAt`, verified and moved one clearly labeled temporary
task to recoverable Trash, reaching revision 5. Original task content was not
edited. Keep that temporary task recoverable; do not permanently purge it.
Read-only follow-up verified the installed native helper and desktop projection
matched revision 5, with the test task retained in Trash, all 37 originals
unchanged, unrelated records preserved and no pending recovery journal.
All 13 private live HTTPS boundary checks passed, with no public task data.
Skip linking the read-only demo plugin.

`npm run tasks:cloud` supplies private backup/fence/import/activation and cloud
task operations through the existing encrypted Wrangler credentials. The
archive-only cutover was rejected because it would pause desktop editing and
capture. Its replacement is the opt-in `src/task-online.mjs` adapter at the
shared store boundary: desktop/CLI/capture keep their existing task actions
against the same cloud authority as Mercury, with atomic local projections and
backups. Cached reads remain available offline; task edits/capture require
internet. Unrelated local records remain local and writable offline, except
while an interrupted cloud transaction needs recovery. Revision/stale checks
prevent overwrite, and a private local journal recovers cloud success before
local disk failure, including capture's local project creation. Permanent task
removal is blocked in cloud mode. The online adapter is active.

The guarded cutover rechecks the task digest, refuses concurrent local edits,
imports only into an empty staged cloud row, and activates an `online` authority
marker with the exact private connection. Refresh the installed capture runtime
and stop old workspace writers for the brief migration; editing resumes through
the adapter afterward. The first local transport invokes Wrangler for each
query, requiring this checkout/Node and approved D1 administration access. Live
fictional acceptance on an isolated table verified 0.9–1.2 second reads and
about 2 second edit/capture domain saves. A Node preloader keeps SQL out of the
OS command line while using Wrangler's ordinary query API; its `--file` bulk
import path cannot return SELECT/CAS rows. The refreshed installed native
helper's read-only ping verified the real task store, and the installed Tasks
screen shows shared cloud storage. Mercury's isolated temporary task verifies
production create/edit/Trash access. Live refresh-token rotation remains
unverified. See
[`docs/tasks-cloud.md`](docs/tasks-cloud.md) for offline/recovery limits,
completed grants, main-conversation acceptance evidence and rollback.

### Command layer

`src/commands/registry.mjs` holds every capability as `defineCommand({ name,
title, kind: read|write|ui, description, input: zod schema, run, label })`.
`runCommand(name, input, { source, actor, ui })` validates input, runs the
command inside an `operationContext`, and returns `{ result, state?,
operationId, label }`. Writes go through `mutateStore`, which diffs the store
and appends one journal entry (exact before/after record patches, label,
source such as `app`/`cli`/`mcp`/`sdk`/`capture`, and actor). `history.undo`
reverts a patch only if the touched records still match (`HistoryConflictError`
otherwise); under the online task authority, undoing a task creation moves it to
Trash instead of deleting it. `history.redo` reapplies the most recent undo.
Workspace changes journal a `workspace` patch and revert the same way.

`ui.*` commands (`ui.view`, `ui.navigate`, `ui.open`, `ui.toast`, `ui.capture`,
`ui.palette`) reach the running window: outside the server process they are
forwarded using `lifeos.json.server.json` (pid and port), and the server
broadcasts them as SSE `ui` events. Windows report what they show through
`POST /api/ui/presence`, which `ui.view` returns.

The same registry is exposed as:

- **HTTP**: `POST /api/run/<name>` (JSON body; `?state=1` adds derived state),
  `GET /api/commands` (schemas plus the MCP launch command).
- **CLI**: `lifeos run <name> [JSON | --field value]`, `commands`, `describe`.
- **SDK**: `createLifeOS({ actor })` from `src/sdk.mjs`, e.g.
  `lifeos.tasks.create({...})`.
- **MCP**: `node scripts/lifeos-mcp.mjs` (stdio; `.mcp.json` registers it), one
  tool per command, actor taken from the client name or `LIFEOS_ACTOR`.

### Routes

`scripts/dev-server.mjs` exposes these loopback-only routes. Every route under
`/api/` checks Host and Origin (DNS-rebinding and cross-site protection) and
POSTs require `content-type: application/json`.

| Method and path | Purpose |
| --- | --- |
| `POST /api/run/<command>` | Run any command; returns `{ result, operationId, label, state? }` |
| `GET /api/commands` | Every command with its JSON Schema, plus the MCP launch command |
| `GET /api/history?limit=n` | Recent journal entries for Activity |
| `POST /api/ui/presence` | The window reports its route, title and selection |
| `GET /api/reading/books/<id>/cover` | Cached cover for a saved Open Library book |
| `POST /api/tasks/open-link` | Desktop shell opens an exact saved task URL |
| `GET /api/claude/bootstrap` | Installed `claude` executable, login status, rail conversations, pending requests |
| `POST /api/claude/thread/start`, `thread/read`, `turn/start`, `turn/interrupt`, `request/respond` | Same shapes as the Codex routes, for Claude Code |
| `GET /api/state?range=week|month|quarter|year` | Return newly derived state with the workspace and store mtime |
| `GET /api/events` | SSE stream: `lifeos` (data, with mtime), `history`, `workspace`, `ui`, `codex`, `claude`; heartbeat every 20 seconds |
| `GET /api/codex/bootstrap` | Connect, read account, list workspace tasks, and return voice/pending-request state |
| `POST /api/codex/thread/start` | Start a new LifeOS-scoped Codex task |
| `POST /api/codex/thread/read` | Read a task with turns |
| `POST /api/codex/turn/start` | Send one text message to a task |
| `POST /api/codex/turn/interrupt` | Stop an in-progress turn |
| `POST /api/codex/request/respond` | Answer an approval or `request_user_input` request |

Request bodies are JSON (1 MiB for commands, 256 KiB elsewhere). Validation
errors return 400 with the command's message; other errors return 500 with a
JSON message. Static serving prevents
path traversal and falls back to `index.html` for extensionless browser paths.

There is no HTTP authentication, TLS, or remote-access design; Host/Origin
checks are the only request guard.
Loopback binding is therefore a security boundary, not an incidental detail. Do
not change it to `0.0.0.0` without designing authentication and threat controls.

## 11. CLI contract

The CLI is a compact path for agents and people that requires no source
inspection. `run` reaches every command; the focused verbs below remain for
common operations.

```bash
npm run lifeos -- overview [--json]
npm run lifeos -- commands [group] [--json]
npm run lifeos -- describe tasks.create
npm run lifeos -- run tasks.create --title "Draft Act III" --projectId portia --dueDate 2026-09-01
npm run lifeos -- run views.create '{"name":"This week","filter":{"due":"next7"}}'
npm run lifeos -- activity --limit 20
npm run lifeos -- undo [operationId]
npm run lifeos -- redo
npm run lifeos -- projects --health
npm run lifeos -- projects categorize --project "Portia" --category "Infinitamente"
npm run lifeos -- projects status --project "Vulcano" --status done
npm run lifeos -- projects delete --project "Infinitamente" --preserve-category "Infinitamente"
npm run lifeos -- tasks --project "Portia"
npm run lifeos -- tasks --inbox --json
npm run lifeos -- tasks add --title "Draft Act III" --project "Portia" --due 2026-09-01
npm run lifeos -- tasks add --title "Resolve midpoint" --parent "Draft Act III"
npm run lifeos -- tasks complete --task "Resolve midpoint"
npm run lifeos -- tasks reopen --task "Resolve midpoint"
npm run lifeos -- tasks --completed
npm run lifeos -- tasks --trash
npm run lifeos -- tasks trash --task "Draft Act III"
npm run lifeos -- tasks restore --task "Draft Act III"
npm run lifeos -- tasks delete --task "Draft Act III"
npm run lifeos -- tasks assign --task "Draft Act III" --project inbox
npm run lifeos -- stats --range week
npm run lifeos -- stats --project "Portia"
npm run lifeos -- stats --category "Infinitamente" --range year
npm run lifeos -- recommend
npm run lifeos -- log --project "Vulcano" --duration 180 --type creative --desc "Edited eclipse sequence"
npm run lifeos -- session start --project "Portia" --type creative --desc "Draft Act III"
npm run lifeos -- session status
npm run lifeos -- session stop
npm run lifeos -- storage status
npm run lifeos -- storage configure-backup --path "/absolute/Google Drive/My Drive/LifeOS Backups"
npm run lifeos -- storage backup-now
npm run lifeos -- storage disable-backup
```

Use `--json` for structured output from `projects`, `stats`, `recommend`, and
`storage status`.
`log` also accepts `--date` and `--time`. A numeric `--duration` is interpreted
as minutes. Without an explicit duration, the underlying parser can recognize
common hour/minute language.

Project resolution prefers exact normalized ID/name matches and then contained
matches. An explicit unknown or ambiguous project throws an error. Omitting the
project allows inference from text and then general/inbox work if none is found;
do this only for genuinely general work. Preserve the original user text in
`rawInput`.

Task resolution likewise prefers exact normalized ID/title matches and rejects
ambiguous titles. `tasks add` creates a root unless `--parent` is supplied; a
subtask inherits that parent's project. `--project inbox` explicitly detaches a
root tree. `--due`, `--start`, and `--duration` map to the validated schedule
envelope; recurrence remains unavailable. `--priority` and a repeatable `--tag`
set the same labels the browser uses; `tasks priority` and `tasks tag` change
them afterwards, `tasks tag --clear` empties the set, and `tasks --tag` filters
the active list. Plain `tasks` lists only open, non-trashed work; `--completed`
and `--trash` expose the separate lifecycle scopes. `tasks trash` is recoverable,
`tasks restore` brings a subtree back, and `tasks delete` permanently removes a
task already in Trash. The CLI has no reorder command; manual order is a browser
gesture with keyboard and context-menu equivalents.

Through `run`, the CLI can do everything the app can: project creation and
editing, time-entry correction and deletion, domains, categories, settings,
milestones, challenges, saved views, workspace arrangement and undo. Import,
export and restore remain unimplemented. Store-path overrides are runtime environment
configuration rather than persisted domain settings.

## 12. Browser interface and control state

The interface follows the **V2 Editorial** direction, rebuilt in October 2026
as an almanac printed in two inks: ink for everything, and rubric (vermilion,
or the chosen accent) only for what needs the person — today, now, overdue,
critical, the active place. Warm paper with a faint grain is the day edition;
cream ink on blue-black is the night edition. Newsreader carries everything
read (titles, tasks, notes, figures), IBM Plex Sans the controls, and JetBrains
Mono the small-capital labels and numbers. Rules and space separate things
instead of boxes; only slips that lie on top (menus, palette, dialogs) and
idea index cards are boxed. Domain colors stay as thin swatches. Legibility
has a floor: no text below 10 px, labels at 11 px, informational text in
`--ink-3` (at least 5:1 against the paper in both editions), and `--ink-4`
only for placeholders, decoration and deliberately quiet states. It is a
dependency-free set of ES modules under `public/app/` and stylesheets under
`public/styles/`.

### Architecture

- `store.js` holds the derived server state (with the workspace), browser
  preferences (`localStorage` key `lifeos.ui.v2`) and ephemeral UI state.
  Renders batch into one animation frame, backed by a short timer so a hidden
  window still applies agent changes.
- Screens return `html` templates (interpolations escaped unless they are
  templates themselves); `dom.js` `morph` patches the live DOM, keyed by
  `data-key`, preserving focus, caret, scroll, open `<details>`
  (`data-keep-open`) and stable subtrees (`data-morph-key`).
- `api.js` `run(name, input, { optimistic, pending, undo, quiet })` applies an
  optimistic state, posts the command, adopts the returned state, rolls back on
  failure, and shows an Undo toast labeled by the journal. SSE `lifeos` events
  newer than the last known store mtime trigger a refetch.
- `main.js` owns one delegated layer for clicks (`data-action`), inputs,
  submits, pointer drags (`data-draggable`), context menus, double-click rename
  and the keyboard map. The current screen's actions win over shared ones.
- Paths route sections: `/today`, `/tasks?list=…`, `/projects/<id>`,
  `/creation/<id>`, `/reading?view=library`, `/insights`, `/almanac`,
  `/settings/<page>`. Old `?tab=` links redirect.

### Shell

- Masthead: a dateline (weekday, date, week, issue number, live connection),
  the italic title, and tools — the running timer (stop, change project,
  discard) or a Focus control, Search (⌘K), New (menu of every capture kind)
  and the rail toggle. Under a double rule, the sections in workspace order
  with live counts (overdue, Inbox, critical projects, reading, ideas in
  progress), pinned projects/views/tags, the night/day edition toggle and
  settings. Along the bottom edge runs the day strip: today from 06:00 (or the
  first entry) to midnight, each logged entry a block in its activity's ink,
  the running timer growing in rubric, and a rubric hairline at now. ⌘\
  condenses the masthead to one line; under 820 px it becomes a compact bar and
  the sections open as a numbered contents page.
- Detail sheet (tasks, books) opens under the masthead, beside the content when
  the main column has room and over it with a scrim otherwise (container
  query). J/K step through the list while it is open; Esc closes.
- ⌘K palette: navigation, every create action, records (projects, tasks, books,
  ideas) with → for their action menus, saved views, settings, theme, undo,
  backups, and "Ask Codex/Claude" with the typed text.
- Quick capture (N, L, T, or the New menu): task, log time, timer, idea,
  project, book and milestone, with inline token highlighting and chips for
  dates/times (English and Portuguese), `!priority`, `#tags`, `@project`,
  durations and `~activity`, `@`/`#` autocomplete, field pickers, ⇧↵ to add
  another and ⌘↵ to add and open.
- One menu system (row ⋯, right-click, Shift+F10) with submenus, search, chips
  and keyboard navigation; pickers for dates (typed phrases, calendar, time),
  priority, project and tags.
- Toasts confirm each change with Undo (⌘Z) and Redo (⇧⌘Z).

### Screens

- **Today** is the front page: the lede sets the top recommendation as the
  headline (project in rubric italic, health and reasons beneath, start,
  another, not now; the reasons are written out, e.g. "last worked 6 days
  ago · due in 3 days · 1 open task") or, while a timer runs, a large clock with editable
  project, description and type; beside it the tally of the day against the
  plan with deep minutes and an activity bar. Below: today's tasks with quick
  add, the day's ledger of entries (editable), and a column with week bars,
  needs attention, coming up (tasks, deadlines, dated ideas; tasks can be
  pulled forward to today from there), reading now and the challenge.
- **Tasks**: lists pane (Inbox, Today, Upcoming, All, saved views, projects,
  tags, Completed, Trash) with counts; filter; view options (group by none,
  priority, due date, list, tag; sort by custom, priority, due, title, created);
  quick add with natural language; rows with priority checkbox and flag,
  subtasks, notes marker, tags, list, duration and due pill; collapsible
  subtrees; completed fold (a task you complete stays in place, crossed off in
  rubric, for 1.4 s before it moves there). Drag reorders and nests (custom order, no grouping)
  or drops onto a list (move, date today, tag, complete, trash) or a group lane
  that names one value. Keyboard: J/K/arrows, ↵ open, Space complete, X and ⇧
  select, D/P/M/# pickers, S subtask, 0–3 priority, ⌫ Trash, ⌘D duplicate,
  ⌥↑↓ reorder, Tab/⇧Tab nest. Two or more selected show a bulk bar (complete,
  date, priority, move, tag, Trash). The sheet edits title, list, due/time,
  estimate, priority, tags, notes (with link chips) and subtasks. Saved views
  combine projects, tags, priorities, due window, status and text.
- **Projects**: focus presets, sort, list grouped by status (empty or hidden
  statuses appear as drop lanes while dragging) and a Next up/Doing/Done board.
  Cards show domain, health, next action, weekly hours against plan, tasks,
  deadline, streak, progress and an eight-week sparkline. The project page edits
  name, subtitle, next action and note in place, and status, domain,
  categories, priority, deadline, weekly plan and progress; it hosts tasks,
  sessions, week history, milestones, focus timer, pin and agent context.
- **Creation**: type chips, search, sort, five-lane board with inline add, list
  table, and the idea editor (status, type, date, linked task, formatting bar,
  edit/split/preview, auto-save, ⌘S, conflict recovery and download).
- **Reading**: shelf (Next up, Reading, finished this year) and a sortable,
  filterable library; book sheet with status, date read, tags, edit details,
  agent context and removal; Open Library search dialog and manual add.
- **Insights**: range KPIs, domains vs plan, composition and making vs taking,
  rhythm heatmap, project trends, categories, and the time log with filter,
  type filter and per-entry edit/delete.
- **Almanac**: year in numbers, challenge set/edit/clear, streaks, and a
  searchable milestone timeline with add, edit and delete.
- **Settings**: general (name, tagline, time zone, start screen), appearance
  (theme, accent, density), masthead (section order, visibility, pins), planning (daily
  plan, deep-work target, health thresholds, domains with weekly hours,
  categories), saved views, agents (MCP setup for Claude Code and Codex, CLI,
  SDK, HTTP, command reference), data and backups, keyboard.

### Browser-local state

- `lifeos.ui.v2` holds the condensed masthead, rail open/tab/agent/width, per-list
  task view options and collapsed subtrees, project/reading/creation view
  preferences, the insights range and recent records.
- `lifeos.codex.threadId` and `lifeos.claude.threadId` remember the open rail
  conversation per agent.
- Recommendation rotation and dismissal are in-memory.

All record text is escaped by the `html` template; Markdown is rendered only
through the bundled Marked + DOMPurify sanitizer. Treat store, URL and protocol
values as untrusted when adding controls.

## 13. Agent rail

The rail has two tabs: **Agent** (Codex or Claude Code, switchable, each with
its own conversations) and **Activity** (the change journal with per-entry undo
and links to the touched records; filters for all, agents, you). Approvals and
questions from either agent surface the rail and wait for the person.

### Non-negotiable transport decision

The rail is a front end to the person's installed agent applications and their
existing sign-ins: Codex (`codex app-server`, ChatGPT account) and, since
2026-10-18 at the owner's request, Claude Code (`claude` CLI, Claude login). It
is not an API-based chatbot.

Never add:

- an API key or direct model API call (OpenAI, Anthropic or other);
- an API SDK client as an alternate transport;
- terminal-output scraping;
- Ollama or another local/remote model;
- Whisper, browser speech recognition, or another dictation substitute.

### Executable discovery

The bridge checks candidates in this order, deduplicated:

1. `CODEX_EXECUTABLE`, when explicitly configured;
2. macOS app bundle: `/Applications/ChatGPT.app/Contents/Resources/codex`;
3. `/opt/homebrew/bin/codex` and `/usr/local/bin/codex` on non-Windows systems;
4. `codex` on `PATH`, or `codex.exe` on Windows.

It starts `codex app-server --stdio` with the LifeOS root as the working
directory and communicates using newline-delimited JSON-RPC on standard I/O.
Standard error is diagnostic only and is not used as a chat protocol.

### Connection and task lifecycle

1. Send `initialize` with LifeOS client metadata and then `initialized`.
2. Read the installed account with `account/read`.
3. Continue only as a full rail when the account type is `chatgpt`.
4. List up to 500 unarchived CLI, VS Code, and app-server tasks, filtered by the
   exact LifeOS working directory and sorted by recency.
5. Start or resume tasks with this workspace as both `cwd` and runtime root.
6. Use `workspace-write`, `on-request`, and a user approval reviewer.
7. Inject compact LifeOS developer instructions that point Codex to
   `AGENTS.md` and the CLI for ordinary operations.
8. Start text turns, stream notifications, and allow interruption.

This is the context-efficiency strategy: the task already has the correct
workspace and receives a compact operating map; routine questions use the CLI,
while source inspection is reserved for implementation or schema work.

The bridge recognizes command, file-change, permissions, and user-input server
requests. It holds them pending and sends them to the browser. The browser must
show the request and return the user's decision or answers; do not auto-accept.
It also answers the app-server's `currentTime/read` request. Unknown server
requests receive a JSON-RPC method-not-found response.

The browser renders user and agent messages, plans, reasoning summaries,
commands, file changes, tool calls, context-compaction markers, streamed deltas,
errors, and turn completion. When a turn completes it refreshes the LifeOS state
and task list so file changes appear without a manual reload.

Project and Reading detail controls can attach one ephemeral item snapshot above
the composer. Attaching closes the detail view and focuses the rail. The
attachment is removable, creates no turn and performs no data write on its own,
and is prepended to the user's text with a blank line only when the user sends.
Attaching another item replaces the previous attachment.

The app-server protocol belongs to the installed Codex version and can evolve.
Keep its integration isolated in `src/codex-app-server.mjs`, verify actual
protocol behavior after upgrades, and expand protocol tests with every new
request or notification handled.

### Claude Code

`src/claude-code-agent.mjs` drives the installed `claude` CLI (candidates:
`CLAUDE_EXECUTABLE`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`,
`~/.claude/local/claude`, `~/.local/bin/claude`) with
`-p --input-format stream-json --output-format stream-json --verbose
--include-partial-messages --permission-prompt-tool stdio --permission-mode
manual --allowedTools mcp__lifeos`, an appended LifeOS system prompt, and an
`--mcp-config` that starts `scripts/lifeos-mcp.mjs` with `LIFEOS_ACTOR=Claude`
and the app's `LIFEOS_DATA_DIR`. The child environment drops any embedding
Claude session's variables (`CLAUDECODE`, `CLAUDE_CODE_*` except the temp dir).

- Login status comes from `claude auth status --json`; without a login the rail
  says how to sign in (`claude auth login`) and offers Retry. LifeOS never signs
  in on the person's behalf.
- `--permission-mode manual` overrides a personal default such as
  bypassPermissions: only the journaled LifeOS MCP tools run unprompted; shell,
  file edits and web requests arrive as `can_use_tool` control requests and are
  shown as approvals (Allow once, Allow for session using Claude's own
  suggestions, Decline). `AskUserQuestion` is shown as a question form.
- Conversations started from the rail are indexed in
  `claude-rail-sessions.json` beside the store (titles only); a new one gets a
  fixed `--session-id`, later turns `--resume` it, and past turns are rebuilt
  from Claude's session transcript. A process stays alive while a conversation
  is active and exits after 15 idle minutes.
- Stream events are translated to the Codex shapes (`turn/started`,
  `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`,
  `serverRequest`, `serverRequest/resolved`), so one renderer serves both.
- `tests/claude-code-agent.test.mjs` exercises the protocol with a faithful fake
  CLI. A live signed-in Claude conversation has not been verified here: the CLI
  login on the development Mac had expired at implementation time.

### Voice boundary

`CODEX_VOICE_CAPABILITY` is intentionally exported as unavailable, with the
reason displayed in the rail. The current installed app-server does not expose
Codex desktop dictation to ChatGPT-account clients, while its realtime route
requires API-key authentication. The user's constraint forbids that route and
forbids a separate model. Voice must remain disabled unless subscription-
authenticated dictation becomes available through the installed app-server and
is verified live.

## 14. Why these development decisions were made

### Local-first, single-user

The source data is personal and should remain portable, inspectable, and usable
without a hosted service. Loopback-only operation also avoids premature account,
sync, and server-security work.

### Node and web standards

Node supplies filesystem, HTTP, process, and test primitives across macOS,
Linux, and Windows. Vanilla HTML/CSS/JavaScript avoids a package install, bundle
step, framework churn, and unnecessary application weight.

The separate task MCP boundary uses the official MCP SDK, and the synthetic
Worker proof adds Wrangler/workerd development tooling. Those tools require
Node 22+; they do not replace or bundle the browser-native main app.

The October 2026 rebuild split the interface by responsibility (store, API,
router, DOM morphing, actions, components, screens, overlays) as plain ES
modules with no build step; a small `html` template plus keyed `morph` gives
framework-like rendering without a framework.

### JSON before a database

JSON is transparent, backup-friendly, easy for Codex to reason about, and enough
for one local writer at this scale. Locking and atomic replacement address the
main immediate corruption risks.

Tradeoff: queries, migrations, partial updates, long history, undo, and sync will
eventually strain a monolithic file. Move to SQLite only when measured needs
justify it, with an explicit migration and export path; do not add a database
daemon.

### Tasks as a shared collection, not project children

Inbox and project work should move between contexts without changing identity,
and project deletion must not erase commitments. Tasks therefore live in one
top-level collection with optional project and parent references. The enforced
same-project rule for a subtree keeps project summaries, filtering, and future
calendar export unambiguous. Derived task progress follows the same one-source-
of-truth rule as analytics.

### LifeOS owns schedule facts; calendars are downstream

The schedule envelope is present now so due dates, optional start times,
durations, and recurrence can evolve without replacing task records. Google
Calendar integration is intentionally absent. When implemented, begin with a
one-way LifeOS-to-Google projection using stable task/export identifiers and
explicit conflict/error reporting. Do not make Google Calendar the task source
of truth or introduce two-way synchronization before one-way behavior has been
observed and designed against real data.

### Open Library as lookup, not source of truth

Open Library requires no API key and fits this personal, human-initiated search
volume. LifeOS submits only an explicit title/author/ISBN query, requests at
most 20 results at a time, and fetches another page only after an explicit user
action. Valid ISBN-10/13 input uses Open Library's exact ISBN query. LifeOS
stores only the normalized book the user selects. The provider is never treated
as the application database. Result completeness is allowed to vary,
work-detail enrichment is best-effort, and cover failures have a local visual
fallback.

The provider boundary lives in `src/book-catalog.mjs` so a future fallback can
be added without changing the persisted book model. Do not put provider-specific
response blobs into the active store or add a Google/API credential merely to
support the existing Reading workflow.

Saved cover files are regenerable cache rather than source data. They are
content-checked, capped at 1 MB each, named from the local book ID, stored with
owner-only permissions in the adjacent `reading-covers/` directory, and removed
on permanent book deletion. They are intentionally not copied into every daily
and monthly JSON snapshot; the original HTTPS cover URL remains in book metadata
so a missing local cache can be rebuilt.

### Derived statistics, never display totals

The original visual mockup contained illustrative numbers. The implemented
dashboard instead computes every statistic from entries, projects, and settings.
This prevents a second, stale truth layer and makes a data edit propagate across
all views.

### One command layer for people and agents

Agents should be able to do everything the person can, without reading source
and without a second, divergent API. Defining each capability once — with a
schema, a description and a human label — and serving it to the UI, CLI, SDK,
HTTP and MCP makes that true by construction: a new capability added as a
command appears everywhere at once, and the UI cannot quietly grow abilities
agents lack. The CLI and MCP descriptions also keep routine agent work cheap in
context.

### A change journal instead of per-feature undo

Recording exact before/after patches at the single write boundary
(`mutateStore`) gives every change — from the person, a script or an agent —
the same Activity entry and the same conflict-safe undo, without per-feature
inverse operations. Coalescing keeps typing from flooding the journal, and
conflict checks refuse to undo over a later edit.

### Server-Sent Events

LifeOS needs one-way local notifications for file and Codex events. SSE is
built into browsers, simple to reconnect, and lighter than a WebSocket stack.
Mutations remain ordinary HTTP requests.

### Installed Codex app-server and Claude Code CLI

App-server provides the user's current account, persistent tasks, tool activity,
approvals, and workspace semantics. The Claude Code CLI's stream-json control
protocol offers the same through the person's Claude login: streaming, tool
steps, permission prompts and resumable sessions. Using the installed apps keeps
LifeOS a front end with no separate credentials or billing. Driving the CLI
directly (rather than the Agent SDK) also avoids bundling a second copy of the
Claude binary.

### Source-backed Tauri now; self-contained packaging later

The implemented Tauri shell preserves the existing local web UI without
freezing it into a release artifact. The shell contains only native startup,
refresh, and window lifecycle logic. It launches the repository's Node service,
reads the dynamic loopback URL, uses macOS WKWebView, replaces the running
service from the native app menu, and terminates the service on exit.
This makes a normal Applications/Dock workflow available while the data model
and browser UI continue changing rapidly.

The tradeoff is intentional: `LifeOS Dev.app` depends on this repository path
and an installed Node runtime, and must be rebuilt/reinstalled only when Rust,
bundle configuration, or native icon/lifecycle code changes. Ordinary HTML,
CSS, JavaScript, server, and data-module edits are picked up from the workspace
through **Refresh LifeOS** without rebuilding the native shell. A later release
can bundle a target-specific Node sidecar after storage and management workflows
stabilize.

## 15. Demo data and the transition to real data

`scripts/create-demo-data.mjs` defaults to the fixed date 2026-08-22 and creates
deterministic projects, a nine-record task collection with nested/project/Inbox
examples, granular sessions, weekly history aggregates, a challenge,
milestones, and an 11-book public-safe reading library spanning all five
statuses. `LIFEOS_DEMO_DATE` can anchor a regenerated demo to a different date.

Running this writes only the demo snapshot:

```bash
node scripts/create-demo-data.mjs
```

Running this intentionally overwrites the active store:

```bash
npm run demo:reset
```

Once real data exists, do not use `demo:reset`.

### Required preparation before importing private data

The active store is no longer tracked by Git. Automated tests read
`data/lifeos.demo.json` or temporary copies, and the runtime uses platform
Application Support with `LIFEOS_DATA_DIR` as an explicit override.

Recommended import sequence:

1. Configure the intended Google Drive account and confirm `storage status`
   reports a successful initial snapshot.
2. Retain a separate pre-import snapshot outside the repository.
3. Inventory real domains, projects, statuses, priorities, weekly plans,
   deadlines, historical-entry granularity, milestones, reading books, and
   timezone.
4. Map them into schema version 10 without inventing unsupported certainty.
5. Preserve original descriptions in `rawInput` and mark summarized imports
   with `aggregation` so they are not treated as timed sessions.
6. Set `meta.demo` to `false` and remove demo-only metadata as appropriate.
7. Validate the store and run all checks.
8. Review every tab and recommendation against the real records.
9. Only then evolve schema or recommendation rules based on observed gaps.

## 16. Maintenance workflows

### Ordinary data operation

1. Read with a command (`lifeos overview`, `lifeos run …`, or the MCP tools).
2. Write through a command; it is journaled and undoable.
3. Do not inspect or edit browser code for an ordinary log/stat/recommendation
   request.
4. Confirm the concrete result with a read command, and show it in the window
   with `ui.open` or `ui.navigate` when useful.

### Changing a derived statistic

1. Define the source facts and period semantics.
2. Implement the calculation in `src/lifeos-data.mjs`.
3. Return it from `buildState`; do not compute a conflicting copy in the UI.
4. Add a deterministic test proving both the baseline and sensitivity to a
   source-entry change.
5. Render the returned field in the relevant `public/app/screens/` module.
6. Check every range and any aggregate-entry behavior.

### Changing the schema

1. Write down old and new shapes and migration behavior.
2. Update the demo generator first so a complete valid fixture exists.
3. Update validation and data operations.
4. Add migration or backward-compatibility code before bumping
   `schemaVersion`.
5. Update CLI/routes and derived state.
6. Update UI rendering and empty/error states.
7. Add fixture-based tests, including invalid references and recovery.
8. Update this file and `AGENTS.md` if an invariant changes.
9. Refresh an installed capture helper with `npm run capture:install` after a
   schema change; its copied runtime must understand the new store version.

### Adding a capability or browser control

1. Decide whether it is ephemeral UI state, a browser preference
   (`lifeos.ui.v2`), workspace arrangement (sidecar) or persisted domain state.
2. For persisted state, add a command in `src/commands/` (schema, description,
   label) backed by a data operation that writes through `mutateStore`. It then
   reaches the UI, CLI, SDK, HTTP and MCP at once.
3. In the browser, add an intent in `actions.js` that calls `run()` with an
   optimistic update where it helps; wire the control with `data-action`.
4. Offer a keyboard path, a menu entry, and a palette action where relevant.
5. Verify keyboard behavior, both themes, narrow layouts and empty states, and
   extend `tests/ui.test.mjs` and `tests/commands.test.mjs`.

### Changing task behavior

1. Preserve `tasks.items[]` as the only task collection and keep task progress
   derived in `hydrateTasks`.
2. Maintain parent existence, acyclicity, and same-project subtree validation.
3. Route task writes through `mutateStore`; update `updatedAt` and completion
   timestamps together, and preserve multiline task notes within their limit.
4. Decide and test cascade behavior explicitly for completion, reopening,
   reassignment, project deletion, Trash/restore, 30-day cleanup, and permanent
   task-subtree deletion.
5. Keep browser routes narrow and return the full newly derived state so Tasks
   and Projects stay synchronized.
6. Extend both data tests and `tests/ui.test.mjs`, then exercise the live
   Tasks and project-detail flows with an isolated `LIFEOS_DATA_DIR` copy.
7. Treat any future calendar connector as an export boundary; local task writes
   must succeed independently of calendar availability.

### Changing an agent bridge

1. Preserve installed-app authentication (ChatGPT account for Codex, Claude
   login for Claude Code).
2. Check the live app-server protocol rather than guessing method shapes.
3. Keep workspace roots and approval routing explicit.
4. Add protocol tests for each new message type.
5. Test reconnect, interruption, and pending-request behavior.
6. Never make voice appear available without a verified no-API path.
7. For Claude, keep `--permission-mode manual` and the narrow `--allowedTools`;
   extend the fake-CLI tests for each new message type.

### Before every commit

1. Run `git status --short --branch` and identify user-owned/unrelated changes.
2. Run `npm run check`.
3. Inspect the exact diff.
4. Stage only explicit reviewed paths; never use broad staging in a mixed tree.
5. Scan staged content for secrets, tokens, credentials, private paths, and
   personal data.
6. Confirm `.bak`, `.lock`, temporary, and browser-test artifacts are absent.
7. Use a feature branch for new implementation work unless the user directs a
   different Git workflow.

## 17. Verification contract

The single verification command is:

```bash
npm run check
```

It syntax-checks every shipped JavaScript file (`scripts/check-syntax.mjs`),
runs Node's built-in test suite, then compile-checks the pinned Tauri shell.

At this handoff, the suite contains 135 tests. Beyond the areas below, it
covers the command layer, journal, undo/redo, workspace and MCP
(`tests/commands.test.mjs`), the interface rendered from derived state
(`tests/ui.test.mjs`) and the Claude bridge (`tests/claude-code-agent.test.mjs`).
Areas covered:

- duration parsing;
- demo-derived totals and recommendation;
- rhythm-heatmap hour boundaries and midnight clipping;
- sensitivity of totals/composition to a new entry;
- shared-source date ranges;
- rejection of an explicit unknown project;
- backup and lock cleanup;
- macOS/Windows/Linux personal-data path resolution;
- macOS Google Drive root discovery without automatic account selection;
- validated latest/daily/monthly snapshot creation and configured-timezone dates;
- timer-to-entry behavior;
- configured-timezone calendar boundaries;
- version-2-through-9-to-10 reading/project/category/task/notes/status/Trash compatibility
  and invalid-reference rejection;
- reusable project categories, derived category totals, and history-preserving
  project deletion;
- six-status project movement, active/recommendation derivation, Projects List
  grouping/filtering/latent drop lanes, hidden-move recovery, and focused Kanban projection;
- independent/project task creation, nested project inheritance, schedule
  validation, completion/reopen cascades, subtree/project progress, root
  reassignment, note/title updates, subtree Trash/restore/permanent deletion,
  30-day pruning, cycle rejection, and project-deletion detachment;
- task scopes, due-date lanes and drop targets, accessible rows, the task
  sheet, project/reading/creation/settings screens, and optimistic updates;
- reading add/deduplication, status movement, derived counts, queue order,
  normalized tags, exact permanent deletion, manual Date read editing, and the
  configured-timezone current-year Finished projection;
- Open Library result normalization, 20-result pagination, exact ISBN queries,
  description enrichment, and an offline fallback;
- saved-cover medium-image selection, bounded local reuse, deletion cleanup,
  and saved-versus-temporary cover rendering;
- macOS, Windows, and portable Codex executable lookup;
- approval exposure to the browser bridge;
- exact project/book composer context and message composition;
- Claude stream-json streaming, approval and decline round-trips, and
  transcript reload;
- the intentional voice-disabled boundary.

Additional task MCP coverage exercises authenticated loopback HTTP with the
official SDK client, schema/request bounds and Host/Origin checks, isolated
task-tree lifecycle operations, atomic/stale edits, concurrent writes, no
read initialization/pruning, JWT signature/issuer/audience/owner/expiry checks,
and per-tool write scopes. Real-task local reads were checked without writes;
this does not establish HTTPS/OAuth account linking or direct Mercury access.
Five additional workerd tests exercise the synthetic and private Workers through a full
mocked OAuth/PKCE flow and the official MCP client, other-owner rejection,
broader upstream-scope rejection, consent escaping/CSRF/single-use state,
audience/write-scope denial, body/origin bounds, and fail-closed configuration.
The consent page was visually inspected on a disposable loopback preview.
Private D1 fixture coverage verifies authenticated creation/editing/completion/
Trash/restore, read-only write rejection and no public task counts/content.
Four portable-model tests compare cloud/local lifecycle results and verify
revision conflicts/validation; four cutover tests verify backup hashes, a
concurrent-local-edit refusal, task fences, unrelated-record preservation and
tampered-artifact refusal. Ten adapter tests verify desktop/capture behavior,
offline reads/unrelated edits, stale/racing writes, interrupted-save and local
disk recovery, capture deduplication, out-of-band change refusal and retained
Trash. A pinned Wrangler transport test verifies SELECT/CAS result rows,
leading-comment SQL and absence of private query content from the OS command
line. UI changes are checked with synthetic state and the actual stylesheet;
the active installed Tasks screen was also inspected without personal writes.

The October 2026 interface was also inspected in a browser against an isolated
demo store regenerated for the current date: every screen in light and dark,
phone width, quick capture, keyboard navigation and selection, completion and
undo/redo, Activity, the Codex rail with the signed-in account, the Claude
sign-in state, and agent control of the open window from the CLI.

Automated coverage does **not** yet include:

- general browser-application HTTP route integration beyond the focused MCP
  and native-capture tests;
- browser interaction end-to-end tests (rendering is tested in Node);
- SSE reconnect/file-watcher behavior;
- a live signed-in Codex or Claude conversation;
- full app-server protocol compatibility;
- real-data imports;
- self-contained sidecar packaging, notarization, and updates.

For changes touching those areas, add focused tests where practical and perform
a manual browser/live integration check. Documentation-only edits need an
accuracy, link, and diff review; the full standard check remains required before
committing.

## 18. Known limitations and deliberate deferrals

### Must be addressed before real-data migration

- Configure and verify one explicit backup destination; LifeOS intentionally
  does not guess between accounts.
- Complete a careful real-data field inventory and import mapping.

### Product workflows not built

- Define recurrence or synchronize tasks with an external calendar.
- Import/export UI and validation report.
- Goals and richer deadline management.
- Configure the backup destination from the UI (the CLI does it explicitly).

### Technical limitations

- Validation is partial; only the focused version-2-through-10 compatibility steps
  are implemented, not a general migration framework.
- Daily/monthly JSON snapshots provide history but not cross-device merge or
  immutable disaster recovery.
- Timers crossing midnight are logged as one entry on the start date.
- The file watcher observes the active filename only and is intentionally
  process-local.
- Browser HTTP endpoints trust local callers and must remain loopback-only.
  The separate task MCP server requires authentication but also binds only to
  loopback. The separate private remote Worker is deployed, authenticated and
  connected as a personal plugin; the browser app remains loopback-only.
- Tasks MCP has no operation-ID deduplication for uncertain create responses,
  an iPhone client or a general multi-device sync protocol. The private
  Cloudflare Workers + D1 implementation is the active task authority after
  direct approval, verified backup and guarded import. Its private OAuth plugin
  is connected and a direct real-task read by Mercury succeeded in the main
  conversation. Desktop task reads use a local cache offline; edits require
  connectivity. The synthetic-only Worker is deployed on
  Free and has no task database. See the task MCP/cloud runbooks for the staged
  proof and approval requirements. Actual OAuth/MCP CPU usage has not been measured.
- Catalog search, temporary cover previews, and the first load of an uncached
  saved cover require internet access. Cached saved covers, reading records, and
  typographic fallbacks remain available offline.
- The Codex and Claude Code protocols may drift with installed application
  updates; the Claude bridge relies on the CLI's stream-json control protocol.
- Browser interaction lacks automated end-to-end coverage.
- The journal keeps the most recent changes (compacted around 400 entries); it
  is an undo and audit aid, not a backup.
- `LifeOS Dev.app` is source-backed and Mac-only: it depends on the current
  workspace path and installed Node, uses an ad-hoc signature, and has no
  notarization, updater, single-instance guard, or friendly native startup-error window.
- Self-contained sidecars and Windows/Linux packaging are not implemented.

### External capability limitation

- Voice cannot currently meet the user's constraint. It is disabled honestly,
  not represented as a completed workflow.

## 19. Recommended next implementation order

1. Select and configure the intended backup destination; verify latest, daily,
   and monthly snapshots without changing their sharing.
2. Import the user's real data with a repeatable, reviewable mapping and backup.
3. Observe and document real mismatches in schema, health, and recommendation
   logic.
4. Make the smallest deliberate schema/rule revision supported by that evidence.
5. Refine task scheduling/edit/delete behavior only after real task use reveals
   the needed semantics; keep external calendars downstream of LifeOS.
6. Sign Claude Code in (`claude auth login`) and verify a live rail
   conversation, including an approval round-trip.
7. Add goals, import/export with a validation report, and browser end-to-end
   tests for the main flows.
8. Replace the source-backed shell with a self-contained sidecar and add
   notarized distribution only after those workflows stabilize.

The interface and command layer were rebuilt in October 2026; the next agent
should not redesign them again or add a database. Make the real-data transition
safe, then let the real records determine the next structural change.

## 20. Incoming-agent checklist

Use the items relevant to the task; ordinary CLI operations and small edits do
not require the full implementation checklist:

- [ ] Read `AGENTS.md` and the relevant sections of this file.
- [ ] Check Git status and preserve unrelated/user changes.
- [ ] Confirm whether the Application Support store is still demo-derived or now contains private real data.
- [ ] Do not run `demo:reset` when real data is present.
- [ ] Use commands (MCP, `lifeos run`, CLI verbs) for ordinary operations.
- [ ] Start through `/Applications/LifeOS Dev.app`, `npm run desktop:dev`, or
      `npm run dev`; never use `file://`.
- [ ] Keep visible numbers derived from source records.
- [ ] Keep task trees in `tasks.items[]`; preserve hierarchy/project invariants
      and derive subtree/project progress.
- [ ] Keep calendar integration absent or one-way from LifeOS until explicit
      synchronization semantics are designed and requested.
- [ ] Keep agents on the installed, signed-in Codex app-server and Claude Code CLI only.
- [ ] Keep approvals and user questions visible to the user.
- [ ] Keep voice disabled unless the exact permitted capability is verified.
- [ ] Preserve V2 Editorial; add capabilities as commands so agents keep parity.
- [ ] Run checks for the changed behavior and proportionate live/browser checks;
      run `npm run check` before committing.
- [ ] Review and privacy-scan explicit staged paths before any commit or push.
- [ ] Update this document if the state or architecture changes materially.

## 21. Definition of a trustworthy LifeOS change

A change is complete only when:

- persisted facts have one clear source of truth;
- every displayed result is derived reproducibly;
- writes are validated and recoverable in proportion to their risk;
- the command layer stays the one path for people and agents, and its
  descriptions stay concise;
- no API-key or alternate-model dependency has entered the rail;
- errors and approvals remain visible rather than silently handled;
- demo and personal data are not confused;
- the current checks pass;
- documentation states what is still incomplete without presenting a
  placeholder as a workflow.
