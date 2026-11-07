# Source Audit — SuiteFleet Web AI Engineering Agents

Audit date: 2026-11-07. This audit was done read-only. The source repository was not changed.

## 1. Where the source is

| Item | Location | How it was read |
|---|---|---|
| Agents + workflow | `D:\Projects\project cv\agint suiteFleet\SuiteFleet-Web`, branch **`feature/agents-workFlow`** (commit `1460a3ce`) | `git show <branch>:<path>` (no checkout) |
| `main` branch of the same repo | commit `b67e3d32` | Does **not** contain `.claude/agents/` or `ai-workflow/scripts/` |
| Trello watcher (scheduled task) | `C:\Users\fadyw\.claude\scheduled-tasks\trello-suitefleet-ui-revamp-watch\SKILL.md` | Read directly. Listed as enabled, cron `0,30 10-19 * * 0-4`, jitter 706 s |
| Older copy without coordinator/auditors/script | `C:\Users\fadyw\OneDrive\Desktop\task-agent-kit` | Not used (out of date) |
| Arabic user guides | `SuiteFleet-AI-Agents-Guide-AR1.pdf`, `SuiteFleet-Agents-Guide-AR3.pdf` | Text extracted with `pdftotext` |

The watcher was **migrated from its real task definition**, not rebuilt from the documentation.

## 2. Files in the source

| File | Lines | Purpose |
|---|---|---|
| `.claude/agents/fleet-coordinator.md` | 93 | Main-session coordinator. `model: sonnet`. No `tools:` line (all tools). |
| `.claude/agents/browser-verifier.md` | 25 | PRECHECK / POSTCHECK with Playwright MCP |
| `.claude/agents/task-analyst.md` | 78 | Stage 3: 5-step analysis, impact analysis, acceptance criteria |
| `.claude/agents/task-implementer.md` | 18 | Stage 6: branch gate + smallest change + regression test |
| `.claude/agents/test-runner.md` | 13 | Stage 7: runs configured checks independently |
| `.claude/agents/change-reviewer.md` | 12 | Stage 8: advisory review bound to diff identity |
| `.claude/agents/performance-auditor.md` | 28 | On demand: browser timing / network |
| `.claude/agents/architecture-auditor.md` | 27 | On demand: design, page comparison, strategy |
| `.claude/agents/ux-auditor.md` | 13 | On demand: 6-criteria journey score |
| `ai-workflow/WORKFLOW.md` | 126 | The only allowed stage order + rules |
| `ai-workflow/project-config.json` | 98 | Project settings (SuiteFleet-specific) |
| `ai-workflow/TASK-PACKET.md` | 37 | Task packet template |
| `ai-workflow/PILOT-CHECKS.md` | 31 | 22 acceptance scenarios (15 manual, 7 automated) |
| `ai-workflow/START-HERE.txt` | 9 | Paste-in prompt that turns the main chat into the coordinator |
| `ai-workflow/scripts/watcher-state.mjs` | 743 | Deterministic state helper (locks, ledger, resume, window, fingerprint) |
| `ai-workflow/scripts/watcher-state.test.mjs` | 472 | `node:test` synthetic tests, 7 scenarios |
| `.claude/hooks/guard-branch-workflow.mjs` | 287 | PreToolUse hook: blocks taking code from `develop` |
| `.claude/hooks/check-conventions.mjs` | 151 | PostToolUse hook: SuiteFleet code conventions |
| `.claude/settings.json` | 79 | Permission deny list + the two hooks |

## 3. Agents: responsibilities and contracts

| Agent | Stage | Input | Output / statuses | Tools |
|---|---|---|---|---|
| fleet-coordinator | all | user words, card, worker results, ledger | task packet, drafts, final report | all (must be the **main** session) |
| browser-verifier | 2, 7 | steps, allowed URL, role, dataset | `REPRODUCED` `NOT_REPRODUCED` `BLOCKED` `INCONCLUSIVE` `BASELINE_RECORDED`; post: `PASS` `FAIL` `PARTIAL` `BLOCKED` | Read, Glob, Grep, ToolSearch, `mcp__playwright__*` |
| task-analyst | 3 (re-run after 4) | card, baseline, packet | 9-part handoff; `READY_FOR_IMPLEMENTATION` / `NEEDS_CLARIFICATION` | Read, Glob, Grep |
| task-implementer | 6 (full mode) | handoff, branch decision | changed files, commands, diff identity; `NEEDS_CLARIFICATION` / `NEEDS_BRANCH_DECISION` | Read, Glob, Grep, Edit, Write, Bash |
| test-runner | 7 | criteria, handoff, diff identity | per-command exit codes, coverage; `BLOCKED` if a command is missing | Read, Glob, Grep, Bash |
| change-reviewer | 8 | diff, requirements, baseline, test + postcheck results | `ACCEPTABLE_FOR_HUMAN_REVIEW` `CHANGES_REQUIRED` `BLOCKED` | Read, Glob, Grep |
| performance-auditor | on request | page + scope (Unit / Integration / E2E) | numbers, cause, location, fix direction | Read, Glob, Grep, ToolSearch, `mcp__playwright__*` |
| architecture-auditor | on request | pages / feature + goal | verdict + ordered findings (file, lines, evidence) | Read, Glob, Grep |
| ux-auditor | on request | journey, role, environment | 6 criteria × 0/1/2, % only if ≥4 assessed incl. goal completion | Read, Glob, Grep, ToolSearch, `mcp__playwright__*` |

**Handoff rule:** workers never call each other. Every result goes back to the coordinator, which saves it in the task packet and gives it to the next worker. Workers without write tools cannot save reports; the coordinator saves them.

**Model rule (coordinator):** start on Sonnet. Haiku for short/simple work. A premium model (Opus etc.) or a much bigger scope needs explicit user approval, saved with scope and limit. Never claim a model switch that did not happen.

## 4. The nine-stage pipeline (ledger keys)

1. `1_intake` — read card, classify BUG / FEATURE / MIXED
2. `2_baseline` — PRECHECK on Testing. BUG needs `REPRODUCED` before any code change
3. `3_analysis` — task-analyst handoff
4. `4_questions` — one question bundle, **draft only** by default
5. `5_mode_branch_gate` — `intake-only` stops here (stage 5 left incomplete); `full` passes the branch gate
6. `6_implementation` — new branch from `origin/main`; diff identity = SHA-256 of diff + untracked files
7. `7_checks_postcheck` — tests, then POSTCHECK on local app
8. `8_final_review` — change-reviewer
9. `9_report_handoff` — report; card update only after `READY_FOR_REVIEW`, full mode, explicit permission

Repairs: stage 7/8 failure returns to stage 6, `max_repair_rounds = 2`. A new diff identity invalidates stages 7–9.

## 5. Ledger, locks, resume (watcher-state.mjs)

Commands: `window`, `lock-acquire`, `lock-release`, `lock-refresh`, `lock-status`, `card-check`, `card-upsert`, `task-get`, `stage-done`, `task-resume`, `action-begin`, `action-resolve`, `fingerprint`, `report-line`, `poll-record`, `poll-last`.

- **Locks:** atomic create by `link()` of a complete temp file; stale takeover by `rename()` so only one racing run wins; release/refresh only by owner. Stale after 90 min (watcher) or 240 min (task).
- **Ledger writes:** wrapped in a short exclusive `ledger.write.lock` (stale after 2 min) so the watcher and a coordinator session cannot lose each other's updates.
- **Fingerprint:** SHA-256 (first 16 hex) of title (minus appended branch suffix), description, sorted label names, due, checklist items with state. Moves, members and comments do not change it.
- **Resume:** walks the 9 stages; the first missing / older-fingerprint / (stages 7–9) older-diff stage is the resume point; later saved stages are reported as invalidated.
- **External actions:** two-phase `pending` → `done`. A leftover `pending` means "check the real state first", so actions are never done twice.
- **Poll log:** last 50 polls kept in the ledger.
- State dir: `.ai-runs/state/` inside the repo (gitignored). Overridable by `AI_WORKFLOW_STATE_DIR` (used by tests).

## 6. Trello watcher (real task definition)

Nine steps: (1) read config → (2) `window` check, stop silently outside window → (3) run ID + `lock-acquire trello-watcher` → (4) load Trello MCP tools → (5) read every source list fully with paging, any failure = `incomplete` → (6) eligible = open cards whose members include the **member id**; fingerprint + `card-check` → (7) Card check for new/changed cards + `card-upsert` → (8) `poll-record`, `report-line`, one `PushNotification` → (9) `lock-release` always, delete temp files.

Card check rules (step 7a): title clear; description not empty; type BUG / FEATURE / **UNCLEAR**; screen/area named; BUG → repro steps, expected, actual; FEATURE → wanted behavior, acceptance criteria/checklist. Result `READY` or `MISSING_INFO` + missing list. "Only mark present when the card text really contains it."

## 7. Branch protection

- Workflow rule: never implement on `main`, `master`, `develop`, configured patterns, or detached HEAD. New branch `feature/<slug>` or `hotfix/<slug>` from `origin/main`.
- Enforced by `guard-branch-workflow.mjs` (PreToolUse on Bash/PowerShell): blocks merge/pull/rebase/reset/cherry-pick/checkout/restore **from `develop`** on any other branch, and branches created from `develop`.
- `settings.json` deny list: push, merge, rebase, cherry-pick, revert, branch delete, `gh pr merge`.

## 8. Tests that exist

`node --test ai-workflow/scripts/watcher-state.test.mjs` — 7 scenarios: unchanged card twice; overlapping polls (incl. 8 concurrent acquires, 8 concurrent ledger writes); requirements change; interrupted run + stale lock; external action two-phase; Trello failure; polling window (DST, grace, working days).

## 9. Implemented but not verified

- Card check (`READY` / `MISSING_INFO`) and the PushNotification alert: added to the watcher, but the guide says no run had happened after the change.
- Phone alerts need Remote Control to be connected.
- The 15 manual pilot scenarios in `PILOT-CHECKS.md` are "proposed, not executed".

## 10. Discrepancies and gaps

| # | Finding | Evidence | Effect |
|---|---|---|---|
| D1 | **MIXED gap.** The pipeline classifies BUG / FEATURE / MIXED (WORKFLOW stage 1, task-analyst), but the watcher Card check uses BUG / FEATURE / **UNCLEAR** and has no MIXED rule. | watcher SKILL.md step 7a | The plugin keeps the pipeline contract: it adds `MIXED` = both bug and feature signals, and checks **both** rule sets. No new requirement is invented: MIXED needs the union of existing BUG and FEATURE items. `UNCLEAR` stays for "no signal". |
| D2 | **Run ID time zone.** The guide says the run ID is written in Cairo time but ends with `Z`, so it looks 2 hours late. The prompt asks the LLM to build the ID itself. | AR1 §9c | The plugin generates the run ID in the script (`run-id`) from real UTC. |
| D3 | **Port mismatch.** Workflow + config use `http://localhost:3001`; `.claude/launch.json` `web` uses port 3000. | config, launch.json | The plugin asks for the local URL during setup; no default port. |
| D4 | **Hard-coded paths.** The watcher uses absolute Windows paths to the SuiteFleet repo and script. | watcher SKILL.md lines 8–9 | Plugin uses `${CLAUDE_PLUGIN_ROOT}` and a per-project state dir outside the repo. |
| D5 | Config fields with no value: `testing_build_identity_method`, `test_tenant_or_dataset`, `authorized_message_destination`, `validation_commands.integration`; `allowed_test_data_actions: []`. | project-config.json | `AWAITING_DEPLOYMENT` cannot be proven; browser checks are read-only; questions stay drafts. |
| D6 | `project-config.json` stores a stale `access_check` and `watcher.status: "active"` — runtime facts inside a tracked config file. | config lines 50–64 | Plugin keeps runtime status in the state dir only. |
| D7 | Coordinator says "uses ai-workflow/scripts/watcher-state.mjs" but state is in the repo (`.ai-runs/`), which needs a `.gitignore` edit in every project. | WORKFLOW Preflight | Plugin state lives in `~/.engineering-ops/`; no repo edit needed. |
| D8 | The scheduler only runs while Claude Desktop is open and the computer is awake; missed slots are not replayed. | WORKFLOW "Scheduled Trello polling window" | Documented as a limitation in the plugin too. |
| D9 | **Stale-lock takeover race.** `takeOver()` used `rename()` alone as the arbiter. If run B judged the lock stale, run A took it over and wrote a fresh lock, then B's `rename()` removed A's *fresh* lock: two winners. Seen once in the ported test "two runs that both find the same stale lock" while the whole suite ran in parallel; not reproduced in an isolated 40-round stress test of either version. | `watcher-state.mjs` `cmdLockAcquire` | Fixed in `scripts/state.mjs`: an exclusive `.takeover` guard, and the staleness check is repeated inside it. |

## 11. Project-specific values to remove

`SuiteFleet Web`, `https://testing.next.suitefleet.com`, `http://localhost:3001`, `pnpm dev/test/lint/type-check/build`, `@suitefleet/*`, board URL `dLLviBY0`, board/list ARIs, list names `Backlog` / `Dev. In progress` / `Peer Review`, member `fadywafaa` and its ARI, `Africa/Cairo` + Sun–Thu as fixed values, `apps/web/src/app/routes/`, `src/features/crud-builder/`, `packages/ui/`, `features/vehicles`, `docs/adr/` as fixed paths, the `develop`-is-QA branch model, `check-conventions.mjs` (SuiteFleet code rules), Discord as the message channel, the A1–B1 English rule as a fixed rule (now a setting).

## 12. What is reused as-is

- `watcher-state.mjs` logic (all commands, atomic locking, resume) → `scripts/state.mjs`, with tests.
- Watcher step order and the "silent when nothing changed / never say 'no new cards'" rule.
- Card check items and the "never invent content" rule.
- Agent contracts and statuses (for v0.2/v0.3, with generic names).
