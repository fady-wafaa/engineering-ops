---
name: refine-prompt
description: Check and improve a request before work starts. Gives a free instant score (goal, context, constraints, success criteria, output format) and, only when the request is weak, a clearer rewritten version plus the few questions that matter. Use when the user asks "is my prompt good?", "improve this prompt", or before starting a vague task.
argument-hint: "<the request text>"
---

# Refine a prompt

Request to check: `$ARGUMENTS` (if empty, ask the user to paste it).

1. Free score first (no model cost): write the text to `<state_dir>/tmp/prompt.json` as `{"text": "..."}` and run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" prompt-score --json-file <file>`.
2. If `run_refiner` is **false** (score ≥ 7): say it is good, list any `weak` axes in one line each with the `hint`, and stop. Do not spend tokens rewriting a good request.
3. If `run_refiner` is **true**: review the request and follow `${CLAUDE_PLUGIN_ROOT}/references/model-selection.md`. Run `STATE agent-model` for `prompt-refiner`, show the recommendation before starting, then call the Agent tool with `subagent_type: engineering-ops:prompt-refiner`, `model: <selected_model>`, passing the request, score JSON and (if inside a project) the output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs"`.
4. Show its result: score before → after, the improved request in a copyable block, max 3 questions, and what was added with sources.
5. Ask: use the improved request, edit it, or keep the original? If it is a task to run, offer `/engineering-ops:run-task` with the chosen text.

Never invent requirements, names or numbers; unknowns stay as `<placeholders>` with a question.
