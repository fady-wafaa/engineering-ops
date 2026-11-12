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
4. **The budget for the action or navigation**, if the project documents one or the user has one in mind ("the filter must show rows within 1000 ms"). Ask where it comes from. LCP, INP and CLS need no budget — they use the published Core Web Vitals thresholds. `result_visible_ms`, `spa_navigation_ms` and `action_ms` are scored **only** against a budget; with none, they are reported as a measured baseline outside the score, and that is a correct result, not a gap.

## Steps
1. Agent tool → `subagent_type: engineering-ops:performance-auditor`, `model: <selected_model from agent-model>`, with target, scope, action, allowed origin, role, and absolute paths of `${CLAUDE_PLUGIN_ROOT}/references/probes/perf-probe.js` and `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`. Ask for raw probe JSON, conditions, request timeline and a click-to-visible-result timeline. Measure cold/warm and mobile/desktop as separate scenarios. For a SPA route, measure route click to useful content. If SuiteFleet table filtering is the target, identify changed rows and time the filter click to those rows becoming visible.
2. **Score:** save

   ```json
   {"runs": ["…probe results…"],
    "budgets": {"result_visible_ms": {"max_ms": 1000, "unit": "ms", "source": "docs/perf-budget.md §2 | the user, 2026-11-12",
                                      "measure_start": "click on the status filter", "measure_end": "the changed rows are visible",
                                      "summary": "median", "scenario": "Open status filter → changed rows visible",
                                      "needs_improvement_max_ms": null}},
    "field": {"source": "CrUX", "device_class": "phone", "metrics": {"lcp_ms": {"p75": 2100}, "inp_ms": {"p75": 150}, "cls": {"p75": 0.05}}},
    "conditions": {"…": "…"}}
   ```

   → `STATE perf-score --json-file <file>`. `action.result_visible_ms` and `spa_navigation.result_visible_ms` in each run are summarized by median and compared with their budget only when the scenario and the summary method match the budget's. A single `max_ms` scores **met (2) or exceeded (0)** — an intermediate score needs a declared `needs_improvement_max_ms`. No budget → `status: "measured_no_budget"`, value and sample count reported outside the score. Budget but no measurement → `status: "required_not_measured"`, listed as owed. The legacy `{"action_ms":…, "action_budget_ms":…}` input still works; its default 1000 ms is marked `kind: "legacy_default"` and must be labelled as such in the report, never as an approved scenario budget.
3. **Import available reports:** `STATE perf-report --type crux|rum|server|k6 --json-file <file>`. CrUX accepts an API record, RUM accepts `{scope,url|origin,metrics}`, server accepts `{requests:[{route,duration_ms,status,trace_id?,db_ms?,report_url?}]}`, and k6 accepts a JSON summary with `metrics`. Use existing reports only; do not generate load. For missing access, name the required report, credential or browser capability and mark it “لم يُقَس”. Server/database causes require a linked trace or report, not just an aggregate latency.
   Feed the imported p75 values back as `field` on `perf-score`. A **field** Core Web Vitals assessment uses the 75th percentile for the device class and passes only when LCP, INP **and** CLS all meet their targets. With incomplete field data, report what is available and declare no field pass. Browser runs are lab data: `lab_core_web_vitals` never becomes a field verdict, however fast the runs were.
4. **Record:** include `target`, `criteria`, `findings`, `median`, `budgets` (exactly what you passed to `perf-score`), and `conditions` with exact `target,scenario,device,viewport,network,throttling,build,environment,cache,role`; `build` means build mode, and revision is recorded separately → `STATE audit-record --kind performance --json-file <file>`. The recorder returns a before/after delta only when the conditions, the scoring policy, **the budgets** and the applicable/assessed criteria all match — a changed budget means the two scores were not computed by the same rule, so no comparison is shown. Record cold/warm and mobile/desktop separately. Pass `min_coverage` as an exact ratio.
5. **Report** in the user's language: verdict · score · coverage → each check's result, source (`core_web_vitals` / `engineering_ops_default` / the budget and where it came from), conditions, sample count, baselines measured without a budget and measurements owed against a budget → local timing and request timeline → **lab** results and **field** results in separate sections, with CrUX/RUM, API/server/database and k6 → findings with evidence and fixes → valid before/after differences or the mismatch reason. Save to `<state_dir>/reports/performance-<date>.md`.
6. End with two choices: create a Trello card containing the top finding and evidence (only if the user authorizes creating it and Trello is available), or run `/engineering-ops:run-task` to implement the improvement. Re-run this audit under the same conditions after the fix.

No browser tool connected → mark browser checks “لم يُقَس”, explain the required tool, and still analyze supplied reports. Never guess missing measurements.
