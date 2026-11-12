---
name: architecture-audit
description: Read-only architecture review — how the code is organized, how a real user action flows from UI to API to data, page/feature comparison against a reference, dependency direction, coupling, duplication and testability — scored on 9 criteria with the smallest recommended change for the user's goal. Use for "review the architecture", "compare these pages", "why is this hard to change", "plan a refactor".
argument-hint: "<project | feature | pages/routes | base..target> [goal]"
---

# Architecture audit

Target: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

Before the agent starts, follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`: run `STATE agent-model` for `architecture-auditor` after reviewing the scope and goal, show the recommendation, and use `selected_model` below.

## Ask first (only what is missing)
1. Scope: whole project, one feature, a list of pages/routes, or the change between two revisions (`base..target`).
2. **The engineering goal** — what should become easier ("add pages with less duplication", "isolate tenant logic", "make orders testable"). If none, state the working assumption in the report.

## Steps
1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" > <state_dir>/tmp/stack.json`.
2. For a revision range, list changed files read-only: `git diff --name-only <base>..<target>` (and pass the list).
3. Agent tool → `subagent_type: engineering-ops:architecture-auditor`, `model: <selected_model from agent-model>`, with the scope, goal, and absolute paths of `stack.json`, the changed-file list (if any), and `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`. Use `model: opus` only if the user approves it for this named scope.
4. Save its JSON (add `"target"`, `"expected_criteria":["ARCH-1","ARCH-2","ARCH-3","ARCH-4","ARCH-5","ARCH-6","ARCH-7","ARCH-8","ARCH-9"]`, `"total_criteria": 9`, `"min_coverage": "6/9"`, and `"conditions"` with scope, goal, base revision, the modifiability scenario and sampled paths) → `STATE audit-record --kind architecture --json-file <file>`.
   Each criterion carries `status` (`assessed` / `not_assessed` / `not_applicable`) with evidence, a reason, or a reason plus `basis`. `ARCH-9` is `not_assessed` when no architecture decision is documented — never a pass by default, and never `not_applicable` just because the docs are thin. The command refuses contradictory states. Compare with an earlier run only when the recorder returns a `comparison`.
5. **Report** in the user's language: verdict · score (with expected / assessed / not assessed / not applicable) → current design in plain words → the traced path and the modifiability scenario with its result → criteria table → findings (confirmed defects, then suggestions) → recommended first step → sampled vs unchecked. Save to `<state_dir>/reports/architecture-<date>.md`.
6. Offer: turn the first step into a task (`/engineering-ops:run-task`).
