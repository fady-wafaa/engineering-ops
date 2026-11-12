---
name: ui-test
description: Test a page, form or feature in the real browser like a QA engineer — test plan first (happy path, validation, empty/loading/error states, navigation, roles, mobile, RTL), then step-by-step execution with PASS/FAIL per case and reproducible bug reports. Use for "test this page", "QA this feature", "does the form work", "check the flow before release".
argument-hint: "<URL / route / feature> [what it should do]"
---

# UI test

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

Before the agent starts, follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`: run `STATE agent-model` for `ui-tester` after reviewing the cases and roles, show the recommendation, and use `selected_model` below.

## Ask first (only what is missing)
1. Which feature/journey and where it starts (URL or route).
2. What it should do — a card link, acceptance criteria, or a sentence. If the user has none, offer to derive expected behavior from the code and say it is an assumption.
3. Environment (`config.workflow.environments` or a URL the user gives now), role(s), languages, devices.
4. **May the test create or change data?** Default **no**. If yes, which actions exactly (e.g. "create an order with the test customer") — record them as the allowed data actions for this run.

## Steps
1. Agent tool → `subagent_type: engineering-ops:ui-tester`, `model: <selected_model from agent-model>`, with everything above plus the absolute path of `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`.
2. Save its JSON (add `"target"`, `"expected_criteria":["UI-1","UI-2","UI-3","UI-4","UI-5","UI-6","UI-7","UI-8"]`, `"total_criteria": 8`, `"min_coverage": "5/8"`, `"required_criteria":["UI-1"]`, and `"conditions"` with scenario, role, dataset, environment/build, device and language) → `STATE audit-record --kind ui-test --json-file <file>`.
   Each criterion carries `status` (`assessed` / `not_assessed` / `not_applicable`) with evidence, a reason, or a reason plus `basis` (`scope` or `product_property`). A criterion covering cases whose **expected behaviour was never specified** is `not_assessed` with `"reason_code": "expected_undefined"` — the observed behaviour is kept as a note, with no PASS and no FAIL. RTL on a product with no right-to-left language is `not_applicable` with `basis: "product_property"`; `UI-6` is `not_applicable` only when the product genuinely has no roles, not when a second account was unavailable (that is `not_assessed`, `no_test_account`). The command refuses contradictory states. Compare with an earlier run only when the recorder returns a `comparison`.
3. **Report** in the user's language: verdict · score (with expected / assessed / not assessed / not applicable) → test-case table → bugs with reproduction steps → cases held as notes because the expectation was undefined → not tested and why → not applicable and on what basis → next step. Save to `<state_dir>/reports/ui-test-<date>.md`.
4. Offer: open each confirmed bug as a task (`/engineering-ops:run-task`), with its reproduction steps as the card text.

No browser tool connected → say so, and offer only a written test plan.
