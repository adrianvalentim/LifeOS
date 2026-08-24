# LifeOS project state and maintainer handoff

> Canonical implementation handoff for agents and maintainers. Read this after
> [`AGENTS.md`](AGENTS.md) and before making a structural change.

- Last updated: 2026-08-24
- Implementation baseline: `main`, including the storage, Projects, Reading, and
  source-backed Tauri work described here
- Remote: `adrianvalentim/LifeOS`, public, default branch `main`

## 1. Executive summary

LifeOS is a local, single-user personal almanac. It is meant to reduce the cost
of coordinating many concurrent projects and a personal reading queue by
answering four questions:

1. Where is my time going?
2. What is the state of my projects?
3. What should I do next?
4. What am I reading now and next?

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
| Project dashboard | Implemented | Clickable two-column list plus a three-column drag Kanban, reusable category labels, five persistent workflow statuses, computed health, last touch, weekly hours, deadline, progress, and streak |
| Today | Implemented foundation | Computed daily entries and total, recommendation selection, real start/stop timer |
| Analytics | Implemented foundation | Week/month/quarter/year totals, domain allocation, rhythm heatmap, trends, composition, production/consumption, deep-work counts |
| Almanac | Read-only foundation | Computed streaks, current challenge, and configured milestones |
| Reading | Implemented foundation | Cover-led Kanban, complete five-status library, tags and tag filtering, details, Open Library search/import, status movement, queue ordering, and confirmed permanent deletion |
| Data source | Implemented, demo-derived | macOS Application Support contains the active copy seeded from the legacy demo-derived store; `data/lifeos.demo.json` remains deterministic |
| Persistence | Implemented | Validation, short cross-process lock, atomic replacement, one local `.bak`, and optional latest/daily/monthly Google Drive snapshots |
| CLI | Implemented | Read projects/stats/recommendation, log time, start/stop/status a timer, and configure/inspect cloud snapshots |
| Codex rail | Implemented | Current ChatGPT account, workspace-scoped tasks, streaming items, stop, approvals, and user questions |
| Voice | Intentionally unavailable | Installed app-server does not expose desktop dictation under subscription authentication; no fallback is allowed |
| Full management UI | Deferred | No project CRUD, time-entry edit/delete, settings UI, imports/exports, or almanac search |
| Native desktop app | Development shell implemented | `/Applications/LifeOS Dev.app` is source-backed, ad-hoc signed, starts/stops the current Node service, and can refresh that service in place from its app menu; self-contained distribution is deferred |

The public repository does not record the current personal-store contents,
backup destination, Codex account, or Codex task history. Its deterministic
demo snapshot is the only publishable data baseline. Inspect the active store
locally when maintenance depends on its current state; do not copy that snapshot
into this handoff.

The directed Reading feature is now part of the foundation. The next broad
product step is still **not** generic feature expansion. It is to safely move
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
  |-- state/log/session routes ----------> src/lifeos-data.mjs
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
| `src/lifeos-data.mjs` | Schema checks, date helpers, writes, logs, timer, calculations, health, and recommendations |
| `src/lifeos-storage.mjs` | Platform paths, first-run migration, Drive discovery/configuration, snapshot writing, and backup status |
| `src/book-catalog.mjs` | Open Library search, normalized metadata and covers, and best-effort work-detail enrichment |
| `src/book-cover-cache.mjs` | Bounded medium-size local cover caching for saved Open Library books |
| `src/codex-app-server.mjs` | JSON-RPC bridge to the installed Codex executable |
| `cli/lifeos.mjs` | Stable, token-efficient operational interface for Codex and humans |
| `scripts/dev-server.mjs` | Local static server, JSON routes, SSE, file watcher, and Codex relay |
| `scripts/desktop.mjs` | Cross-platform Tauri command wrapper and APFS cache target selection for macOS builds |
| `scripts/create-demo-data.mjs` | Deterministically generates demo data; can intentionally reset the active store |
| `public/index.html` | Minimal browser entry point |
| `public/app.js` | All browser state, rendering, controls, API calls, and streamed Codex item handling |
| `public/reading.js` | Reading Kanban/library rendering and catalog/detail presentation |
| `public/styles.css` | V2 Editorial visual system and responsive layouts |
| `public/reading.css` | Cover-led Reading workspace, database rows, Kanban cards, and detail overlay |
| `tests/lifeos-data.test.mjs` | Data derivation, range, write safety, project matching, timer, and timezone tests |
| `tests/lifeos-storage.test.mjs` | Platform data paths, Google Drive root discovery, and versioned snapshot tests |
| `tests/book-catalog.test.mjs` | Open Library normalization, bounded search, enrichment, and offline-fallback tests |
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

## 7. Persisted data model

The active store is a single JSON object. `schemaVersion` is currently 6, with
explicit compatibility migrations from versions 2, 3, 4, and 5; there is no general
migration framework yet.

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
- `status`, one of `to_do`, `next_up`, `doing`, `done`, or `dropped`; the first
  three count toward active/critical summaries and recommendations;
- numeric `priority`;
- `plannedHours` for the current week;
- `deadline` as `YYYY-MM-DD` or `null`;
- `progress` as a 0–1 fraction or `null`;
- `createdAt`;
- optional `statusChangedAt`, updated by supported status moves;
- optional `nextAction`, which overrides generated recommendation wording.

Health, risk, last touch, weekly hours, due days, streak, and eight-week history
are derived. Do not persist them as parallel display fields.

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
errors, but it is not a complete JSON Schema. It validates project and reading
status values, reading identifiers, ordering, tags, and any `finishedAt`
timestamp, but does not yet enforce every optional field, ISO date formatting,
positive durations in files edited by hand, or progress bounds.
`createTimeEntry` does enforce positive duration for supported write paths.

Reads migrate schema version 2 stores in memory by adding an empty Reading
collection, migrate version 3 books by adding empty tag arrays, migrate legacy
project statuses into the five-state workflow, and migrate version 5 by adding
the category registry and category reference arrays before advancing to version
6. The migrated shape is persisted on the next supported write. Any
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
| `POST /api/projects/status` | Move one project to one of the five workflow statuses |
| `GET /api/books/search?q=...` | Perform one explicit, bounded Open Library search and return normalized temporary results |
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

### Projects

- Default first screen.
- The original two-column list remains the default and includes every project.
- The alternate Kanban shows exactly Next up, Doing, and Done; To-do and Dropped
  remain available in the list and project detail without cluttering the board.
- List entries and board cards open the same project detail overlay. The detail
  status control exposes all five statuses.
- Reusable categories appear as compact labels on project cards and details.
- Kanban cards use pointer dragging between columns, with Control + Left/Right as
  the keyboard equivalent. Moves are optimistic and roll back if persistence fails.
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
- Catalog search occurs only on explicit submission. Open Library responses are
  normalized server-side, optional work descriptions are fetched best-effort,
  and only a selected book is stored.
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

- `tab`, non-default analytics `range`, non-default Projects `projectView`, and
  non-default Reading `view` live in the query string and support browser history.
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

### Open Library as lookup, not source of truth

Open Library requires no API key and fits this personal, human-initiated search
volume. LifeOS submits only an explicit title/author/ISBN query, requests a
bounded result set, and stores only the normalized book the user selects. The
provider is never treated as the application database. Result completeness is
allowed to vary, work-detail enrichment is best-effort, and cover failures have
a local visual fallback.

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
deterministic projects, granular sessions, weekly history aggregates, a
challenge, milestones, and an 11-book public-safe reading library spanning all
five statuses. `LIFEOS_DEMO_DATE` can anchor a regenerated demo to a different
date.

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
4. Map them into schema version 6 without inventing unsupported certainty.
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

At this handoff, the suite contains 42 tests covering:

- duration parsing;
- demo-derived totals and recommendation;
- sensitivity of totals/composition to a new entry;
- shared-source date ranges;
- rejection of an explicit unknown project;
- backup and lock cleanup;
- macOS/Windows/Linux personal-data path resolution;
- macOS Google Drive root discovery without automatic account selection;
- validated latest/daily/monthly snapshot creation and configured-timezone dates;
- timer-to-entry behavior;
- configured-timezone calendar boundaries;
- version-2/3/4/5-to-6 reading/project/category migration and invalid-reference rejection;
- reusable project categories, derived category totals, and history-preserving
  project deletion;
- five-status project movement, active/recommendation derivation, and Projects
  list/Kanban projection;
- reading add/deduplication, status movement, derived counts, queue order,
  normalized tags, exact permanent deletion, manual Date read editing, and the
  configured-timezone current-year Finished projection;
- Open Library result normalization, bounded queries, description enrichment,
  and an offline fallback;
- saved-cover medium-image selection, bounded local reuse, deletion cleanup,
  and saved-versus-temporary cover rendering;
- macOS, Windows, and portable Codex executable lookup;
- approval exposure to the browser bridge;
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
a manual browser/live integration check. A docs-only change still runs the
standard check to catch repository drift.

## 18. Known limitations and deliberate deferrals

### Must be addressed before real-data migration

- Configure and verify one explicit backup destination; LifeOS intentionally
  does not guess between accounts.
- Complete a careful real-data field inventory and import mapping.

### Product workflows not built

- Create projects, edit fields beyond workflow status, or delete projects.
- Browse, correct, or recoverably delete individual time entries.
- Manually edit imported reading metadata beyond tags and Date read.
- Create/edit domains, settings, challenges, or milestones in the UI.
- Import/export UI and validation report.
- Searchable or filterable Almanac.
- Goals and richer deadline management.

### Technical limitations

- Validation is partial; only the focused version-2/3/4/5-to-6 migrations are
  implemented, not a general migration framework.
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
- Reading rendering and styles are separated, but `public/app.js` still owns its
  event orchestration and will become a bottleneck if several more CRUD
  workflows are added without measured modularization.
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
5. Add project management.
6. Add recoverable time-entry management.
7. Add settings, goals, milestone/challenge editing, import/export, and Almanac
   search.
8. Replace the source-backed shell with a self-contained sidecar and add
   notarized distribution only after those workflows stabilize.

The first incoming agent should not begin by redesigning the interface or adding
a database. It should make the real-data transition safe, then let the real
records determine the next structural change.

## 20. Incoming-agent checklist

Before doing work:

- [ ] Read `AGENTS.md` and this file.
- [ ] Check Git status and preserve unrelated/user changes.
- [ ] Confirm whether the Application Support store is still demo-derived or now contains private real data.
- [ ] Do not run `demo:reset` when real data is present.
- [ ] Use the CLI first for ordinary operations.
- [ ] Start through `/Applications/LifeOS Dev.app`, `npm run desktop:dev`, or
      `npm run dev`; never use `file://`.
- [ ] Keep visible numbers derived from source records.
- [ ] Keep Codex on installed app-server and the signed-in account only.
- [ ] Keep approvals and user questions visible to the user.
- [ ] Keep voice disabled unless the exact permitted capability is verified.
- [ ] Preserve V2 Editorial and the default useful Projects screen.
- [ ] Run `npm run check` and proportionate live/browser checks.
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
