# Audit contract (all auditors)

Every auditor is independent: it runs alone, on any project, when the user picks it. It never edits code, never deploys, never contacts people, and never self-starts from another agent's work. A finding the user wants fixed becomes a new task (`/engineering-ops:run-task`) with the audit as evidence.

## Evidence rules
1. **Observed, not assumed.** Every finding cites concrete evidence: `path:line` + symbol, a browser step + element, a measured number, a command output, or a source URL.
2. **Verify before reporting.** A scanner hit is a *candidate*. Read the code around it and confirm it is reachable and exploitable/harmful in this project before reporting it. Unconfirmed candidates go to "Needs review", never to findings.
3. **No invented numbers.** A metric the tools cannot show is reported as "not measurable here", not estimated.
4. **Scope is explicit.** State what was checked and what was not (pages, routes, packages, criteria). Coverage is part of the result.
5. **Data safety.** No tokens, cookies, passwords, personal data or full payloads in the report. Use synthetic test data. Production systems are out of scope unless the user explicitly says otherwise for read-only checks.

## Criterion scoring (same scale everywhere)
| Points | Meaning |
|---|---|
| 2 | Pass — demonstrated with evidence |
| 1 | Partial — works, with a specific observed problem |
| 0 | Fail — observed failure |
| — | Not tested — with the reason (no access, out of scope, tool missing) |

**Score** = round(100 × earned / (2 × criteria tested)). **Coverage** = tested / total. A score is withheld when coverage is below the agent's minimum (each agent states it) — report "insufficient coverage" instead.

## Severity (findings)
| Level | Meaning | Typical action |
|---|---|---|
| **Critical** | Exploitable now / blocks most users / data loss | Fix before next release |
| **High** | Serious risk or a broken key journey | Fix this sprint |
| **Medium** | Real problem with a workaround or limited reach | Plan it |
| **Low** | Minor friction or hardening | Backlog |
| **Info** | Good practice / observation | Optional |

## Verdict
`PASS` (score ≥ 85 and no Critical/High) · `PASS_WITH_ISSUES` (score ≥ 60, no Critical) · `FAIL` (score < 60 or any Critical) · `BLOCKED` (could not run: name the missing access/tool) · `INSUFFICIENT_COVERAGE`.

## Report format (in the user's configured language; code, paths, IDs exact)
1. **Verdict · Score · Coverage** — one line.
2. **Scope** — target, environment/build, account role, viewport/device, date (UTC), tools used.
3. **Criteria table** — criterion · points · evidence (one line).
4. **Findings** — ordered by severity. Each: ID · title · severity · location · evidence · impact (who/what is affected) · **fix** (concrete change, code example when useful) · how to verify the fix.
5. **Needs review** — unconfirmed candidates with what would confirm them.
6. **Strengths** — what is already good (with evidence).
7. **Not covered** — and why.
8. **Next step** — the single most valuable action.

## Saving
The skill saves the result with `STATE audit-record --kind <kind> --json-file <file>`:
`{"target","verdict","score","coverage":{"tested","total"},"criteria":[{"id","points","evidence"}],"findings":[{"id","title","severity","location","fix"}],"report_path"}`.
`STATE audit-list --kind <kind>` shows history; compare with the previous run of the same target ("score 62 → 81, 2 High fixed").
