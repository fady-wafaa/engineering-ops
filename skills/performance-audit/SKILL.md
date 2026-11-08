---
name: performance-audit
description: Measure the speed of a real page or user action in the browser — Core Web Vitals (LCP, INP, CLS), TTFB, FCP, main-thread blocking, page weight, slow and repeated API calls — over 3 runs with median values, then find the causes and the fixes. Use for "this page is slow", "performance check", "Core Web Vitals", "why does the filter take so long".
argument-hint: "<URL or route> [interaction | page-load | journey] [the slow action]"
---

# Performance audit

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

## Ask first (only what is missing — never guess)
1. The exact page (URL or route) and, if something feels slow, the action ("choose a status filter", "open order details").
2. Scope: **Interaction** (one action) · **Page load** (one route) · **Journey** (name the steps).
3. Environment: `config.workflow.environments` testing/local URL, or a URL the user gives now. Local dev servers are slower than production builds — say so if measuring `npm run dev`.

## Steps
1. Agent tool → `subagent_type: engineering-ops:performance-auditor`, `model: sonnet`, with the target, scope, action, allowed origin, role, and absolute paths of `${CLAUDE_PLUGIN_ROOT}/references/probes/perf-probe.js` and `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`. Ask for the report plus the raw probe JSON array.
2. **Score:** save `{"runs":[…probe results…],"action_ms":<if measured>,"action_budget_ms":1000}` → `STATE perf-score --json-file <file>`. Use its `criteria` (points come from the published thresholds and the median).
3. **Record:** `{"target","criteria":<from perf-score, as {id,points,evidence}>,"findings":<from the agent>,"total_criteria":<number of criteria>,"min_coverage":0.5}` → `STATE audit-record --kind performance --json-file <file>`. Show the comparison with the previous run of the same target.
4. **Report** in the user's language: verdict · score · Core Web Vitals pass/fail → metric table (median, good threshold, status) → findings with causes and fixes → what was not measurable → next step. Save to `<state_dir>/reports/performance-<date>.md`.
5. Offer: turn the top fix into a task (`/engineering-ops:run-task`) and re-run this audit after the fix to prove the gain.

No browser tool connected → say so and stop (performance cannot be guessed from code).
