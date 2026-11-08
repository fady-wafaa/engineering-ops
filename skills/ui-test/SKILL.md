---
name: ui-test
description: Test a page, form or feature in the real browser like a QA engineer — test plan first (happy path, validation, empty/loading/error states, navigation, roles, mobile, RTL), then step-by-step execution with PASS/FAIL per case and reproducible bug reports. Use for "test this page", "QA this feature", "does the form work", "check the flow before release".
argument-hint: "<URL / route / feature> [what it should do]"
---

# UI test

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

## Ask first (only what is missing)
1. Which feature/journey and where it starts (URL or route).
2. What it should do — a card link, acceptance criteria, or a sentence. If the user has none, offer to derive expected behavior from the code and say it is an assumption.
3. Environment (`config.workflow.environments` or a URL the user gives now), role(s), languages, devices.
4. **May the test create or change data?** Default **no**. If yes, which actions exactly (e.g. "create an order with the test customer") — record them as the allowed data actions for this run.

## Steps
1. Agent tool → `subagent_type: engineering-ops:ui-tester`, `model: sonnet`, with everything above plus the absolute path of `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`.
2. Save its JSON (add `"target"`, `"total_criteria": 8`, `"min_coverage": 0.6`) → `STATE audit-record --kind ui-test --json-file <file>`; use the script's verdict/score and show the comparison with the last run.
3. **Report** in the user's language: verdict · score → test-case table → bugs with reproduction steps → not tested and why → next step. Save to `<state_dir>/reports/ui-test-<date>.md`.
4. Offer: open each confirmed bug as a task (`/engineering-ops:run-task`), with its reproduction steps as the card text.

No browser tool connected → say so, and offer only a written test plan.
