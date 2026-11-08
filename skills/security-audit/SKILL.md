---
name: security-audit
description: Security audit of the current project against the OWASP Top 10:2025 — free static pre-scan (secrets, injection, XSS, SSRF, crypto, supply chain, error handling), then the security-auditor agent confirms each candidate in context and checks access control and auth by reading code. Returns confirmed findings with fixes, a score and a verdict. Read-only. Use for "security review", "check for vulnerabilities", "OWASP", "is this safe to ship".
argument-hint: "[path or feature to focus on] [--deps]"
---

# Security audit (OWASP Top 10:2025)

Scope: `$ARGUMENTS` (empty = whole repository). `--deps` also runs the package manager's vulnerability audit (it contacts the package registry; ask before running it if the user did not pass `--deps`).

`STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`. Temp files go in `<state_dir>/tmp/` (from `STATE paths`).

## Steps
1. **Stack:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" > <state_dir>/tmp/stack.json`.
2. **Free pre-scan:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs" security [--deps] [--dir <scope>] --out <state_dir>/tmp/security-scan.json`. Show the one-line summary (candidates by OWASP category). If it finds a committed secret, tell the user immediately — that one cannot wait for the report.
3. **Agent:** call the Agent tool with `subagent_type: engineering-ops:security-auditor`, `model: sonnet`, and a prompt containing the absolute paths of: `security-scan.json`, `stack.json`, `${CLAUDE_PLUGIN_ROOT}/references/owasp-top10-2025.md`, `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`, plus the scope. Ask for the report and the JSON block.
4. **Score:** save the JSON block to `<state_dir>/tmp/security-audit.json` (add `"target": "<repo name or scope>"`, `"total_criteria": 10`, `"min_coverage": 0.7`) and run `STATE audit-record --kind security --json-file <file>`. Use the returned `verdict` and `score` (computed by the script) — not the agent's own wording. If `comparison` exists, show "score before → after, fixed, new".
5. **Report** to the user in their language: verdict · score · coverage, then findings by severity with fixes, then "Needs review", strengths, not covered, next step. Save the full report to `<state_dir>/reports/security-<date>.md` and give the path.
6. Offer: turn the top finding into a task (`/engineering-ops:run-task`), or re-run after fixes to compare.

## Rules
Read-only. No attacks or requests against any server. Never show secret values. Severity follows `audit-contract.md`. Do not edit code here — fixes go through a task.
