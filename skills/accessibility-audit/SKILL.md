---
name: accessibility-audit
description: WCAG 2.2 AA accessibility audit of real pages — free static code scan, then the accessibility-auditor agent runs an in-page probe (labels, contrast, headings, landmarks, target size), a keyboard walkthrough, a 320 px reflow check and RTL check. 12 criteria, score, verdict, fixes with code locations. Use for "accessibility", "a11y", "WCAG", "screen reader", "keyboard navigation", "contrast".
argument-hint: "<page URL(s) or route(s)> [role] [language]"
---

# Accessibility audit (WCAG 2.2 AA)

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

## Ask first (only what is missing — one question at a time)
1. Which pages or journey (max 5 pages)? Accept URLs or routes; resolve routes with `config.workflow.environments.local_url` or `testing_url`.
2. Which environment? Only `testing_url` / `local_url` from config, or a URL the user gives now (it becomes the allowed origin for this run). Never production unless the user explicitly says so — and then strictly read-only.
3. Role / test account (the human logs in), and languages to check (e.g. English + Arabic RTL).

## Steps
1. **Free code scan:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/audit-scan.mjs" a11y --out <state_dir>/tmp/a11y-scan.json`. Show the summary line.
2. **Agent:** Agent tool → `subagent_type: engineering-ops:accessibility-auditor`, `model: sonnet`. Pass the pages, allowed origin(s), role, languages, and absolute paths of `a11y-scan.json`, `${CLAUDE_PLUGIN_ROOT}/references/probes/a11y-probe.js`, `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`. Ask for the report and the JSON block.
3. **Score:** save the JSON (add `"target"`, `"total_criteria": 12`, `"min_coverage": 0.67`) → `STATE audit-record --kind accessibility --json-file <file>`. Use the script's `verdict`/`score`; show the comparison with the last run if any.
4. **Report** in the user's language: verdict · score · coverage → criteria table → findings by severity with code fixes → what still needs a human screen-reader test → next step. Save to `<state_dir>/reports/accessibility-<date>.md`.
5. Offer: make the top findings a task (`/engineering-ops:run-task`), or re-run after fixes.

If no browser tool is connected: run only step 1, report it as a **code-only** review (no score), and say how to connect Playwright.
