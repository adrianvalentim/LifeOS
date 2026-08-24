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
    |-- validated Application Support JSON store + CLI
    |-- optional versioned Google Drive snapshots
    `-- installed Codex app-server + current ChatGPT account
```

This choice best fits a light macOS app that can move to Linux or Windows with small changes. It avoids a framework build pipeline, hosted services, a database daemon, and per-request API credentials. JSON keeps the user's data portable and auditable. Atomic writes, a backup, and a cross-process lock address the main reliability risks while the data remains single-user and local.

A thin, source-backed Tauri shell is now the daily-use macOS development app. It starts the repository's Node service and preserves immediate refresh while workflows change. A self-contained sidecar build and public packaging remain deferred until the real personal data model settles.

## Completed foundation

- V2 Editorial Projects, Today, Analytics, and Almanac screens, including a
  two-column Projects list and three-column drag Kanban backed by five statuses.
- All dashboard statistics calculated from the active Application Support store.
- Deterministic, replaceable demonstration data.
- Live state refresh when the JSON store changes.
- Week/month/quarter/year analysis ranges.
- Project health, trends, streaks, composition, heatmap, challenge, and recommendation calculations.
- Recommendation controls and a real start/stop timer that logs elapsed work.
- CLI for projects, statistics, recommendations, time logs, and sessions.
- Validated, locked, atomic JSON writes with one recovery backup.
- Platform-native personal-data paths outside Git, with a safe first-run copy from the legacy seed.
- Explicitly configured latest/daily/monthly Google Drive snapshots after successful writes.
- Source-backed Tauri macOS app with deterministic Node startup, dynamic loopback port discovery, clean shutdown, icon, ad-hoc signature, and Applications installation.
- Codex rail through the installed app-server and signed-in ChatGPT account, without API keys.
- Workspace-scoped task list, task resume/create, streaming output, stop, approval, and user-input handling.
- Voice capability evaluated and honestly disabled: desktop dictation is not exposed through the subscription-authenticated app server, and LifeOS will not add a separate model or API key.
- Cross-platform Codex executable lookup.
- Automated data, timer, persistence, and protocol tests.

## Next phase — deliberately deferred

1. Replace the demo snapshot with the user's real domains, projects, historical entries, deadlines, milestones, and weekly plan.
2. Observe which fields and recommendation rules the real data exposes as necessary; evolve the schema once, deliberately.
3. Add project creation and field-editing workflows beyond the implemented
   five-status movement.
4. Add manual time-entry browse/edit/delete workflows with recoverable history.
5. Add goals, deadlines, settings, imports, exports, and almanac search.
6. Replace the source-backed development shell with a self-contained sidecar build, then add notarized distribution, updates, and platform-specific microphone validation.

The next step should begin with real data rather than more generic feature construction. That will prevent designing management screens around assumptions the user's actual system does not need.
