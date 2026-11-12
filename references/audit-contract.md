# Audit contract (all auditors)

Every auditor is independent: it runs alone, on any project, when the user picks it. It never edits code, never deploys, never contacts people, and never self-starts from another agent's work. A finding the user wants fixed becomes a new task (`/engineering-ops:run-task`) with the audit as evidence.

The score, the criterion IDs, the weights and the coverage ratios in this contract are **engineering-ops' own review instrument, not a published standard**. The exceptions are stated where they apply: WCAG 2.2 AA outcomes in the accessibility audit, OWASP Top 10:2025 categories in the security audit, and the published Core Web Vitals thresholds in the performance audit keep their own meaning. Say so in the report. The full rules live in `docs/SCORING-POLICY.md`; scoping, sampling and result recording follow the shape of [W3C WCAG-EM](https://www.w3.org/TR/WCAG-EM/).

## Evidence rules
1. **Observed, not assumed.** Every finding cites concrete evidence: `path:line` + symbol, a browser step + element, a measured number, a command output, or a source URL.
2. **Verify before reporting.** A scanner hit is a *candidate*. Read the code around it and confirm it is reachable and exploitable/harmful in this project before reporting it. Unconfirmed candidates go to "Needs review", never to findings.
3. **No invented numbers.** A metric the tools cannot show is reported as "not measurable here", not estimated.
4. **Scope is explicit.** State what was checked and what was not (pages, routes, packages, criteria). Coverage is part of the result.
   Include the test conditions: scope, environment, build mode (development or production), role, language, device/viewport and relevant dataset. Record the revision separately: code changes are expected in a before/after comparison. A later score is comparable only under matching test conditions; explain any mismatch instead of showing a before/after gain.
5. **Data safety.** No tokens, cookies, passwords, personal data or full payloads in the report. Use synthetic test data. Production systems are out of scope unless the user explicitly says otherwise for read-only checks.

## Three states per expected criterion

Every criterion the audit expected gets exactly one state. There is no fourth option and no silent omission.

| `status` | `points` | Also required | Meaning |
|---|---|---|---|
| `assessed` | `2` / `1` / `0` | `evidence` | Checked, with evidence. 2 = demonstrated pass · 1 = works, with a specific observed problem · 0 = observed failure. |
| `not_assessed` | `null` | `reason` | It applies here, but it could not be checked — no test account, access blocked, tool missing, the expected behaviour was never specified. |
| `not_applicable` | `null` | `reason` + `basis` | It does not apply, on a `scope` fixed before the audit or a confirmed `product_property`. |

`basis` is `scope` or `product_property` only. **"I ran out of time" is never a basis** — that is `not_assessed`. When applicability is undecided, use `not_assessed` and say why.

Optional `reason_code` on `not_assessed`: `no_test_account`, `access_blocked`, `tool_unavailable`, `expected_undefined`, `requirement_unclear`, `out_of_scope_data`, `other`.

**Composite criteria** (keyboard + narrow layout + RTL in one criterion) carry `sub_checks: [{id, status, points?, reason?, basis?}]`. RTL on a product with no right-to-left language is a `not_applicable` **sub-check** — it never removes the parent criterion, and the keyboard and layout sub-checks keep their own result. A parent cannot be scored `2` while an applicable sub-check is `not_assessed`.

**Contradictions are refused, not repaired.** `audit-record` stores nothing when a criterion is `assessed` without points, carries points while `not_assessed`/`not_applicable`, is `not_applicable` without a basis, or uses an unknown status or reason code.

Old records with `points: null` and no status still mean **not assessed**.

## Coverage and score

```
applicable = expected − not_applicable          (not_assessed stays in the denominator)
score      = round(100 × earned / (2 × assessed))
```

The report shows four numbers: **expected · assessed · not assessed · not applicable**.

`min_coverage` is an **exact ratio** — `"4/6"`, `"5/8"`, `"6/9"` — not a decimal. After a criterion is excluded as not applicable, the same ratio applies to the reduced applicable count (`4/6` of 5 applicable = 4).

The score is withheld when **no criterion applies** (`NOT_APPLICABLE`), when **nothing applicable was assessed** (`BLOCKED`), and when coverage is below the rule (`INSUFFICIENT_COVERAGE`).

**Required criteria** (`required_criteria`) gate the verdict:
* assessed at 0 → `FAIL`, whatever the rest of the scores add up to;
* `not_assessed` → `INSUFFICIENT_COVERAGE`, score withheld — this is **not** a failure, and the report must not read like one;
* `not_applicable` → refused. Narrow the declared scope up front instead, and keep the verdict to that step.

Every expected criterion has one stable ID. Duplicate, missing or unexpected IDs, missing evidence and missing reasons withhold a strict score. The skill passes `expected_criteria`, `required_criteria` and `min_coverage` to the recorder; the recorder computes the score, never the agent. State sample sizes and scanner caps when relevant. Numbered finding IDs are for display; before/after finding matching uses a stable location and title when available.

## Severity (findings)
| Level | Meaning | Typical action |
|---|---|---|
| **Critical** | Exploitable now / blocks most users / data loss | Fix before next release |
| **High** | Serious risk or a broken key journey | Fix this sprint |
| **Medium** | Real problem with a workaround or limited reach | Plan it |
| **Low** | Minor friction or hardening | Backlog |
| **Info** | Good practice / observation | Optional |

## Verdict
`PASS` (score ≥ 85 and no Critical/High) · `PASS_WITH_ISSUES` (score ≥ 60, no Critical) · `FAIL` (score < 60, any Critical, or a failed required criterion) · `BLOCKED` (nothing applicable could be assessed — name the missing access/tool) · `INSUFFICIENT_COVERAGE` (below the coverage rule, or a required criterion not assessed) · `NOT_APPLICABLE` (no expected criterion applies to this target).

## Comparing with an earlier run

Two scores are comparable only when the stated **conditions**, the **scoring policy** (`policy_version`, `min_coverage`, `required_criteria`), any **budgets**, and the sets of **applicable** and **assessed** criterion IDs all match. Otherwise `audit-record` returns `comparison_unavailable` and no delta — show that instead of a gain.

**A finding missing from a later report is not a fixed finding.** Call it fixed only when the case that produced it was re-run under matching conditions, or when there is direct evidence of the fix (the change and a check of it).

## Report format (in the user's configured language; code, paths, IDs exact)
1. **Verdict · Score · Coverage** — one line, with expected / assessed / not assessed / not applicable.
2. **Scope** — target, environment/build, account role, viewport/device, date (UTC), tools used, and what was declared out of scope before the audit.
3. **Criteria table** — criterion · status · points · evidence or reason (one line). Not-applicable rows stay visible with their basis; so do not-assessed rows.
4. **Findings** — ordered by severity. Each: ID · title · severity · location · evidence · impact (who/what is affected) · **fix** (concrete change, code example when useful) · how to verify the fix.
5. **Needs review** — unconfirmed candidates with what would confirm them.
6. **Strengths** — what is already good (with evidence).
7. **Not covered** — not assessed (with reasons) and not applicable (with bases), kept apart.
8. **Next step** — the single most valuable action.

State once, plainly, that the score and the coverage ratio are this plugin's internal instrument.

## Saving
The skill saves the result with `STATE audit-record --kind <kind> --json-file <file>`:

```json
{"target": "…",
 "conditions": {"scope": "…", "environment": "…", "role": "…", "language": "…", "device": "…"},
 "expected_criteria": ["…"], "required_criteria": ["…"], "min_coverage": "4/6", "total_criteria": 6,
 "criteria": [
   {"id": "…", "status": "assessed", "points": 2, "evidence": "…"},
   {"id": "…", "status": "not_assessed", "points": null, "reason": "…", "reason_code": "no_test_account"},
   {"id": "…", "status": "not_applicable", "points": null, "reason": "…", "basis": "product_property",
    "sub_checks": [{"id": "…", "status": "…", "points": null, "reason": "…"}]}],
 "findings": [{"id": "…", "title": "…", "severity": "…", "location": "…", "fix": "…"}],
 "budgets": {"result_visible_ms": {"max_ms": 1000, "source": "…"}},
 "report_path": "…"}
```

`STATE audit-list --kind <kind>` shows history; compare with the previous run of the same target only when the recorder returns a `comparison`.
