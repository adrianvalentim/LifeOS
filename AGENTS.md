# LifeOS Agent Guide

LifeOS is designed to be operated and modified by Codex. For ordinary logging and questions, use the stable CLI first. Inspect source only when the user asks for an implementation or schema change.

## Fast path

```bash
npm run lifeos -- projects --health
npm run lifeos -- stats --range week
npm run lifeos -- recommend
npm run lifeos -- log --project "Vulcano" --duration 180 --type creative --desc "Edited eclipse sequence"
npm run lifeos -- session start --project "Portia" --type creative --desc "Draft Act III"
npm run lifeos -- session stop
npm run check
```

Use `--json` on read commands when structured output helps. Do not inspect the browser code before an ordinary log, stats, or recommendation request.

## Project map

- `data/lifeos.json` — active portable store: projects, time entries, active timer, challenge, milestones, settings, and display metadata.
- `data/lifeos.demo.json` — deterministic demonstration snapshot; never replace it with private data.
- `src/lifeos-data.mjs` — validation, atomic persistence, derived statistics, project health, recommendations, and timers.
- `src/codex-app-server.mjs` — local bridge to the installed Codex app server and signed-in ChatGPT account. Never add API-key authentication.
- `cli/lifeos.mjs` — preferred operational interface for Codex.
- `scripts/dev-server.mjs` — dependency-free web server, JSON routes, live refresh, and Codex relay.
- `public/` — V2 Editorial browser UI.
- `scripts/create-demo-data.mjs` — generates both demo files; `--write-active` overwrites the active store.
- `design plan/` — original visual references; do not revise unless asked.

## Data rules

- Use `lifeos log` for time entries whenever possible.
- Omit the project only for truly general inbox/admin work.
- `activityType` is one of `deep_work`, `shallow_work`, `admin`, `research`, `creative`, or `communication`.
- Preserve the user's original language in `rawInput`.
- Never silently map an unknown explicit project to general work; ask or report the match error.
- Visible statistics must be derived from source entries. Do not add display-only totals or hardcode dashboard numbers.
- Treat `data/lifeos.json.bak` as recovery state, not source data, and never commit it.

## Codex rail rules

- The installed `codex app-server` process is the only AI transport.
- Use the signed-in ChatGPT account. Do not use the OpenAI API, API keys, an SDK client, Ollama, Whisper, or another model.
- Keep the rail scoped to this absolute workspace so tasks share the right context.
- Desktop Codex dictation is not currently exposed through app-server for ChatGPT-account clients. Keep voice disabled unless that changes; never substitute an API key, browser speech service, Whisper, Ollama, or another model.
- Route approvals and `request_user_input` to the rail instead of auto-accepting them.

## Design and scope

- Preserve V2 Editorial: warm paper, serif masthead, thin rules, compact information, persistent right Codex rail.
- Default to Projects and keep the first screen useful.
- This phase intentionally defers full project/time-entry/settings management and native packaging. Do not present placeholders as completed workflows.

## Before committing

Run `npm run check`, inspect the exact diff, stage explicit reviewed paths, and scan staged content for secrets or private data. The repository is intended to remain private, but that is not a reason to commit credentials.
