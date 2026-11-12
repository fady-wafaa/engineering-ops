---
name: ux-audit
description: User-experience review of real journeys — the ux-auditor walks each journey as a real user of a role and scores six criteria (discoverability, clear labels, goal completion, feedback, error recovery, keyboard/layout), then gives prioritized, testable improvements. Use for "UX review", "is this easy to use", "usability", "design suggestions for this flow".
argument-hint: "<journey: start page + goal> [role] [language/device]"
---

# UX audit

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

Before the agent starts, follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`: run `STATE agent-model` for `ux-auditor` after reviewing the journeys, show the recommendation, and use `selected_model` below.

## Ask first (only what is missing)
1. The journey, stated in full **before the walkthrough**: the user's **role**, their **goal**, the **context of use**, the **starting point**, and the **visible result that proves the task is done** ("an admin creates an order and assigns a driver; done = the order appears in the list with a driver name"). For "review the whole app", propose 3–5 primary journeys from the navigation and let the user confirm. If the request is one step of a journey, name that narrower scope now and keep the verdict to it.
2. Role, environment (`config.workflow.environments` or a URL now), languages (**does the product support any right-to-left language at all?**) and devices.
3. Allowed data actions (default none).

## Steps
1. Agent tool → `subagent_type: engineering-ops:ux-auditor`, `model: <selected_model from agent-model>`, with the journeys (role, goal, context of use, start, visible success result), environment, languages, allowed actions and the absolute path of `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`.
2. Save its JSON (add `"target"`, `"expected_criteria"` as `J1-1`…`J1-6`, `J2-1`…`J2-6` for every journey, `"total_criteria": 6 × journeys`, `"min_coverage": "4/6"`, `"required_criteria"` listing each journey's goal-completion criterion (`J1-3`, `J2-3`, …), and `"conditions"` with journeys, role, environment/build, device and language) → `STATE audit-record --kind ux --json-file <file>`.
   Each criterion carries `status` (`assessed` / `not_assessed` / `not_applicable`) with evidence, a reason, or a reason plus `basis`. `J*-6` carries `sub_checks` for keyboard, narrow layout and RTL; RTL on a product with no right-to-left language is a `not_applicable` **sub-check**, not a removed criterion. The command refuses contradictory states — fix them, do not restate them. Compare with an earlier run only when the recorder returns a `comparison`.
3. **Report** in the user's language: verdict · score per journey (with expected / assessed / not assessed / not applicable) → strengths → issues (blocks / rework / friction) with improvements and acceptance checks → not covered → next step. Say that the score is this plugin's own rubric for an expert walkthrough, not measured user satisfaction. Save to `<state_dir>/reports/ux-<date>.md`.
4. Offer: turn chosen improvements into tasks; suggest a real-user test for the riskiest change.
