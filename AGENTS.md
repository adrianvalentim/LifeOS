# LifeOS Agent Guide

LifeOS is a local-first personal almanac operated and modified by its owner and by agents (Codex, Claude Code, any MCP client). Preserve reliable personal records, reproducible statistics, and the V2 Editorial interface.

## Read what the task needs

Use the command layer for ordinary work — the `lifeos` MCP server, `lifeos run <command>`, or the focused CLI verbs below. Read source when implementation, bug investigation, or a schema change needs it.

[`PROJECT_STATE.md`](PROJECT_STATE.md) is the canonical detailed handoff. Use its relevant sections; small fixes and documentation edits do not require the whole handoff or repository map.

| Work | Context |
| --- | --- |
| CLI, MCP, SDK operations | [Command layer](PROJECT_STATE.md#10-command-layer-local-http-and-events), [CLI contract](PROJECT_STATE.md#11-cli-contract) |
| Schema, statistics, or tasks | [Persisted model](PROJECT_STATE.md#7-persisted-data-model), [calculations](PROJECT_STATE.md#8-derived-calculations), relevant [maintenance workflow](PROJECT_STATE.md#16-maintenance-workflows) |
| Storage, backups, or imports | [Persistence](PROJECT_STATE.md#9-persistence-and-recovery), [private-data transition](PROJECT_STATE.md#15-demo-data-and-the-transition-to-real-data) |
| UI or desktop | [Browser contracts](PROJECT_STATE.md#12-browser-interface-and-control-state), [startup and refresh](PROJECT_STATE.md#6-starting-and-stopping-the-system) |
| Codex or Claude bridge | [Agent rail](PROJECT_STATE.md#13-agent-rail) |
| Structural or roadmap changes | [Architecture](PROJECT_STATE.md#4-architecture), [rationale](PROJECT_STATE.md#14-why-these-development-decisions-were-made), [limitations](PROJECT_STATE.md#18-known-limitations-and-deliberate-deferrals), [next phase](PROJECT_STATE.md#19-recommended-next-implementation-order) |

## CLI fast path

```bash
npm run lifeos -- overview                     # today, timer, health, overdue tasks
npm run lifeos -- commands                     # every command; `describe <name>` shows its schema
npm run lifeos -- run tasks.create --title "Draft Act III" --projectId portia --priority high --tags writing
npm run lifeos -- run time.log --durationMinutes 180 --projectId vulcano --activityType creative --description "Edited eclipse sequence"
npm run lifeos -- run ui.navigate --to /projects/portia   # drives the open window
npm run lifeos -- activity                     # recent changes; `undo [operationId]` reverts one
npm run lifeos -- projects --health
npm run lifeos -- stats --range week
```

MCP clients use `node scripts/lifeos-mcp.mjs` (this folder's `.mcp.json` registers it). Use `--json` on reads when useful and verify writes with a focused read. Preserve the user's language in `rawInput`. Omit a project only for general inbox/admin work; report an unknown explicit project instead of silently logging general work. Activity types are `deep_work`, `shallow_work`, `admin`, `research`, `creative`, and `communication`.

## Personal data boundaries

- The active macOS store is `~/Library/Application Support/LifeOS/lifeos.json`, overridden by `LIFEOS_DATA_DIR`. Keep personal data, backup destinations, credentials, and recovery files outside Git.
- `data/lifeos.json` is a legacy migration seed; `data/lifeos.demo.json` is the deterministic demo fixture. Neither is a destination for private data. `npm run demo:reset` and the generator's `--write-active` overwrite the active store; never use them on real data.
- Prefer supported CLI/routes and validated, atomic writes. Preserve concurrent edits. The active `.bak` is recovery state, not a second source of truth.
- Google Drive snapshots are secondary copies to one explicitly selected folder; do not guess between accounts. Backup failure must not invalidate a successful local write.
- Use an isolated `LIFEOS_DATA_DIR` with disposable fixtures for write-oriented UI checks. Routine development does not authorize changes to the user's records.

## One command layer

Every capability is one command in `src/commands/` with a zod input schema. The same command serves the UI (`POST /api/run/<name>`), CLI, SDK (`src/sdk.mjs`), HTTP and MCP, so agents can do everything the person can. Add new capabilities as commands, never as one-off routes or UI-only logic. Store writes go through `mutateStore`, which journals exact before/after patches for undo and Activity; never write the store another way. Workspace arrangement (start screen, theme, sidebar, saved views, pins) lives in the `lifeos.json.workspace.json` sidecar and is changed through `workspace.*`, `views.*` and `pins.set`.

## Domain contracts

Before changing a feature, read its detailed model and browser contracts linked above. Preserve these boundaries:

- Statistics derive from source entries; task progress derives from non-trashed task status. Never persist parallel totals or hardcode display numbers.
- Projects retain six statuses (`to_do`, `next_up`, `doing`, `paused`, `done`, `dropped`), with Kanban projecting only `next_up`, `doing`, and `done`. Paused work stays out of active summaries/recommendations. Categories remain reusable many-to-many labels with stable IDs; project deletion preserves category-only history and moves its task tree to Inbox.
- Tasks share `tasks.items[]`. Preserve acyclic same-project subtrees, completion/reopening cascades, multiline notes, and status-independent manual `sortOrder`. Re-parenting moves the whole subtree into the new parent's project. Deletion uses recoverable subtree Trash (`trashedAt`); restoration preserves identity/content, and cleanup permanently prunes after 30 days.
- Task priorities remain `none`, `low`, `medium`, or `high`; tags are normalized and deduplicated case-insensitively, at most 12 per task. Groups, smart lists, tag counts, and progress are derived; view preferences stay in `localStorage`. Preserve Completed and dated-list behavior. The schedule envelope reserves due date, start time, duration, and recurrence; recurrence and calendar synchronization remain unimplemented.
- Reading retains five statuses (`to_read`, `next_up`, `reading`, `finished`, `dropped`); Kanban projects `next_up`, `reading`, and the configured current year's finished books. `finishedAt` is the date-read source, editable only for finished books with future dates rejected. Tags are normalized and deduplicated case-insensitively. Permanent deletion requires an exact book ID and a confirmation naming the book.
- Creation stores ideas in `creation.ideas[]` with five workflow statuses, Markdown and flexible types. Dated Shorts create one linked task through the shared transaction; preserve task identity, subtree/Trash semantics and conflict checks. Keep scripts out of task notes/cloud documents, and preserve editor drafts on failed saves.
- Cache covers only for saved books in adjacent `reading-covers/`; preserve original remote URLs, remove cached files with their book, and keep regenerable images out of JSON snapshots.

## Agent rail and product boundaries

- The rail's only AI transports are installed, signed-in applications: `codex app-server` with the ChatGPT account, and the `claude` CLI (Claude Code) with the person's Claude login. Do not add API-key authentication, an API SDK client, Ollama, Whisper, or an alternate model service.
- Scope the rail to this absolute workspace. Route approvals, permission prompts, `request_user_input` and Claude's questions to the person through the rail; never auto-accept them. Claude rail sessions run with `--permission-mode manual` and pre-allow only the journaled LifeOS MCP tools.
- Voice stays disabled until a verified path exists through the signed-in apps. Do not substitute browser speech services or another transport.
- Preserve V2 Editorial: warm paper and ink themes, serif display type, thin rules, compact information, and the persistent right agent rail. The start screen is configurable and defaults to Projects. Preserve `design plan/` originals unless revision is requested.
- Keep HTTP loopback-only. The macOS development app depends on this workspace and Node; self-contained distribution, notarization, updates, and Windows/Linux packaging remain deferred.
- For installed-app browser/backend changes, **LifeOS Dev → Refresh LifeOS** (`Command-R`) restarts the workspace server and reloads the current route. Use that refresh to inspect changes.

## Completion and verification

Carry the requested change through implementation, relevant verification, and fixes for failures it causes. Continue reversible work within the agreed scope without approval at each step. Ask when an unresolved choice affects personal data, an external destination, or requested behavior; existing authorization remains valid.

Local tests use demo data and temporary stores. Run affected tests and fix regressions without asking again. Browser flows are covered by `npm run test:e2e` (Playwright in `tests/e2e/`, one isolated demo store and server per test); update or add a spec when an interaction changes. Inspect rendered UI when appearance or interaction changes. Documentation-only edits need an accuracy, link, and diff review. Broaden or repeat checks when failures or remaining uncertainty justify it.

Before committing, run `npm run check` (syntax, Node tests, browser end-to-end tests, Tauri compile check), inspect the exact diff, stage explicit reviewed paths, and scan staged content for secrets/private data. Preserve unrelated changes. Report what was verified and any blocker; compilation alone does not establish live UI or signed-in Codex/Claude behavior. Update relevant handoff sections when behavior or architecture changes.

Basis: [OpenAI's guidance on skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): task-specific context, concrete constraints, and clear completion criteria.
