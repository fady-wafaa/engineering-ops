---
name: ux-audit
description: User-experience review of real journeys — the ux-auditor walks each journey as a real user of a role and scores six criteria (discoverability, clear labels, goal completion, feedback, error recovery, keyboard/layout), then gives prioritized, testable improvements. Use for "UX review", "is this easy to use", "usability", "design suggestions for this flow".
argument-hint: "<journey: start page + goal> [role] [language/device]"
---

# UX audit

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

Before the agent starts, follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`: run `STATE agent-model` for `ux-auditor` after reviewing the journeys, show the recommendation, and use `selected_model` below.

## Ask first (only what is missing)
1. The journey: where the user starts and what they want to achieve ("an admin creates an order and assigns a driver"). For "review the whole app", propose 3–5 primary journeys from the navigation and let the user confirm.
2. Role, environment (`config.workflow.environments` or a URL now), languages (Arabic RTL?) and devices.
3. Allowed data actions (default none).

## Steps
1. Agent tool → `subagent_type: engineering-ops:ux-auditor`, `model: <selected_model from agent-model>`, with the journeys, role, environment, languages, allowed actions and the absolute path of `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`.
2. Save its JSON (add `"target"`, `"expected_criteria"` as `J1-1`…`J1-6`, `J2-1`…`J2-6` for every journey, `"total_criteria": 6 × journeys`, `"min_coverage": 0.67`, and `"conditions"` with journeys, role, environment/build, device and language) → `STATE audit-record --kind ux --json-file <file>`; fix validation errors before publishing a score and compare only when conditions match.
3. **Report** in the user's language: verdict · score per journey (with coverage) → strengths → issues (blocks / rework / friction) with improvements and acceptance checks → next step. Save to `<state_dir>/reports/ux-<date>.md`.
4. Offer: turn chosen improvements into tasks; suggest a real-user test for the riskiest change.
