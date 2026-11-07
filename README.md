# Engineering Ops

A reusable Claude Code plugin that watches your task board and tells you, in one message, **which new or changed cards are assigned to you and what information is missing before you can start**. It also tracks how long each task takes (with its GitHub PR comments) and warns you when work is stuck.

It works with any project — frontend, backend or NetSuite — because it does not depend on your code layout. **v0.1 is read-only**: it never changes your cards, code or Git branches.

> Status: **v0.1.0** — Trello watcher, Card Check, work log, alerts. Agents, auditors, the dashboard, Codex packaging and Jira come in later versions (see [CHANGELOG](CHANGELOG.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## What you get

| Command | What it does |
|---|---|
| `/engineering-ops:engineering` | Menu: setup, check now, start/stop/status monitoring, analyze a card, work log, alerts |
| `/engineering-ops:task-watcher` | One read-only check of your board (used by the scheduler) |
| `/engineering-ops:worklog` | Start / pause / stop a task timer; Markdown or CSV report; GitHub PR comments |

**Card Check** gives every new or changed card `READY` or `MISSING_INFO` with the exact missing items:
- all cards: clear title, description, type (BUG / FEATURE / MIXED), screen or area
- BUG: steps to reproduce, expected result, actual result
- FEATURE: what the user should be able to do, acceptance criteria (or a checklist)

It never invents missing information.

## Requirements

- Claude Code (CLI or Desktop app)
- Node.js 18.17 or newer
- Trello access through the **Trello connector** (recommended) or a Trello API key + token in environment variables
- Optional: GitHub CLI (`gh`) for PR comments in the work log

## Install

From GitHub (after the repository is published):

```bash
claude plugin marketplace add <owner>/engineering-ops
```

```bash
claude plugin install engineering-ops@engineering-ops
```

From a local folder (for testing):

```bash
claude --plugin-dir "/path/to/engineering-ops"
```

Then open your project in Claude Code and run `/engineering-ops:engineering`.

## Quick start

1. `/engineering-ops:engineering` → **1. Initial setup** — answer the questions (board, lists, time zone, working hours, monitoring).
2. **2. Check my cards now** — see your cards and their Card Check.
3. **3. Start automatic monitoring** — every 30 minutes during your working hours.

Full guide: [docs/USER-GUIDE.md](docs/USER-GUIDE.md) (English + العربية).

## Where data is stored

Settings and state are kept **outside your repository**, in `~/.engineering-ops/projects/<project>/` (`config.json`, `ledger.json`, `worklog.json`, `alerts.json`, `notifications.json`). Nothing is added to your project. Secrets are never saved: setup refuses any token-like value.

## Monitoring limits (honest)

- **Claude Desktop scheduled task:** runs only while the Desktop app is open and the computer is awake. A missed check runs once when the app opens again.
- **`/loop`:** stops when the Claude Code session closes.
- No background service or OS scheduler is installed.

## Development

```bash
npm test
```

```bash
claude plugin validate .
```

63 automated tests cover locks (including races), the ledger and resume, the time window (DST), watcher ingest, Card Check, notifications de-duplication, the Trello REST client with mocked responses (auth failure, timeout, token scrubbing), the work log and alerts.

The design and the audit of the original system are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/AUDIT.md](docs/AUDIT.md).

## License

MIT
