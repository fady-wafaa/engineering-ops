# Model preflight for every Engineering Ops agent

Before starting an agent, review the user's request, scope, available evidence and the agent's job. Save a JSON input and run `STATE agent-model --json-file <file>` with:

`{"agent":"<agent name>","scope_items":<pages, cases or estimated files>,"ambiguity":"low|medium|high","cross_layer":false,"security_sensitive":false,"shared_code":false,"failed_attempts":0,"requires_browser":false}`.

Do not invent a scope count. Omit an unknown field; the router explains the uncertainty. Show the user **default model → recommended model**, the concrete reasons, and whether a change is proposed **before** invoking the agent. Use `selected_model` for the Agent call. A premium recommendation stays on Sonnet until the user explicitly approves that named agent and bounded scope; then rerun with `premium_approved:true`. If the requested model is unavailable in the host, use the available fallback and report the actual model. Do not describe a proposal as an actual switch.

For the nine-stage workflow, `route-task` remains the router. Run it before the first worker, including `prompt-refiner`; use `worker_models[agent].selected_model` and show each proposed change before starting. Stage 7 has separate choices for `quality-gate` and `browser-qa`. Re-run after requirements analysis and show any changed recommendation before the affected next stage. Record planned and actual models in the task packet and ledger.
