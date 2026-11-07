# Changelog

## 0.1.0 — 2026-11-07

First release, extracted from the SuiteFleet Web AI agents system (audit: `docs/AUDIT.md`).

### Added
- `/engineering-ops:engineering` menu: setup, check now, start/stop/status monitoring, read-only card analysis, work log, alerts.
- `/engineering-ops:task-watcher`: one read-only poll of Trello (MCP connector or REST fallback). Runs on Haiku.
- `/engineering-ops:worklog`: task timer (start / pause / stop), active time without pauses, per-stage timings, Markdown/CSV export, GitHub PR comments and reviews.
- `scripts/state.mjs`: ported state helper plus `watch-ingest`, `card-assess`, notifications de-duplication, `watcher-status`, `cards-list`, `config-get/set`, `run-id`, worklog and alert commands.
- Card Check with BUG / FEATURE / **MIXED** / UNCLEAR (audit gap D1).
- Alerts: stuck task, BLOCKED, repair rounds used up, watcher failure, forgotten timer.
- `scripts/trello.mjs`: read-only REST client (GET only, token scrubbed from errors).
- 63 tests (26 original + 37 new).

### Changed (compared with the original)
- State and personal config moved out of the repository to `~/.engineering-ops/projects/<slug>/`.
- Run IDs are generated in real UTC by the script (audit D2).
- No hard-coded project, board, member, URL, port, time zone or package manager.

### Fixed
- Stale-lock takeover race: two runs could both win (audit D9).

### Not in this version
Core engineering agents, model routing, prompt refiner (v0.2) · performance / architecture / UX / security auditors, market scout (v0.3) · local dashboard, Codex packaging, GitHub publishing, Jira (v0.4).
