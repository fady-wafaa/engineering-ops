# Architecture

## Principles

1. **Scripts decide, models describe.** Time windows, locks, duplicate detection, fingerprints, durations and alert de-duplication are computed by `scripts/state.mjs` and returned as JSON. Skills tell the model to act on that JSON, never to re-derive it. This makes behavior testable and saves tokens.
2. **Read-only by default.** v0.1 has no write path to Trello, Jira, Git or application code. The Trello REST module only implements `GET`.
3. **State outside the repository.** `~/.engineering-ops/projects/<slug>/` (`ENGOPS_HOME`, `ENGOPS_STATE_DIR` override). Nothing is added to a project's `.gitignore`.
4. **No secrets in files.** `config-set` refuses keys that look like secrets. Credentials come from the connector the user authorized or from `TRELLO_API_KEY` / `TRELLO_TOKEN`.
5. **Zero dependencies.** Node ≥ 18.17 only. No build step, so the same files work for Claude Code and Codex.

## Components (v0.1)

```
skills/engineering/SKILL.md   menu: setup, check, start/stop/status, analyze card, worklog, alerts
skills/task-watcher/SKILL.md  one poll (model: haiku) — window → lock → read board → watch-ingest → alert-check → notify → release
skills/worklog/SKILL.md       time tracking + GitHub PR comments
scripts/state.mjs             CLI: all state decisions (JSON in / JSON out)
scripts/lib/common.mjs        args, atomic writes, paths, config merge, UTC run IDs
scripts/lib/assess.mjs        Card Check heuristic (READY / MISSING_INFO, BUG/FEATURE/MIXED/UNCLEAR)
scripts/lib/trello.mjs        read-only REST client + normalizer (fallback for the MCP connector)
scripts/trello.mjs            REST CLI: check | boards | lists | fetch
```

### State files (per project)

| File | Content |
|---|---|
| `config.json` | personal settings (provider, member id, boards/lists, schedule, language, URLs, alert limits) |
| `ledger.json` | per card/task: fingerprint, readiness, stages, branch, change identity, external actions; rolling log of last 50 polls |
| `notifications.json` | notification history (last 100) + active failure key |
| `worklog.json` | per task: title, URL, sessions (start/end), status, GitHub PR comments/reviews |
| `alerts.json` | active alerts (stuck, blocked, repair limit, watcher failed, timer) |
| `*.lock.json` | run locks (`task-watcher`, `task-<id>`) |

### Provider abstraction

The watcher does not call a provider API. A provider adapter (the model using the MCP connector, or `scripts/trello.mjs fetch`) produces one neutral document:

```json
{ "status": "ok|incomplete|blocked", "reason": "...", "member_id": "...",
  "cards": [ { "id", "name", "desc", "url", "board", "list", "labels", "due", "checklists", "members", "closed", "dateLastActivity" } ] }
```

`watch-ingest` only knows this shape, so Jira (v0.4) needs a new adapter, not a new watcher.

### Scheduling

| Mode | Lifetime | Notes |
|---|---|---|
| Claude Desktop scheduled task | while the Desktop app is open and the computer awake | same mechanism as the original SuiteFleet watcher; missed slots run once at next open, then the window check decides |
| `/loop <n>m` | current session only | stated clearly to the user |
| manual | — | `/engineering-ops:engineering` → 2 |

No OS scheduler or background service is installed.

## Components added in v0.2

```
agents/                       orchestrator, browser-qa, requirements-analyst, code-implementer, quality-gate, code-reviewer, prompt-refiner
skills/run-task/SKILL.md      orchestrator playbook (main session) — calls agents with the per-stage model
skills/refine-prompt/SKILL.md free prompt-score, refiner agent only when weak
references/workflow.md        the 9 stages, branch gate, statuses, final report (generic WORKFLOW.md)
references/task-packet.md     packet template (copied into <state>/runs/<run-id>/)
references/stacks/*.md        frontend / backend / netsuite guides for workers
scripts/lib/stack.mjs         detect-stack (manifests only; commands only from real files)
scripts/lib/routing.mjs       size S/M/L/XL → model per stage; premium only as approved proposal
scripts/lib/prompt-score.mjs  5-axis heuristic score (EN + AR)
scripts/lib/branch-guard.mjs  pure command analysis; hooks/branch-guard.mjs is the opt-in PreToolUse entry
```

**Token strategy (#6).** Deterministic work (locks, resume, fingerprints, routing, change identity, prompt pre-score, stack detection) runs in scripts at zero model cost. Workers get file paths and a context budget instead of file dumps. The watcher and quality gate run on Haiku; the prompt refiner runs only when the free score is below 7.

**Why agents are thin and the playbook is a skill.** The orchestrator must be the main conversation to delegate to workers. `/engineering-ops:run-task` loads the playbook into the main session; `agents/orchestrator.md` exists for `claude --agent engineering-ops:orchestrator` and just invokes that skill.

## Migration map (later versions)

| Version | Item | Source in SuiteFleet | Target |
|---|---|---|---|
| ✅ v0.2 | `orchestrator` | `fleet-coordinator.md` | `agents/orchestrator.md` + `skills/run-task` (9 stages, uses `stage-done` / `task-resume` / `action-*` already in state.mjs) |
| ✅ v0.2 | `browser-qa` | `browser-verifier.md` | `agents/browser-qa.md` (URLs from `config.environments`) |
| ✅ v0.2 | `requirements-analyst` | `task-analyst.md` | stack-neutral paths via `scripts/detect-stack.mjs` |
| ✅ v0.2 | `code-implementer` | `task-implementer.md` | branch policy from config, not hard-coded |
| ✅ v0.2 | `quality-gate` | `test-runner.md` | commands discovered from package.json / pyproject / SuiteCloud |
| ✅ v0.2 | `code-reviewer` | `change-reviewer.md` | unchanged contract |
| ✅ v0.2 | model routing | coordinator "Model choice" | orchestrator rates task size S/M/L/XL → haiku/sonnet; premium only with approval |
| ✅ v0.2 | `prompt-refiner` | — (new) | scores a request on 5 axes; offers a better prompt below 7/10 |
| ✅ v0.2 | branch guard | `guard-branch-workflow.mjs` | generic hook reading `protected_branches` from config |
| v0.3 | `performance-auditor`, `architecture-auditor`, `ux-auditor` | same names | generic origins/paths |
| v0.3 | `security-auditor` | — (new) | OWASP Top 10:2025 checks + fixes, read-only |
| v0.3 | `market-scout` | — (new) | competitor feature matrix + prioritized recommendations |
| v0.4 | dashboard | — (new) | `scripts/dashboard/` local web UI reading the state files above |
| v0.4 | Codex | — | `AGENTS.md` + `scripts/install-codex.mjs` |
| v0.4 | Jira | — | provider adapter producing the neutral document |
