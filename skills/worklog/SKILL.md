---
name: worklog
description: Track time on a task or bug fix — task name, start and end time, active duration (pauses excluded), time per workflow stage, and the GitHub PR comments and reviews about it. Use when the user says start/pause/stop working on a task, "how long did this take", or wants a work-log report (Markdown or CSV).
argument-hint: "start <id> [title] | pause <id> | stop <id> | list | report [md|csv] | github <id> [branch]"
---

# Work log

Times are recorded by the state script, not estimated by you. All times are stored in UTC; show them to the user in `config.timezone` (from `STATE config-get`) and name the zone.

`STATE` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --project <slug>` (equivalent: `${CLAUDE_SKILL_DIR}/../../scripts/state.mjs`). Run `STATE paths` once to learn the project slug and `state_dir`.

Arguments: `$ARGUMENTS`. If empty, show the six actions below as a numbered list and ask which one.

## Actions

1. **start `<id>` [title]** — `<id>` is the card ID or any short task key. If the title or URL is unknown, look it up with `STATE task-get --id <id>` (`card_name`, `card_url`); otherwise ask for a short title.
   `STATE task-start --id <id> --title "<title>" [--url <url>] [--kind BUG|FEATURE|MIXED]`. Starting again after a pause resumes the same task.
2. **pause `<id>`** — `STATE task-pause --id <id> [--note "<why>"]`.
3. **stop `<id>`** — `STATE task-stop --id <id>`. Report the active time.
4. **list** — `STATE worklog-list` → a table: task, status, started, ended, active time, running? Stage timings (from the task ledger) appear when the engineering pipeline recorded them.
5. **report [md|csv]** — `STATE worklog-export --format md|csv --out <path>`. Default path: `<state_dir>/exports/worklog-<date>.<ext>`. Write into the repository only if the user asks for a path there.
6. **github `<id>` [branch]** — collect PR comments and reviews for the task's branch:
   - `STATE worklog-github --id <id> [--branch <branch>]` runs `gh pr view` read-only.
   - If it returns `gh_not_installed`, explain that GitHub CLI is needed (`gh auth login`), or — if another GitHub tool is connected — fetch the PR's number, url, title, state, comments and reviews with it, save them as gh-style JSON (`{"number","url","title","state","comments":[{"author":{"login"},"body","createdAt"}],"reviews":[{"author":{"login"},"state","body","submittedAt"}]}`) and run `STATE worklog-github --id <id> --json-file <file>`.
   - Never post comments or change the PR.

## Rules
- Do not invent times. If the user says "I started at 9", pass it with `--at <ISO UTC time>` after converting from their time zone, and say you did so.
- One timer per task. A timer running more than `alerts.long_timer_hours` (default 8 h) shows up in `/engineering-ops:engineering` → Alerts.
