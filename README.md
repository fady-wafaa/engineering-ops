# Engineering Ops

Engineering Ops is a Claude Code plugin for teams that use Trello. It shows your new or changed cards and tells you what information is missing. It can also take one card, check the problem, change the code, run tests, and review the result.

You can use the same plugin in frontend, backend, and NetSuite projects. Each project has its own settings. Choose **full** mode when you want Claude to change code on a branch for the task.

> Status: **v0.3.0** — watcher, Card Check, work log, alerts, core agents, model routing, prompt refiner, stack detection, branch guard, and seven specialist agents (security, accessibility, performance, UI test, UX, architecture, market scout). The dashboard, Codex packaging and Jira come next (see [CHANGELOG](CHANGELOG.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## What you get

| Command | What it does |
|---|---|
| `/engineering-ops:engineering` | Menu: setup, check now, start/stop/status monitoring, analyze a card, work log, alerts, workflow setup, run a task |
| `/engineering-ops:run-task` | One card through 9 stages: intake → browser baseline → analysis → questions → mode + branch gate → implementation → checks → review → report |
| `/engineering-ops:refine-prompt <request>` | Checks how clear your request is and offers a rewrite if needed. |
| `/engineering-ops:task-watcher` | One read-only check of your board (used by the scheduler) |
| `/engineering-ops:worklog` | Tracks time on a task and can add GitHub pull request comments to the work log. |
| `/engineering-ops:engineering alerts` | Shows tasks that are stuck or waiting and suggests what to do next. |

`run-task` calls the workflow agents for you. See [what each agent does](#what-each-agent-does).

## What you need

| When | What you need |
|---|---|
| For all commands | Claude Code in the terminal or the Claude Desktop **Code** tab, and Node.js 18.17 or newer. |
| To check your Trello cards | Access to the board and the Trello connector, or `TRELLO_API_KEY` and `TRELLO_TOKEN` set on your computer. Keep keys and tokens out of chat. |
| To analyze a Trello card | The Trello connector for the full card and the project folder if you want Claude to find related code. |
| To run the full workflow | The app's Git repository, its test commands, and the branch rules for your team. For an app with a browser UI, set up browser tools and give Claude the Testing and Local URLs and a test account if needed. |
| To add GitHub pull request comments to a work log | GitHub CLI (`gh`) with access to the pull request. |

## Install

To install from GitHub, run these commands once in your terminal.

```bash
claude plugin marketplace add fady-wafaa/engineering-ops
```

```bash
claude plugin install engineering-ops@engineering-ops
```

From a local folder (for testing):

```bash
claude --plugin-dir "/path/to/engineering-ops"
```

Then open your project in Claude Code and run `/engineering-ops:engineering`.

## Set up your project

1. Open the app's project folder in Claude Code and type `/engineering-ops:engineering` in the chat.
2. Choose **1. Initial setup**. Connect Trello, choose the board and lists, and set your time zone. Choose manual checks if you want to run each check yourself.
3. If you plan to use `run-task`, choose **9. Workflow setup**. Check the test commands Claude finds. Set the Git branch rules, Testing URL, Local URL, and test data for this project.

Run setup again when you start using the plugin in a different project. See the [full user guide](docs/USER-GUIDE.md).

## Choose what to run

Type these commands in **Claude Code chat**. Replace `<card-url>` with your Trello card link.

| I want to… | Command | What I get |
|---|---|---|
| Check my cards now | `/engineering-ops:engineering check` | A list of new or changed cards assigned to me. Each card shows `READY` or `MISSING_INFO` with the details I need to add. |
| Read and understand one card | `/engineering-ops:engineering analyze <card-url>` | A summary, the current and wanted behavior, missing details, draft questions, and related files if Claude can find them. This option is read-only and skips browser tests. |
| Try the problem and plan the fix | `/engineering-ops:run-task <card-url> intake-only` | A check of the current behavior, an analysis, and a plan for the developer. It stops before branch setup and code changes. |
| Fix, test, and review one card | `/engineering-ops:run-task <card-url> full` | A change on a task branch, test results, a code review, and a report when the required checks are complete. |
| Start automatic checks | `/engineering-ops:engineering start` | A check every 30 minutes during your work hours. |
| Stop automatic checks | `/engineering-ops:engineering stop` | Turns off automatic checks. |
| See if checks are running | `/engineering-ops:engineering status` | Shows the current monitoring status. |
| Track time on a card | `/engineering-ops:worklog start <card-id>` | Starts a timer. Use `/engineering-ops:worklog pause <card-id>` to pause it or `/engineering-ops:worklog stop <card-id>` to finish. |
| Export my work log | `/engineering-ops:worklog report md` or `/engineering-ops:worklog report csv` | A report in Markdown or CSV. |

### If you do not write code

Ask a teammate to help you install the plugin and connect your Trello account the first time. Then open the project in Claude Desktop's **Code** tab and type `/engineering-ops:engineering` in the chat. Choose **2. Check my cards now** to see your cards, or **6. Analyze a card** and paste a link to get a report on one card. You can share that report with a developer. Both options are read-only.

For example, if a card says “The map is broken,” the report can ask for the screen name, the steps to see the problem, what happened, and what should happen. Add those details to the card and check it again.

## What happens in a full run

| Step | What happens |
|---|---|
| 1. Read the card | Claude reads the card and checks for missing details. |
| 2. Check the app before changes | For a bug, Claude tries the steps in Testing. It needs to see the bug before it can change code. For a new feature, it records what the app does today. |
| 3. Make a plan | Claude finds the code that may need work and writes what the fix must do. |
| 4. Ask questions | If a key detail is missing, Claude drafts questions and waits for the answers it needs. |
| 5. Check the mode and branch | In `intake-only`, Claude gives you the plan here. In `full`, Claude checks the branch rules before it edits code. |
| 6. Change the code | Claude makes the change on the task branch and adds a test for the bug when practical. |
| 7. Test the change | Claude runs the project's test commands and repeats the browser steps on the local app when a browser check applies. |
| 8. Review the code | Claude checks the same change that passed through testing. If a fix is needed, it can repair the code and run the checks again. |
| 9. Share the report | Claude shows the branch, changed files, test results, review notes, and your next step. `READY_FOR_REVIEW` means the change is ready for a person to review. Commit, push, merge, deploy, and Trello updates each need your explicit permission. |

If a run stops, use `/engineering-ops:run-task continue <card-id>` to pick up from the last valid step. See the [workflow rules](references/workflow.md).

## What each agent does

| Agent | Its job | What it gives back |
|---|---|---|
| [`orchestrator`](agents/orchestrator.md) | Leads the run, calls agents in order, and saves progress. | The current step and the final report. |
| [`prompt-refiner`](agents/prompt-refiner.md) | Helps when the request is hard to understand. | A clearer request that you can use, edit, or skip. |
| [`browser-qa`](agents/browser-qa.md) | Tries the steps in Testing before a change and in the local app after it. | Steps tried, what happened, and screenshots or other evidence when available. |
| [`requirements-analyst`](agents/requirements-analyst.md) | Reads the card, checks related code, and plans the work. | Files to look at, what the fix must do, and open questions. |
| [`code-implementer`](agents/code-implementer.md) | Makes the change on the checked branch in `full` mode. | Changed files, tests added, and notes for the next agent. |
| [`quality-gate`](agents/quality-gate.md) | Runs the project's test commands on the exact change. | Commands run, results, and checks it could not run. |
| [`code-reviewer`](agents/code-reviewer.md) | Reads the change and checks it against the card and the test results. | Review findings and any fixes needed before human review. |


## Specialist checks

Run these checks when you want to look at one part of the app. Each report shows the result, the score, what the agent checked, and what you can fix. If there is a past report for the same target, you can see what changed.

| Command | Agent | Goal | Standard / criteria |
|---|---|---|---|
| `/engineering-ops:security-audit` | security-auditor | Confirmed vulnerabilities, each with an exploit scenario and a code fix | OWASP Top 10:2025, 10 criteria |
| `/engineering-ops:accessibility-audit` | accessibility-auditor | Can keyboard, screen-reader and zoom users complete the pages? | WCAG 2.2 AA, 12 criteria |
| `/engineering-ops:performance-audit` | performance-auditor | How fast is it, where does the time go, what to fix first | Core Web Vitals, 3 runs, median |
| `/engineering-ops:ui-test` | ui-tester | Does the feature work? Reproducible bug reports | 8 criteria, test plan first |
| `/engineering-ops:ux-audit` | ux-auditor | Where users hesitate or fail; testable improvements | 6 criteria per journey |
| `/engineering-ops:architecture-audit` | architecture-auditor | How the system is built; smallest change for your goal | 9 criteria |
| `/engineering-ops:market-scout` | market-scout | Feature gaps vs competitors; features ranked to win customers | sourced matrix, impact × reach × confidence ÷ effort |

A script uses the same scoring rules each time. For security and accessibility, a script first looks for possible problems in the code. The agent checks which problems are real. The scan hides secret values in its output.

**Model routing:** each task is sized S / M / L / XL from simple signals (files, ambiguity, shared code, cross-layer, security, migration). Cheap stages run on Haiku, code and analysis on Sonnet; a premium model is only *proposed* for a named stage and needs your approval.

**Card Check** gives every new or changed card `READY` or `MISSING_INFO` with the exact missing items:
- all cards: clear title, description, type (BUG / FEATURE / MIXED), screen or area
- BUG: steps to reproduce, expected result, actual result
- FEATURE: what the user should be able to do, acceptance criteria (or a checklist)

It never invents missing information.

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
