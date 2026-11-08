# Engineering Ops

A reusable Claude Code plugin that watches your task board and tells you, in one message, **which new or changed cards are assigned to you and what information is missing before you can start** — then takes a card from intake to a tested, reviewed change with a small team of agents, using the cheapest model that fits each step. It also tracks how long each task takes (with its GitHub PR comments) and warns you when work is stuck.

It works with any project — frontend, backend or NetSuite — and detects the stack, test commands and entry points itself. Monitoring and analysis are read-only; code changes happen only when you choose **full** mode for a task, on a verified task branch. It never commits, pushes, merges, deploys or updates cards without your explicit permission.

> Status: **v0.3.0** — watcher, Card Check, work log, alerts, core agents, model routing, prompt refiner, stack detection, branch guard, and seven specialist agents (security, accessibility, performance, UI test, UX, architecture, market scout). The dashboard, Codex packaging and Jira come next (see [CHANGELOG](CHANGELOG.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## What you get

| Command | What it does |
|---|---|
| `/engineering-ops:engineering` | Menu: setup, check now, start/stop/status monitoring, analyze a card, work log, alerts, workflow setup, run a task |
| `/engineering-ops:run-task` | One card through 9 stages: intake → browser baseline → analysis → questions → mode + branch gate → implementation → checks → review → report |
| `/engineering-ops:refine-prompt` | Free score of a request; a better version only when it is weak |
| `/engineering-ops:task-watcher` | One read-only check of your board (used by the scheduler) |
| `/engineering-ops:worklog` | Start / pause / stop a task timer; Markdown or CSV report; GitHub PR comments |

**Workflow agents** (each usable alone, e.g. `@agent-engineering-ops:code-reviewer`): `orchestrator`, `browser-qa`, `requirements-analyst`, `code-implementer`, `quality-gate`, `code-reviewer`, `prompt-refiner`.

### Specialist agents — pick the one you need

Each is independent, has one goal and numbered scoring criteria, and returns the same report format: **verdict · score · coverage**, findings by severity with a concrete fix, what was not covered, and a before/after comparison with the previous run.

| Command | Agent | Goal | Standard / criteria |
|---|---|---|---|
| `/engineering-ops:security-audit` | security-auditor | Confirmed vulnerabilities, each with an exploit scenario and a code fix | OWASP Top 10:2025, 10 criteria |
| `/engineering-ops:accessibility-audit` | accessibility-auditor | Can keyboard, screen-reader and zoom users complete the pages? | WCAG 2.2 AA, 12 criteria |
| `/engineering-ops:performance-audit` | performance-auditor | How fast is it, where does the time go, what to fix first | Core Web Vitals, 3 runs, median |
| `/engineering-ops:ui-test` | ui-tester | Does the feature work? Reproducible bug reports | 8 criteria, test plan first |
| `/engineering-ops:ux-audit` | ux-auditor | Where users hesitate or fail; testable improvements | 6 criteria per journey |
| `/engineering-ops:architecture-audit` | architecture-auditor | How the system is built; smallest change for your goal | 9 criteria |
| `/engineering-ops:market-scout` | market-scout | Feature gaps vs competitors; features ranked to win customers | sourced matrix, impact × reach × confidence ÷ effort |

Scores and verdicts are computed by a script (not by the model), so they are consistent between agents and between runs. A free static pre-scan (`scripts/audit-scan.mjs`) finds security and accessibility candidates in code before any model runs; agents only confirm them. Secret values are never printed.

**Model routing:** each task is sized S / M / L / XL from simple signals (files, ambiguity, shared code, cross-layer, security, migration). Cheap stages run on Haiku, code and analysis on Sonnet; a premium model is only *proposed* for a named stage and needs your approval.

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

108 automated tests cover locks (including races), the ledger and resume, the time window (DST), watcher ingest, Card Check, notification de-duplication, the Trello REST client with mocked responses (auth failure, timeout, token scrubbing), the work log, alerts, stack detection (React, Next, Express, Django, NetSuite SDF, monorepos), model routing, prompt scoring, the branch guard (including the real hook process), change identity, the static scanner (planted issues and safe look-alikes, secret redaction), audit scoring and history, and performance thresholds.

The design and the audit of the original system are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/AUDIT.md](docs/AUDIT.md).

## License

MIT
