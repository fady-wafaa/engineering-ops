---
name: security-audit
description: Security audit of the current project against the OWASP Top 10:2025. Confirms code findings and, when a test URL and browser tools are available, checks the relevant page in the browser. Reports evidence, a score, a verdict, and offers a Trello card draft. Use for "security review", "check login security", "OWASP", "is this safe to ship".
argument-hint: "[path or feature] [test URL] [--deps]"
---

# Security audit (OWASP Top 10:2025)

Scope: `$ARGUMENTS` (empty = whole repository). `--deps` also runs the package manager's vulnerability audit (it contacts the package registry; ask before running it if the user did not pass `--deps`).

For a page or user journey, use a Testing or Local URL from the project configuration or the user's message. Ask for the URL only when neither is available. Use a test account only when the user has provided one through an approved environment; never request a password in chat. If no browser tool or test environment is available, finish the code audit and mark browser checks as not tested.

`STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`. Temp files go in `<state_dir>/tmp/` (from `STATE paths`).

Before the agent starts, follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`: review this scope, run `STATE agent-model` for `security-auditor`, show the recommendation and reasons, and use `selected_model` below.

## Steps
1. **Stack:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" > <state_dir>/tmp/stack.json`.
2. **Free pre-scan:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs" security [--deps] [--dir <scope>] --out <state_dir>/tmp/security-scan.json`. Show the one-line summary (candidates by OWASP category). If it finds a committed secret, tell the user immediately — that one cannot wait for the report.
3. **Agent:** call the Agent tool with `subagent_type: engineering-ops:security-auditor`, `model: <selected_model from agent-model>`, and a prompt containing the absolute paths of: `security-scan.json`, `stack.json`, `${CLAUDE_PLUGIN_ROOT}/references/owasp-top10-2025.md`, `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`, plus the scope, allowed test URL/origin, role and available synthetic test accounts. Ask it to check the code and then the relevant page in the browser when tools and access are available. Ask for the report and the JSON block, with code and browser evidence distinguished.
4. **Score:** save the JSON block to `<state_dir>/tmp/security-audit.json` (add `"target": "<repo name or scope>"`, `"expected_criteria":["A01","A02","A03","A04","A05","A06","A07","A08","A09","A10"]`, `"total_criteria": 10`, `"min_coverage": 0.7`, and `"conditions"` with scope, environment/build, role and sampled entry points) and run `STATE audit-record --kind security --json-file <file>`. Fix validation errors before publishing a score. Use the returned verdict/score. Show before/after only when `comparison` exists; otherwise show `comparison_unavailable`.
5. **Report** to the user in their language: verdict · score · coverage, then findings by severity with fixes, browser cases with observed results, "Needs review", strengths, not covered, next step. Say explicitly which conclusions came from code and which were verified in the browser. Save the full report to `<state_dir>/reports/security-<date>.md` and give the path.
6. **Offer a Trello card:** after the report, offer to create a card for one or more confirmed findings. Prepare a reviewable draft with title, severity, affected page, code and browser evidence, reproduction steps when observed, recommended fix, and verification steps. If the user chooses to create it, get the target board and list from saved project configuration or ask for the missing destination, show the draft, then use the connected Trello card-create tool after the user confirms that specific card. Return its URL. If no Trello write connector is available, give the draft for manual creation; the bundled Trello REST client is read-only. Also offer `/engineering-ops:run-task` or a re-audit after fixes.

## Rules
The code audit is read-only. Browser checks are limited to the supplied Testing or Local origin, ordinary UI interactions and synthetic test accounts. Do not test production, brute-force, enumerate real accounts, bypass controls, or change application data. Never show credentials, tokens, cookies or secret values. A browser case without the required access stays untested, and an unverified risk stays in "Needs review". Severity follows `audit-contract.md`. Do not edit code here — fixes go through a task.
