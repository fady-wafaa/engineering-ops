---
name: market-scout
description: Competitor and feature-gap research for the current project — inventories our features from the code, finds comparable products and open-source projects (GitHub, Product Hunt, G2, Capterra, AlternativeTo), builds a sourced feature matrix, and ranks buildable recommendations to attract customers (impact × reach × confidence ÷ effort). Use for "compare us with competitors", "what features are we missing", "what should we build to get more customers".
argument-hint: "[product category] [target customers] [known competitors]"
---

# Market scout

Input: `$ARGUMENTS`. `STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"`; temp files in `<state_dir>/tmp/`.

## Ask first (one question at a time; skip what is known)
1. **Category** in one line ("last-mile delivery and fleet management for retailers").
2. **Target customers:** segment, company size, region/language (e.g. MENA, Arabic).
3. **Known competitors** (optional) — they are always included.
4. **Goal:** acquire new customers · convert trials · retain · expand accounts · win a specific segment.

## Steps
1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-stack.mjs" > <state_dir>/tmp/stack.json`.
2. Agent tool → `subagent_type: engineering-ops:market-scout`, `model: sonnet`, with the answers, the project root, and absolute paths of `stack.json` and `${CLAUDE_PLUGIN_ROOT}/references/audit-contract.md`. Tell it today's date, and tell it explicitly to use WebSearch in **extended** mode for every competitor search (never standard) — this audit needs thorough, current results, not a quick lookup. If web search is not available in this session, say so: the agent can then only inventory our own features and compare against competitors the user names with links they provide.
3. Save the report to `<state_dir>/reports/market-<date>.md`; record `STATE audit-record --kind market --json-file <file>` (target = category) so later runs can be compared.
4. Present: summary → recommendations table → the full report path. Offer to create a task for the first slice of recommendation #1 (`/engineering-ops:run-task`) — never create it without a yes.

Research only: no sign-ups, no contact with companies, no paid sources. Every competitor fact must carry a source link. All web research for this skill runs WebSearch in extended mode — it is the one audit in this plugin where that cost is justified (fresh, cross-checked competitor facts beat a cheap, shallow pass).
