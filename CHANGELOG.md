# Changelog

## Unreleased

### Changed — audit applicability, coverage and evidence (`docs/SCORING-POLICY.md`)
- **Three states per expected criterion.** `assessed` (0/1/2 + evidence), `not_assessed` (applies, could not be checked + reason, optional `reason_code`), `not_applicable` (+ reason and a `basis` of `scope` or `product_property`). Legacy `points: null` still reads as *not assessed*.
- **Composite criteria carry `sub_checks`.** RTL on a product with no right-to-left language is a not-applicable **sub-check**, so the keyboard and narrow-layout results stay visible and the parent criterion stays applicable. A parent cannot score 2 while an applicable sub-check is untested.
- **Coverage is computed over applicable criteria** (not-assessed stays in the denominator), and reports show expected / assessed / not assessed / not applicable. New verdict `NOT_APPLICABLE` when nothing applies.
- **`min_coverage` is an exact ratio** — `"4/6"` (UX, per journey), `"5/8"` (UI), `"6/9"` (Architecture), `"8/12"` (accessibility), `"7/10"` (security). This fixes the contradiction where the agents said 4/6 and 6/9 while the skills passed `0.67`, which rejected exactly those counts. After a not-applicable exclusion, the same ratio applies to the reduced count.
- **`required_criteria` is enforced in the engine.** UX goal completion (`J*-3`) and the UI happy path (`UI-1`) now gate the verdict: assessed at 0 → `FAIL` whatever the rest score; not assessed → `INSUFFICIENT_COVERAGE`, which the report distinguishes from a failure.
- **`audit-record` refuses contradictory criterion states** and stores nothing, instead of recording a score it cannot justify.
- **Comparisons also require a matching scoring basis** — policy version, coverage rule, required criteria, budgets, and the sets of applicable and assessed criterion IDs — on top of the test conditions. A disappearing finding is reported with an explicit note that it is not proof of a fix.

### Changed — performance (`perf-score`)
- `result_visible_ms`, `spa_navigation_ms` and `action_ms` are scored **only against a documented or user-given budget**, recorded with its source, unit, measurement start and end, summary method and scenario. No budget → a measured baseline outside the score. Budget but no measurement → recorded as owed.
- **A single maximum scores met (2) or exceeded (0).** The old "budget × 3 = needs improvement" middle band is gone; an intermediate score needs a declared `needs_improvement_max_ms`.
- **Lab is no longer reported as field.** Browser runs produce `lab_core_web_vitals`; `core_web_vitals_pass` is now a field verdict from the p75 of field data for the device class, passing only when LCP, INP and CLS all meet target, and `null` otherwise.
- Thresholds are labelled by origin: `core_web_vitals` (published) vs `engineering_ops_default` vs a named budget. Legacy `{action_ms, action_budget_ms}` input still works; its default is marked `legacy_default`.

### Added
- `docs/SCORING-POLICY.md` — the whole policy, with its references, and a plain statement that the scores and ratios are this plugin's instrument, while WCAG, OWASP and Core Web Vitals keep their own meaning.
- `tests/applicability.test.mjs` — 33 acceptance tests over the rules above, run by `npm test`.

### Removed
- **market-scout** agent and `/engineering-ops:market-scout` skill.

## 0.3.0 — 2026-11-08

Each specialist is a **separate agent with its own skill**: the user picks the one they need (no combined QA step). Every agent has a stated goal, numbered scoring criteria with a minimum coverage, evidence rules and a fixed report format (`references/audit-contract.md`).

### Added
- **security-auditor** + `/engineering-ops:security-audit` (#4): OWASP Top 10:2025 (A01–A10, verified against owasp.org), confirmed findings only, exploit scenario and code fix for each; `references/owasp-top10-2025.md` with detection and fixes per category, including NetSuite.
- **accessibility-auditor** + `/engineering-ops:accessibility-audit`: WCAG 2.2 AA, 12 criteria; in-page probe (`references/probes/a11y-probe.js`: names/labels, real contrast ratios, headings, landmarks, duplicate IDs, target size), keyboard walk, 320 px reflow, RTL.
- **performance-auditor** + `/engineering-ops:performance-audit`: in-page probe (`references/probes/perf-probe.js`: LCP, INP, CLS, FCP, TTFB, long tasks, page weight, slow/repeated requests), 3 runs, median, scored against Core Web Vitals thresholds by `state.mjs perf-score`.
- **ui-tester** + `/engineering-ops:ui-test`: test plan first, PASS/FAIL per case, reproducible bug reports; data changes only when allowed.
- **ux-auditor** + `/engineering-ops:ux-audit` and **architecture-auditor** + `/engineering-ops:architecture-audit`: generic ports with explicit criteria (6 and 9).
- **market-scout** + `/engineering-ops:market-scout` (#8): feature inventory from code, sourced competitor matrix, gap analysis, recommendations ranked by impact × reach × confidence ÷ effort.
- `scripts/audit-scan.mjs`: free static pre-scan — security (OWASP-mapped rules, supply-chain project checks, optional `--deps` audit, secret values always redacted) and accessibility; calibrated on real projects to cut false positives (route constants, i18n labels, comments, tests, spread props, focus-visible styles).
- `state.mjs`: `audit-record` (score and verdict computed from criteria + findings, history, before/after comparison), `audit-list`, `perf-score`.
- Menu items 11–17 in `/engineering-ops:engineering`.
- 17 new tests (108 total).

### Verified in a real browser
- Accessibility probe found all 7 planted issues on a test page (plus a missing `lang`), with an exact contrast ratio.
- Performance probe: fixed INP measurement — browsers only buffer interactions ≥ 104 ms, so the probe now installs its own observer on the first run (a real click then measured 48 ms instead of null).

## 0.2.0 — 2026-11-07

### Added
- **Core agents** (generic, professional names): `orchestrator` (was fleet-coordinator), `browser-qa` (browser-verifier), `requirements-analyst` (task-analyst), `code-implementer` (task-implementer), `quality-gate` (test-runner), `code-reviewer` (change-reviewer). Same contracts and statuses as the originals; no project-specific paths.
- **`/engineering-ops:run-task`**: the 9-stage workflow in the main session (`references/workflow.md`), with ledger, locks, resume, branch gate, repair limit and per-stage model.
- **Model routing (#6)**: `state.mjs route-task` sizes a task S/M/L/XL and picks haiku/sonnet per stage; premium (opus) only as an approval-required proposal for a named stage; context budget per size; split advice for XL. `stage-done` records planned vs actual model.
- **Prompt refiner (#7)**: free `prompt-score` pre-check (5 axes, English + Arabic); `prompt-refiner` agent (haiku) and `/engineering-ops:refine-prompt` skill run only when the score is below 7.
- **Any stack (#9)**: `scripts/detect-stack.mjs` — frontend (React, Next, Vue, Angular, Svelte…), backend (Node frameworks, Django/FastAPI/Flask, Go, JVM, .NET, PHP, Ruby, Rust), NetSuite SuiteCloud SDF, monorepos and `client/`+`server/` layouts; validation commands only from real project files. Stack guides in `references/stacks/`.
- **Branch guard hook** (opt-in per project): blocks taking code from integration branches (e.g. `develop`) into task branches and commits on protected branches; reads the policy from config.
- `state.mjs`: `run-init`, `diff-identity` (SHA-256 of diff + untracked files, read-only git), `task-status`, `repair-round`.
- Menu items 9 (Workflow setup) and 10 (Run a task) in `/engineering-ops:engineering`.
- 28 new tests (91 total).

### Fixed
- Model routing: a "high ambiguity" adjustment could overwrite an approved premium model (caught by a test before release).

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
