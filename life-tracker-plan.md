# LifeOS implementation plan

## Purpose

LifeOS should reduce the cognitive cost of running many simultaneous projects. It has one job: turn source data into a trustworthy answer to three questions.

1. Where is my time going?
2. What is the state of everything?
3. What should I do now?

Natural-language Codex interaction is the operational surface. The dashboard makes the resulting state legible.

## Chosen architecture

The current foundation is deliberately local-first and dependency-free:

```text
Vanilla browser UI
    |
Local Node 20 server + event stream
    |-- validated JSON store + CLI
    `-- installed Codex app-server + current ChatGPT account
```

This choice best fits a light macOS app that can move to Linux or Windows with small changes. It avoids a framework build pipeline, hosted services, a database daemon, and per-request API credentials. JSON keeps the user's data portable and auditable. Atomic writes, a backup, and a cross-process lock address the main reliability risks while the data remains single-user and local.

A thin Tauri shell is the preferred future packaging direction. It can bundle the existing web surface and Node sidecar without rewriting the product around an operating-system-specific UI. Packaging is deferred until the browser workflow and real personal data model settle.

## Completed foundation

- V2 Editorial Projects, Today, Analytics, and Almanac screens.
- All dashboard statistics calculated from `data/lifeos.json`.
- Deterministic, replaceable demonstration data.
- Live state refresh when the JSON store changes.
- Week/month/quarter/year analysis ranges.
- Project health, trends, streaks, composition, heatmap, challenge, and recommendation calculations.
- Recommendation controls and a real start/stop timer that logs elapsed work.
- CLI for projects, statistics, recommendations, time logs, and sessions.
- Validated, locked, atomic JSON writes with one recovery backup.
- Codex rail through the installed app-server and signed-in ChatGPT account, without API keys.
- Workspace-scoped task list, task resume/create, streaming output, stop, approval, and user-input handling.
- Voice capability evaluated and honestly disabled: desktop dictation is not exposed through the subscription-authenticated app server, and LifeOS will not add a separate model or API key.
- Cross-platform Codex executable lookup.
- Automated data, timer, persistence, and protocol tests.

## Next phase — deliberately deferred

1. Replace the demo snapshot with the user's real domains, projects, historical entries, deadlines, milestones, and weekly plan.
2. Observe which fields and recommendation rules the real data exposes as necessary; evolve the schema once, deliberately.
3. Add project create/edit/pause/archive workflows.
4. Add manual time-entry browse/edit/delete workflows with recoverable history.
5. Add goals, deadlines, settings, imports, exports, and almanac search.
6. Add native desktop packaging, startup behavior, and platform-specific microphone validation.

The next step should begin with real data rather than more generic feature construction. That will prevent designing management screens around assumptions the user's actual system does not need.
