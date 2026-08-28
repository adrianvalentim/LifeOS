# LifeOS Agent Guide

LifeOS is designed to be operated and modified by Codex. For ordinary logging and questions, use the stable CLI first. Inspect source only when the user asks for an implementation or schema change.

For implementation work, read [`PROJECT_STATE.md`](PROJECT_STATE.md) first. It is the canonical detailed handoff for current architecture, decisions, maintenance, limitations, and the ordered next phase.

## Fast path

```bash
npm run lifeos -- projects --health
npm run lifeos -- tasks --project "Portia"
npm run lifeos -- tasks add --title "Draft Act III" --project "Portia" --priority high --tag writing
npm run lifeos -- tasks complete --task "Draft Act III"
npm run lifeos -- tasks priority --task "Draft Act III" --priority medium
npm run lifeos -- tasks tag --task "Draft Act III" --tag writing --tag "deep work"
npm run lifeos -- stats --range week
npm run lifeos -- stats --category "Infinitamente" --range year
npm run lifeos -- recommend
npm run lifeos -- log --project "Vulcano" --duration 180 --type creative --desc "Edited eclipse sequence"
npm run lifeos -- session start --project "Portia" --type creative --desc "Draft Act III"
npm run lifeos -- session stop
npm run lifeos -- storage status
npm run check
```

Use `--json` on read commands when structured output helps. Do not inspect the browser code before an ordinary log, stats, or recommendation request.

## Project map

- `PROJECT_STATE.md` — canonical detailed project-state and maintainer handoff; read before implementation work.
- `~/Library/Application Support/LifeOS/lifeos.json` on macOS — active personal store; `LIFEOS_DATA_DIR` overrides the platform default.
- `data/lifeos.json` — legacy demo-derived seed retained only for safe first-run migration; do not write personal data here.
- `data/lifeos.demo.json` — deterministic demonstration snapshot; never replace it with private data.
- `src/lifeos-data.mjs` — validation, atomic persistence, derived statistics, project health, recommendations, and timers.
- `src/lifeos-storage.mjs` — platform data paths, first-run migration, Google Drive snapshot configuration, and backup status.
- `src/book-catalog.mjs` — dependency-free Open Library search normalization and optional work-detail enrichment; no API key.
- `src/book-cover-cache.mjs` — bounded medium-cover cache for saved Open Library books; files live beside the active store and are removed with their book.
- `src/codex-app-server.mjs` — local bridge to the installed Codex app server and signed-in ChatGPT account. Never add API-key authentication.
- `cli/lifeos.mjs` — preferred operational interface for Codex.
- `scripts/dev-server.mjs` — dependency-free web server, JSON routes, live refresh, and Codex relay.
- `src-tauri/` — source-backed Tauri development shell; it starts the repository's Node server and opens its loopback URL in WKWebView.
- `public/` — V2 Editorial browser UI.
- `public/tasks.js` and `public/tasks.css` — Tasks workspace, nested task tree, context menu, grouping/sorting view options, and project-detail task controls.
- `scripts/create-demo-data.mjs` — generates both demo files; `--write-active` overwrites the active store.
- `design plan/` — original visual references; do not revise unless asked.

## Data rules

- Use `lifeos log` for time entries whenever possible.
- Omit the project only for truly general inbox/admin work.
- `activityType` is one of `deep_work`, `shallow_work`, `admin`, `research`, `creative`, or `communication`.
- Preserve the user's original language in `rawInput`.
- Never silently map an unknown explicit project to general work; ask or report the match error.
- Visible statistics must be derived from source entries. Do not add display-only totals or hardcode dashboard numbers.
- Project statuses are `to_do`, `next_up`, `doing`, `done`, or `dropped`; the Projects Kanban intentionally shows only `next_up`, `doing`, and `done`, while the list and project detail keep all five reachable.
- Project categories are reusable many-to-many labels referenced by stable category IDs. Category analytics includes current project membership plus category-only history preserved when a project is deleted.
- Tasks live in one `tasks.items[]` collection. A task can be in Inbox or reference one project; subtasks inherit the project of their parent. Completing a parent completes its descendants, while adding a subtask reopens completed ancestors. Task notes are multiline text stored on the task. Deleting a task removes its subtree, while deleting a project moves its task tree to Inbox rather than deleting it.
- Task priority is exactly `none`, `low`, `medium`, or `high`. Task tags are free-form labels normalized and deduplicated case-insensitively, at most 12 per task, following the reading-tag rules.
- `sortOrder` is the manual sibling order and is deliberately independent of status, so reopening a task never reshuffles it. Re-parenting carries the whole subtree into the new parent's project and rejects nesting a task under its own descendant.
- Task grouping, sorting, smart lists (Today, Next 7 days), tag scopes, and their counts are derived in the browser from priority, tags, due date, and status. Never persist a group, a smart-list membership, or a tag index. Tasks view preferences live in `localStorage`, never in the portable store.
- Task progress is derived from task status across each subtree or project; never persist a second progress total. The schedule envelope reserves due date, optional start time, duration, and recurrence, but recurrence and calendar synchronization are not implemented.
- Keep the personal store outside Git. Cloud snapshots are secondary copies and must never become the live store.
- Google Drive backup must be configured to one explicit folder; do not guess between accounts. Backup failure must not invalidate a successful local write.
- Reading statuses are `to_read`, `next_up`, `reading`, `finished`, or `dropped`; Kanban intentionally includes only `next_up`, `reading`, and `finished`, with Finished projected to the configured current calendar year by `finishedAt`.
- `finishedAt` is the persisted date-read source. It can be corrected only for a finished book, and the supported route rejects future dates.
- Reading tags are free-form display labels normalized and deduplicated case-insensitively. Permanent deletion must target one exact book ID and remain behind a confirmation that names the book.
- Treat the active store's `.bak` file as recovery state, not source data, and never commit it.
- Cache covers only for saved books. Keep the original remote URL in book metadata, use the adjacent `reading-covers/` directory for regenerable image files, and do not duplicate those files into every JSON snapshot.

## Codex rail rules

- The installed `codex app-server` process is the only AI transport.
- Use the signed-in ChatGPT account. Do not use the OpenAI API, API keys, an SDK client, Ollama, Whisper, or another model.
- Keep the rail scoped to this absolute workspace so tasks share the right context.
- Desktop Codex dictation is not currently exposed through app-server for ChatGPT-account clients. Keep voice disabled unless that changes; never substitute an API key, browser speech service, Whisper, Ollama, or another model.
- Route approvals and `request_user_input` to the rail instead of auto-accepting them.

## Design and scope

- Preserve V2 Editorial: warm paper, serif masthead, thin rules, compact information, persistent right Codex rail.
- Default to Projects and keep the first screen useful.
- A source-backed macOS development app is implemented; self-contained distribution, notarization, updates, and Windows/Linux packaging remain deferred.
- The development app intentionally depends on this workspace and an installed Node runtime so browser changes remain immediately refreshable.
- In the installed app, **LifeOS Dev → Refresh LifeOS** (`Command-R`) restarts the workspace Node server and reloads the current route; use it for browser or backend source changes instead of quitting the app.

## Before committing

Run `npm run check`, inspect the exact diff, stage explicit reviewed paths, and scan staged content for secrets or private data. The repository is intended to remain private, but that is not a reason to commit credentials.
