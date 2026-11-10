---
name: performance-audit
description: Audit browser speed, visible user results, SPA navigation, available server and field reports, and imported k6 summaries. Three comparable runs per browser scenario, median values, evidence-backed fixes. Use for "this page is slow", "performance check", "Core Web Vitals", "why does the filter take so long".
argument-hint: "<URL or route> [interaction | page-load | journey] [the slow action]"
---

# Performance audit

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

Before the agent starts, follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`: run `STATE agent-model` for `performance-auditor` after reviewing the scenarios and report inputs, show the recommendation, and use `selected_model` below.

## Ask first (only what is missing — never guess)
1. The exact page (URL or route) and, if something feels slow, the action ("choose a status filter", "open order details").
2. Scope: **Interaction** (one action) · **Page load** (one route) · **Journey** (name the steps).
3. Environment: `config.workflow.environments` testing/local URL, or a URL the user gives now. Local dev servers are slower than production builds — say so if measuring `npm run dev`.

## Steps
1. Agent tool → `subagent_type: engineering-ops:performance-auditor`, `model: <selected_model from agent-model>`, with target, scope, action, allowed origin, role, and absolute paths of `${CLAUDE_PLUGIN_ROOT}/references/probes/perf-probe.js` and `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`. Ask for raw probe JSON, conditions, request timeline and a click-to-visible-result timeline. Measure cold/warm and mobile/desktop as separate scenarios. For a SPA route, measure route click to useful content. If SuiteFleet table filtering is the target, identify changed rows and time the filter click to those rows becoming visible.
2. **Score:** save `{"runs":[…probe results…],"action_ms":<legacy optional>,"action_budget_ms":1000}` → `STATE perf-score --json-file <file>`. `action.result_visible_ms` and `spa_navigation.result_visible_ms` in each run are scored from their median. Keep the legacy `action_ms` input working.
3. **Import available reports:** `STATE perf-report --type crux|rum|server|k6 --json-file <file>`. CrUX accepts an API record, RUM accepts `{scope,url|origin,metrics}`, server accepts `{requests:[{route,duration_ms,status,trace_id?,db_ms?,report_url?}]}`, and k6 accepts a JSON summary with `metrics`. Use existing reports only; do not generate load. For missing access, name the required report, credential or browser capability and mark it “لم يُقَس”. Server/database causes require a linked trace or report, not just an aggregate latency.
4. **Record:** include `target`, `criteria`, `findings`, `median`, and `conditions` with exact `target,scenario,device,viewport,network,throttling,build,environment,cache,role`; `build` means build mode, and revision is recorded separately → `STATE audit-record --kind performance --json-file <file>`. The recorder returns a before/after delta only when all conditions match. Record cold/warm and mobile/desktop separately. Use `total_criteria` and `min_coverage` as before.
5. **Report** in the user's language: verdict · score · coverage → each check's result, source, conditions, sample count and unavailable measurements → local timing and request timeline → separate CrUX/RUM, API/server/database and k6 sections → findings with evidence and fixes → valid before/after differences or the mismatch reason. Save to `<state_dir>/reports/performance-<date>.md`.
6. End with two choices: create a Trello card containing the top finding and evidence (only if the user authorizes creating it and Trello is available), or run `/engineering-ops:run-task` to implement the improvement. Re-run this audit under the same conditions after the fix.

No browser tool connected → mark browser checks “لم يُقَس”, explain the required tool, and still analyze supplied reports. Never guess missing measurements.
