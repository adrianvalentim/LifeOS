# LifeOS project state and maintainer handoff

> Canonical implementation handoff for agents and maintainers. Use
> [`AGENTS.md`](AGENTS.md) to select the sections relevant to the task; consult
> architecture and rationale before making a structural change.

- Last updated: 2026-09-12
- Implementation baseline: `main`, including the storage, Projects, Reading, and
  source-backed Tauri work described here
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

The dashboard is the legibility layer. Codex is intended to be the main natural-
language operating layer: the user can ask it to log work, inspect state, explain
a recommendation, or modify LifeOS itself.

The current foundation is deliberately small:

- a dependency-free browser interface;
- a local Node.js 20 server;
- one portable JSON personal store outside Git;
- a stable CLI for data operations;
- a bridge to the **installed** `codex app-server` and its already signed-in
  ChatGPT account;
- a source-backed Tauri/WKWebView macOS development app;
- optional latest, daily, and monthly snapshots to one explicitly configured Google Drive folder.

There is no hosted backend, database daemon, OpenAI API key, SDK client, or
separate AI model. The server binds to loopback only. The development shell is
usable now without freezing the application: it starts the Node server directly
from this workspace, so normal browser assets remain refreshable. Self-contained
sidecar packaging, notarized distribution, and updates remain deferred.

## 2. Current state at a glance

| Area | State | What is true now |
| --- | --- | --- |
| Project dashboard | Implemented | Status-grouped and filterable portfolio list plus a focused three-column drag Kanban, reusable category labels, six persistent workflow statuses, confirmed history-preserving deletion, computed health, last touch, weekly hours, deadline, progress, and streak |
| Tasks | Focused first release implemented | Active All/Inbox/project/tag scopes, separate Completed and 30-day Trash scopes, dated smart lists with collapsed completed work, optional project association, nested subtasks, optional due dates, completion cascade, derived subtree/project progress, click-through details with editable notes/title and recoverable subtree deletion, project-detail creation and controls, and CLI operations |
| Web capture | Implemented and live-tested in Brave | Small Manifest V3 extension and on-demand macOS native helper create a Web Articles task from the clicked tab's title and URL, with low priority and today's LifeOS-local due date; a real toolbar capture and duplicate retry are verified, with local success preserved during a stalled cloud backup |
| Today | Implemented foundation | Computed daily entries and total, recommendation selection, real start/stop timer |
| Analytics | Implemented foundation | Week/month/quarter/year totals, domain allocation, rhythm heatmap, trends, composition, production/consumption, deep-work counts |
| Almanac | Read-only foundation | Computed streaks, current challenge, and configured milestones |
| Reading | Implemented foundation | Cover-led Kanban, complete five-status library, tags and tag filtering, details, paginated Open Library search/import with exact ISBN lookup, status movement, queue ordering, and confirmed permanent deletion |
| Data source | Implemented, demo-derived | macOS Application Support contains the active copy seeded from the legacy demo-derived store; `data/lifeos.demo.json` remains deterministic |
| Persistence | Implemented | Validation, short cross-process lock, atomic replacement, one local `.bak`, and optional latest/daily/monthly Google Drive snapshots |
| CLI | Implemented | Read projects/stats/recommendation, log time, start/stop/status a timer, and configure/inspect cloud snapshots |
| Codex rail | Implemented | Current ChatGPT account, workspace-scoped tasks, removable project/book composer context, streaming items, stop, approvals, and user questions |
| Voice | Intentionally unavailable | Installed app-server does not expose desktop dictation under subscription authentication; no fallback is allowed |
| Full management UI | Deferred | Project deletion is implemented; project creation/general editing, time-entry edit/delete, settings UI, imports/exports, and almanac search remain deferred |
| Native desktop app | Development shell implemented | `/Applications/LifeOS Dev.app` is source-backed, ad-hoc signed, starts/stops the current Node service, and can refresh that service in place from its app menu; self-contained distribution is deferred |

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
  |-- GET/POST JSON + Server-Sent Events
  v
scripts/dev-server.mjs
  |-- state/log/session/task routes -----> src/lifeos-data.mjs
  |                                           |-- validates and derives state
  |                                           `-- reads/writes platform Application Support/lifeos.json
  |-- book search -----------------------> src/book-catalog.mjs
  |                                           `-- explicit low-volume Open Library requests
  |
  |-- Codex routes ----------------------> src/codex-app-server.mjs
  |                                           `-- child process:
  |                                               installed codex app-server --stdio
  |
  `-- static files ----------------------> public/

cli/lifeos.mjs --------------------------> src/lifeos-data.mjs

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
3. **Data operations** should go through the CLI or local JSON routes instead of
   ad hoc file edits whenever possible.
4. **AI transport** is only the installed Codex app-server. The browser never
   talks to an AI service directly.

Do not open `public/index.html` with a `file://` URL for normal use. The page
depends on `/api/...` routes, SSE, root-relative assets, and the Codex bridge.
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
| `src/codex-app-server.mjs` | JSON-RPC bridge to the installed Codex executable |
| `cli/lifeos.mjs` | Stable, token-efficient operational interface for Codex and humans |
| `scripts/dev-server.mjs` | Local static server, JSON routes, SSE, file watcher, and Codex relay |
| `extensions/lifeos-capture/` | Unpacked Brave extension, fixed public identity, popup/worker/icons, and installation guide |
| `scripts/capture-native-host.mjs` and `scripts/install-capture-host.mjs` | One-message native capture bridge and local macOS release installation with Brave registration |
| `public/web-links.js` and `src/task-web-links.mjs` | Safe links derived from task notes and desktop opening of an exact saved HTTP(S) URL |
| `scripts/desktop.mjs` | Cross-platform Tauri command wrapper and APFS cache target selection for macOS builds |
| `scripts/create-demo-data.mjs` | Deterministically generates demo data; can intentionally reset the active store |
| `public/index.html` | Minimal browser entry point |
| `public/app.js` | Shared browser state, page routing/event orchestration, API calls, and streamed Codex item handling |
| `public/tasks.js` | Task scopes, nested tree rendering, progress presentation, accessible controls, and project-detail task panel |
| `public/reading.js` | Reading Kanban/library rendering and catalog/detail presentation |
| `public/styles.css` | V2 Editorial visual system and responsive layouts |
| `public/reading.css` | Cover-led Reading workspace, database rows, Kanban cards, and detail overlay |
| `public/tasks.css` | TickTick-inspired task workspace, responsive scope rail, task tree, quick-add forms, and project task panel |
| `tests/lifeos-data.test.mjs` | Data derivation, range, write safety, project matching, timer, and timezone tests |
| `tests/tasks-ui.test.mjs` | Task scopes, nesting, progress, native controls, and project-detail integration rendering |
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

- Node.js 20 or newer;
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
`~/Library/Caches/LifeOS/cargo-target` on macOS. The repository is on an external
volume that produces `._*` AppleDouble metadata; keeping build-script permission
files on APFS prevents Tauri from attempting to parse those sidecars. The built
app is ad-hoc signed and the current bundle is about 8.1 MB.

Browser-only start:

Start:

```bash
npm run dev
```

The server tries `PORT` or port 3000, then increments through nearby ports when
one is occupied. It binds to `127.0.0.1`, prints the actual URL, serves assets
with `cache-control: no-store`, watches the data directory, and does not start
the Codex child process until the browser requests Codex bootstrap data.

At browser startup:

1. `public/app.js` reads `tab` and `range` from the URL.
2. It fetches `/api/state`, which reads and validates the store and computes a
   fresh view model.
3. It defaults to the configured Projects tab when no URL override exists.
4. It opens `/api/events` for LifeOS and Codex updates.
5. It requests `/api/codex/bootstrap` asynchronously, so a Codex failure does
   not prevent the dashboard from rendering.
6. It restores the last selected LifeOS Codex task from browser `localStorage`,
   or selects the most recent workspace task.

`SIGINT` and `SIGTERM` close data watchers and event streams, stop the Codex
child process, and shut down the HTTP server.

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

The active store is a single JSON object. `schemaVersion` is currently 10, with
explicit compatibility migrations from versions 2 through 9; there is no
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

## 10. Local HTTP and event interface

`scripts/dev-server.mjs` exposes these loopback-only routes:

| Method and path | Purpose |
| --- | --- |
| `GET /api/state?range=week|month|quarter|year` | Return a newly derived dashboard state |
| `POST /api/log` | Create a time entry and return updated state |
| `POST /api/session/start` | Persist a running session and return updated state |
| `POST /api/session/stop` | Stop, log elapsed time, and return updated state |
| `POST /api/projects/status` | Move one project to one of the six workflow statuses |
| `POST /api/projects/delete` | Permanently remove one exact project while preserving its tracked-time history |
| `POST /api/tasks/create` | Create an Inbox/project root task or inherited-project subtask |
| `POST /api/tasks/update` | Update one task's title and multiline notes |
| `POST /api/tasks/trash` | Move one exact task and its descendants to recoverable Trash |
| `POST /api/tasks/restore` | Restore one trashed subtree and any trashed ancestors needed to make it reachable |
| `POST /api/tasks/delete` | Permanently delete one exact trashed task and its descendants |
| `POST /api/tasks/completion` | Complete a task and its descendants, or reopen one task |
| `POST /api/tasks/project` | Assign one root task tree to a project or Inbox |
| `POST /api/tasks/priority` | Set one task's priority to none, low, medium, or high |
| `POST /api/tasks/tags` | Replace one task's normalized, deduplicated tag set |
| `POST /api/tasks/schedule` | Set or clear one task's due date, start time, or duration |
| `POST /api/tasks/reorder` | Place one task among its siblings and optionally re-parent its subtree |
| `POST /api/tasks/duplicate` | Copy one task and its subtree directly after the original |
| `GET /api/books/search?q=...&page=...` | Perform one explicit, 20-result Open Library search page and return normalized temporary results plus pagination metadata |
| `POST /api/reading/books/import` | Enrich and persist one selected catalog result |
| `POST /api/reading/books/status` | Move one local book to another reading status |
| `POST /api/reading/books/reorder` | Position one book within a status or move it to an exact Kanban position |
| `POST /api/reading/books/tags` | Replace one local book's normalized tag set |
| `POST /api/reading/books/finished-date` | Set or clear the past date read for one finished book |
| `POST /api/reading/books/delete` | Permanently remove one exact local book by ID |
| `GET /api/events` | SSE stream for data and Codex updates; heartbeat every 20 seconds |
| `GET /api/codex/bootstrap` | Connect, read account, list workspace tasks, and return voice/pending-request state |
| `POST /api/codex/thread/start` | Start a new LifeOS-scoped Codex task |
| `POST /api/codex/thread/read` | Read a task with turns |
| `POST /api/codex/turn/start` | Send one text message to a task |
| `POST /api/codex/turn/interrupt` | Stop an in-progress turn |
| `POST /api/codex/request/respond` | Answer an approval or `request_user_input` request |

Request bodies are JSON and limited to 256 KiB. Known client validation errors
return 400; other errors return 500 with a JSON message. Static serving prevents
path traversal and falls back to `index.html` for extensionless browser paths.

There is no HTTP authentication, CSRF protection, TLS, or remote-access design.
Loopback binding is therefore a security boundary, not an incidental detail. Do
not change it to `0.0.0.0` without designing authentication and threat controls.

## 11. CLI contract

The CLI is the preferred path for ordinary Codex operations because it provides
a stable, compact interface without requiring source inspection.

```bash
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

The CLI currently supports focused project status changes, category assignment,
and exact deletion with preserved category history. It still has no project
creation/general editing, time-entry delete/edit, domain settings, import,
export, or restore command. Store-path overrides are runtime environment
configuration rather than persisted domain settings.

## 12. Browser interface and control state

The interface follows the selected **V2 Editorial** direction: warm paper,
serif masthead, thin rules, compact information, restrained domain color, and a
persistent Codex rail on wide screens. It becomes a single column with the rail
below the page on narrow screens.

### Tasks

- First-class navigation sits between Today and Projects while Projects remains
  the default first screen.
- A TickTick-inspired scope rail switches among All tasks, the Today and
  Next 7 days smart lists, Inbox, every project, every active tag in use,
  Completed, and Trash. Active scopes show only open, non-trashed work. Smart
  lists and tag scopes are derived in the browser from task due dates, status,
  and tags; they are never persisted. Non-default `taskScope` is URL state and
  supports browser history.
- Smart lists render one flat, dated list because a due-date horizon cuts across
  the hierarchy. Matching completed tasks remain available in a deliberately
  quiet native disclosure that is collapsed on every render. Completed and Trash
  keep a nested projection, treating a matching child as a local root whenever
  its parent belongs to another lifecycle scope.
- Quick add accepts a title, Inbox/project association, optional due date, and
  priority. The title also parses `#tag` and `!high|!medium|!low` tokens so a
  labelled task can be captured in one keystroke run.
- One task occupies one line. Title, tags, notes marker, subtree ratio, due
  state, and list all sit on that line; the checkbox is tinted by priority and a
  flag repeats it so priority is never carried by color alone. Compact and
  Comfortable densities are a stored view preference, not schema.
- Priority uses its own `--priority-high|medium|low` red/yellow/blue tokens
  rather than the `--critical`/`--attention`/`--accent` health colors, so a
  change to project-health semantics cannot silently restyle priority.
- The **View** popover holds group-by (none, priority, due date, list, tag),
  sort-by (custom order, priority, due date, title, date created), and density.
  Preferences persist in `localStorage` under
  `lifeos.tasks.view`, not in the portable store.
- Manual drag reordering is offered only under custom order with no grouping,
  because any other arrangement would discard the drop position. The View
  popover states which case is active.
- Dragging moves a row among its siblings, nests it under the row above when
  dragged right, or reassigns it when dropped on a sidebar list or tag. Depth is
  projected from the pointer's horizontal travel and clamped between the
  neighbours, exactly as the reading board projects its column drops.
- Every gesture has a non-gesture equivalent. Right-click, the row's `⋯` button,
  Shift+F10, and the Menu key all open the same context menu: due date, priority,
  open details, add subtask, move to list, tags, duplicate, and Move to Trash.
  Trashed work instead offers details, Restore, and Delete forever. Manual
  ordering is deliberately absent from that menu because dragging covers it;
  a focused row still reorders and indents with Control or Option and the arrow
  keys, which is the accessible path. Option is offered because macOS reserves
  Control-Arrow.
- Clicking a task row or its title opens a TickTick-inspired right detail sheet.
  Title and multiline notes are editable there; explicit Save, Command/Ctrl+Enter,
  and closing a dirty sheet all persist through the narrow task-update route.
  List, due date, priority, and tags are separate immediate controls, each on its
  own narrow route, so a metadata change never waits on a dirty text draft.
- The detail footer exposes recoverable Move to Trash. A named Cancel-first
  confirmation states how many descendants will move and explains 30-day
  retention. Trash details are read-only apart from Restore and a second,
  explicitly permanent Delete forever confirmation.
- Root list selects reassign the whole subtree. Child list labels are
  inherited and intentionally not independently editable.
- Each project card shows its task ratio when tasks exist. Project details show
  the same derived summary, a compact nested list, add/completion/subtask
  controls, and an **Open Tasks** route into the filtered workspace. The project
  panel is intentionally not reorderable; ordering belongs to the Tasks
  workspace.
- Multi-select bulk editing, saved custom filters, recurring-task behavior, and
  full scheduling details remain deliberately deferred.

### Projects

- Default first screen.
- The default List is the complete portfolio, grouped by workflow status; empty
  groups stay out of the normal page.
- One-click focus presets show All, Doing, Next up plus Doing, or Done. A custom
  filter combines any of the six statuses. The view and focus persist locally and
  are URL-backed for navigation.
- The List has no organize toggle. Every entry is always draggable, and the
  statuses missing from the resting page — empty groups plus groups filtered out
  of the current focus — are rendered as collapsed lanes that expand into drop
  targets once a drag actually begins, then collapse again when it ends. A latent
  lane carrying filtered-out projects says how many it is hiding instead of listing
  them, so the reveal is a fixed, predictable amount of movement. The grabbed card
  is pinned through both the expand and the collapse: the scroller absorbs the
  height change so the card stays under the pointer.
- Pressing a card is deliberately inert. The reveal is bound to pointer movement
  past a threshold that clears ordinary click drift — never to press duration —
  and a press that never becomes a drag does no DOM work at all, so click-to-open
  stays the plain, immediate behavior of a list entry. Escape cancels a drag in
  flight, and a Control + Left/Right keyboard move reveals the same lanes briefly
  so the destination is visible; that move now works without any mode.
- Dragging deliberately animates nothing that costs layout. The lanes reach full
  height in the frame the drag starts and the scroller absorbs that growth in the
  same frame, so only opacity and transform animate afterwards. Pointer events are
  coalesced into one `requestAnimationFrame` pass, because a pointer reports far
  more often than the screen redraws and both the drag preview and the drop hit
  test force layout. Drop targets must never move themselves under the cursor: a
  hovered lane changes tint and ring only, since a transform would shift its own
  hit box and make the highlight oscillate at boundaries. The release re-runs the
  hit test synchronously so a drop lands where the pointer is, not where the last
  frame drew it.
- The drag preview is the card lifted off the page, not a label trailing the
  cursor. It keeps the grab offset, so the point the pointer took hold of stays
  under the pointer, and its content box is sized and placed against the original's
  content box rather than its border box — the preview adds padding and a border
  that the list entry does not have. Its width is therefore the card's real width
  and never clamped, because a narrower preview rewraps the text and stops reading
  as the same card. A drag preview must also cancel its transitions: it is a clone,
  so it inherits the source card's `transform` transition, and its first transform
  then animates it in from the fixed origin at the top-left of the viewport and lags
  it behind the pointer for the rest of the drag.

### Version marker

- The masthead hangs a small build marker beside the wordmark, injected into
  `index.html` by the server from the newest mtime among the browser sources
  actually on disk. It exists so a stale window and a current one cannot report the
  same build; the app does not hot-reload browser source, so **LifeOS Dev → Refresh
  LifeOS** is what advances it.
- The alternate Kanban shows exactly Next up, Doing, and Done; To-do and Dropped
  remain available in the list and project detail without cluttering the board;
  Paused is likewise deliberately absent.
- List entries and board cards open the same project detail overlay. The detail
  status control exposes all six statuses and describes their meaning.
- Reusable categories appear as compact labels on project cards and details.
- Task counts on cards and the task panel in project details come from the
  shared task collection; projects do not embed their own task arrays.
- Status moves are optimistic and roll back if persistence fails. When a detail
  change moves a project outside the active List focus, the detail explains why
  and a recovery message offers both Show and Undo.
- Every project detail view has a compact Codex control that attaches the exact
  project snapshot to the rail composer without sending it.
- Project deletion appears only in the open detail and requires a named warning.
  The browser route automatically retains tracked time as category-only history;
  deletion is rejected while the project backs the active challenge.
- Health, last touch, current-week hours, due distance, streak, and progress are
  computed or sourced from the active store.

### Today

- Shows granular entries for the configured local date.
- Shows total against `defaultDailyPlanHours`.
- Recommendation controls: alternate, dismiss for this visit, restore, and
  begin.
- Begin persists `activeSession`; stop creates a real elapsed entry.
- There is no generic manual-log form or entry editing yet.

### Reading

- Kanban shows exactly Next up, Reading, and Finished; To read and Dropped are
  intentionally absent. Finished is labeled with the configured current year
  and includes only books whose Date read falls in that year.
- Library shows all books with five status filters, a tag filter, and a local
  text filter. Every visible column heading sorts its field and toggles between
  ascending and descending order; unavailable values remain last.
- Both views show covers and open the same detail overlay with description,
  identifiers, edition metadata, and catalog attribution.
- Both views display tags. The detail overlay adds or removes tags and places
  permanent deletion behind a warning that names the book and describes the
  removed local data.
- Finished Library rows and finished-book details show an editable Date read
  field backed by `finishedAt`; changing it persists through a narrow validated
  route and the same atomic store-write path as other Reading mutations.
- Compact Kanban cards use pointer dragging to change status and exact queue
  position, with Control + Arrow keys as the keyboard equivalent. Visible
  status selects remain in Library and book details, where the column context
  is absent. These changes persist through narrow routes and atomic store writes.
- Every book detail view has a compact Codex control that attaches the exact
  book record to the rail composer without sending it.
- Catalog search occurs only on explicit submission. ISBN-shaped input becomes
  an exact ISBN query; title and author searches retain relevance ordering. The
  first 20 normalized results are shown with total-match context, and each next
  20-result page requires an explicit Load more action. Optional work
  descriptions are fetched best-effort, and only a selected book is stored.
- Search results use remote medium-size previews. A saved Open Library book is
  served through a same-origin URL that downloads the medium cover at most once,
  stores it in `reading-covers/` beside the active JSON store, and returns it with
  immutable browser-cache headers. Missing covers receive a local typographic
  fallback. Once cached, saved covers and records remain available offline.

### Analytics

- Range controls update both URL state and derived backend state.
- Week, month, quarter, and year use the same source entries.
- Charts are HTML/CSS generated; there is no charting dependency.

### Almanac

- Read-only streak, challenge, and milestone presentation.
- There is no search, filtering, creation, or edit workflow.

### Browser-local state

- `tab`, non-default analytics `range`, non-default Projects `projectView`,
  non-default Reading `view`, and non-default Tasks `taskScope` live in the query
  string and support browser history.
- Recommendation dismissal and rotation are in-memory and reset on reload.
- The last selected Codex task ID is stored under
  `lifeos.codex.threadId` in `localStorage`.
- `Command/Ctrl + K` focuses the chat field.

Most user-visible record and Codex text is passed through the browser's HTML or
attribute escaping helpers. This has not had a formal security audit, and a few
locally sourced values are interpolated into attributes or inline CSS. Treat all
store, URL, and protocol values as untrusted when adding controls; validate to a
known set where possible and escape for the exact output context.

## 13. Codex rail

### Non-negotiable transport decision

The rail is a front end to the user's installed Codex application and current
ChatGPT account. It is not an API-based chatbot.

Never add:

- an OpenAI API key or direct OpenAI API call;
- an SDK client as an alternate transport;
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

### Node 20 and web standards

Node supplies filesystem, HTTP, process, and test primitives across macOS,
Linux, and Windows. Vanilla HTML/CSS/JavaScript avoids a package install, bundle
step, framework churn, and unnecessary application weight.

Tradeoff: `public/app.js` and `public/styles.css` are already large single files.
They are acceptable for the present scope, but should be split by responsibility
when management workflows materially increase complexity—not merely to imitate
a framework structure.

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

### Stable CLI for Codex

Routine operation should cost a few concise commands, not repeated codebase
exploration. The CLI is therefore both a human interface and a context-control
mechanism for the Codex rail.

### Server-Sent Events

LifeOS needs one-way local notifications for file and Codex events. SSE is
built into browsers, simple to reconnect, and lighter than a WebSocket stack.
Mutations remain ordinary HTTP requests.

### Installed Codex app-server

App-server provides the user's current account, persistent tasks, tool activity,
approvals, and workspace semantics. It satisfies the requirement that LifeOS be
only a front end to Codex and avoids separate credentials and billing.

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

1. Read with a CLI command, using `--json` when useful.
2. Log through `lifeos log` or the session commands.
3. Do not inspect or edit browser code for an ordinary log/stat/recommendation
   request.
4. Confirm the concrete result with a read command.

### Changing a derived statistic

1. Define the source facts and period semantics.
2. Implement the calculation in `src/lifeos-data.mjs`.
3. Return it from `buildState`; do not compute a conflicting copy in the UI.
4. Add a deterministic test proving both the baseline and sensitivity to a
   source-entry change.
5. Render the returned field in `public/app.js`.
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

### Adding a browser control

1. Decide whether it is ephemeral UI state or persisted domain state.
2. For persistence, expose a narrow server/data operation rather than writing
   files from the browser.
3. Disable the control while its request is active.
4. Render a useful inline error on failure.
5. Ensure data changes flow back through `buildState` and the SSE refresh path.
6. Verify keyboard behavior, narrow layouts, and empty states.

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
6. Extend both data tests and `tests/tasks-ui.test.mjs`, then exercise the live
   Tasks and project-detail flows with an isolated `LIFEOS_DATA_DIR` copy.
7. Treat any future calendar connector as an export boundary; local task writes
   must succeed independently of calendar availability.

### Changing the Codex bridge

1. Preserve installed-app and ChatGPT-account authentication.
2. Check the live app-server protocol rather than guessing method shapes.
3. Keep workspace roots and approval routing explicit.
4. Add protocol tests for each new message type.
5. Test reconnect, interruption, and pending-request behavior.
6. Never make voice appear available without a verified no-API path.

### Before every commit

1. Run `git status --short --branch` and identify user-owned/unrelated changes.
2. Run `npm run check`.
3. Inspect the exact diff.
4. Stage only explicit reviewed paths; never use broad staging in a mixed tree.
5. Scan staged content for secrets, tokens, credentials, private paths, and
   personal data.
6. Confirm `.bak`, `.lock`, temporary, and browser-test artifacts are absent.
7. Use a `codex/` branch for new implementation work unless the user directs a
   different Git workflow.

## 17. Verification contract

The single verification command is:

```bash
npm run check
```

It performs JavaScript syntax checks for the browser, server, data/storage
modules, Codex bridge, CLI, and desktop launcher; runs Node's built-in test
suite; then compile-checks the pinned Tauri shell.

At this handoff, the suite contains 79 tests covering:

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
- Tasks workspace scopes, nested/progress rendering, native non-gesture
  controls, editable detail/deletion rendering, and project-detail task integration;
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
- the intentional voice-disabled boundary.

Automated coverage does **not** yet include:

- HTTP route integration;
- browser rendering and interaction end-to-end tests;
- SSE reconnect/file-watcher behavior;
- a live signed-in Codex conversation;
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

- Create projects or edit fields beyond workflow status.
- Browse, correct, or recoverably delete individual time entries.
- Manually edit imported reading metadata beyond tags and Date read.
- Create/edit domains, settings, challenges, or milestones in the UI.
- Expose task start time/duration, define recurrence, add bulk task editing, or
  synchronize tasks with an external calendar.
- Import/export UI and validation report.
- Searchable or filterable Almanac.
- Goals and richer deadline management.

### Technical limitations

- Validation is partial; only the focused version-2-through-9 compatibility steps
  are implemented, not a general migration framework.
- Daily/monthly JSON snapshots provide history but not cross-device merge or
  immutable disaster recovery.
- Timers crossing midnight are logged as one entry on the start date.
- The file watcher observes the active filename only and is intentionally
  process-local.
- HTTP endpoints trust local callers and must remain loopback-only.
- Catalog search, temporary cover previews, and the first load of an uncached
  saved cover require internet access. Cached saved covers, reading records, and
  typographic fallbacks remain available offline.
- The Codex protocol may drift with installed application updates.
- Browser and server layers lack automated end-to-end coverage.
- Reading and Tasks rendering/styles are separated, but `public/app.js` still
  owns their event orchestration and will become a bottleneck if several more
  CRUD workflows are added without measured modularization.
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
6. Add project management.
7. Add recoverable time-entry management.
8. Add settings, goals, milestone/challenge editing, import/export, and Almanac
   search.
9. Replace the source-backed shell with a self-contained sidecar and add
   notarized distribution only after those workflows stabilize.

The first incoming agent should not begin by redesigning the interface or adding
a database. It should make the real-data transition safe, then let the real
records determine the next structural change.

## 20. Incoming-agent checklist

Use the items relevant to the task; ordinary CLI operations and small edits do
not require the full implementation checklist:

- [ ] Read `AGENTS.md` and the relevant sections of this file.
- [ ] Check Git status and preserve unrelated/user changes.
- [ ] Confirm whether the Application Support store is still demo-derived or now contains private real data.
- [ ] Do not run `demo:reset` when real data is present.
- [ ] Use the CLI first for ordinary operations.
- [ ] Start through `/Applications/LifeOS Dev.app`, `npm run desktop:dev`, or
      `npm run dev`; never use `file://`.
- [ ] Keep visible numbers derived from source records.
- [ ] Keep task trees in `tasks.items[]`; preserve hierarchy/project invariants
      and derive subtree/project progress.
- [ ] Keep calendar integration absent or one-way from LifeOS until explicit
      synchronization semantics are designed and requested.
- [ ] Keep Codex on installed app-server and the signed-in account only.
- [ ] Keep approvals and user questions visible to the user.
- [ ] Keep voice disabled unless the exact permitted capability is verified.
- [ ] Preserve V2 Editorial and the default useful Projects screen.
- [ ] Run checks for the changed behavior and proportionate live/browser checks;
      run `npm run check` before committing.
- [ ] Review and privacy-scan explicit staged paths before any commit or push.
- [ ] Update this document if the state or architecture changes materially.

## 21. Definition of a trustworthy LifeOS change

A change is complete only when:

- persisted facts have one clear source of truth;
- every displayed result is derived reproducibly;
- writes are validated and recoverable in proportion to their risk;
- the CLI and Codex fast path remain concise;
- no API-key or alternate-model dependency has entered the rail;
- errors and approvals remain visible rather than silently handled;
- demo and personal data are not confused;
- the current checks pass;
- documentation states what is still incomplete without presenting a
  placeholder as a workflow.
