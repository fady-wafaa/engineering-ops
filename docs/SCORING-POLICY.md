# Scoring policy — applicability, coverage and evidence

Policy version: `2026.11-applicability-1` (`SCORING_POLICY_VERSION` in `scripts/lib/audit.mjs`).

**These scores, criteria IDs, weights and coverage ratios are choices made by engineering-ops.** They are an internal review instrument, not a published standard. Only three things in this plugin carry external meaning:

* **WCAG 2.2 AA** outcomes in the accessibility audit (`A11Y-01`…`A11Y-12`) keep the pass/fail semantics of the WCAG success criteria they name.
* **OWASP Top 10:2025** categories in the security audit (`A01`…`A10`) keep OWASP's own category semantics.
* **Core Web Vitals** thresholds in the performance audit are the published web.dev values; every other performance threshold is an engineering-ops default.

Everything else — the 0/1/2 scale, the 85/60 verdict boundaries, the 4/6, 5/8 and 6/9 coverage ratios — is defined here and nowhere else. Scoping, sampling and result documentation follow the shape of [W3C WCAG-EM](https://www.w3.org/TR/WCAG-EM/): declare the scope, declare the sample, record one outcome per criterion, report what was not covered.

## 1. Three states per expected criterion

Every expected criterion gets exactly one state.

| `status` | `points` | Required extra field | Meaning |
|---|---|---|---|
| `assessed` | `0`, `1` or `2` | `evidence` | It was checked and the evidence is recorded. |
| `not_assessed` | `null` | `reason` | It applies, but it could not be checked (no test account, access blocked, tool missing, expected behaviour not specified). |
| `not_applicable` | `null` | `reason` + `basis` | It does not apply to this target, on a basis fixed **before** the audit (`basis: "scope"`) or on a confirmed product property (`basis: "product_property"`). |

`basis` must be `scope` or `product_property`. "I did not get to it" is **not** a basis — that is `not_assessed`.

Optional `reason_code` on `not_assessed`, validated when present: `no_test_account`, `access_blocked`, `tool_unavailable`, `expected_undefined`, `requirement_unclear`, `out_of_scope_data`, `other`.

**Legacy records.** A criterion with `points: null` and no `status` is read as `not_assessed`. Records written before this policy keep that meaning.

**Contradictions are rejected, not repaired.** `assessed` with `points: null`, `not_assessed`/`not_applicable` carrying a number in `points`, `not_applicable` without a basis, an unknown status and an unknown `reason_code` each withhold the score with a validation error.

### Composite criteria and sub-checks

A criterion that bundles several checks (UX `J*-6` = keyboard + narrow layout + RTL) carries `sub_checks: [{id, status, points?, reason?, basis?}]`.

* RTL on a product with no right-to-left language is `not_applicable` with `basis: "product_property"` — **as a sub-check**. The keyboard and narrow-layout sub-checks stay applicable, and the parent criterion stays applicable.
* A parent criterion cannot be scored `2` while an applicable sub-check is `not_assessed`. That is a validation error.
* A parent whose sub-checks are *all* `not_applicable` must itself be `not_applicable`.

## 2. Coverage is computed over applicable criteria

```
applicable   = expected − not_applicable
assessed     = criteria with status "assessed"
not_assessed = applicable − assessed
ratio        = assessed / applicable
```

`not_assessed` criteria stay in the denominator. Dropping them would turn "we could not test it" into "it does not count".

The report shows all four numbers: **expected · assessed · not assessed · not applicable**.

The score is withheld when there is no applicable criterion (`verdict: NOT_APPLICABLE`) and when nothing applicable was assessed (`verdict: BLOCKED`).

### The coverage rule is an exact ratio

`min_coverage` is an exact ratio, not a decimal: `"4/6"`, `"5/8"`, `"6/9"`. The check is integer arithmetic — `assessed × den ≥ num × applicable` — so 4 of 6 passes a `4/6` rule. A decimal `0.67` does **not** admit 4 of 6 (0.6667 < 0.67); that mismatch between the agent definitions and the skills is exactly what this form fixes. Decimals are still accepted for old inputs.

After a criterion is excluded as `not_applicable`, **the same ratio applies to the reduced applicable count**: `4/6` with 5 applicable criteria needs `ceil(4 × 5 / 6) = 4`.

| Audit | Expected | Coverage rule | Required criterion |
|---|---|---|---|
| UX | 6 per journey | `4/6` per journey | `J<n>-3` goal completion |
| UI test | 8 | `5/8` | `UI-1` happy path |
| Architecture | 9 | `6/9` | — |
| Accessibility | 12 | `8/12` | — |
| Security | 10 | `7/10` | — |

## 3. Required criteria gate the verdict

`required_criteria` names the criteria that decide whether a success verdict is allowed at all.

* Required criterion **assessed with 0 points** → `verdict: FAIL`, whatever the other scores add up to. A journey whose goal cannot be reached is not a pass because its labels were clear.
* Required criterion **`not_assessed`** → `verdict: INSUFFICIENT_COVERAGE`, score withheld, and `required.not_assessed` names it. The report must not read as a failure.
* Required criterion **`not_applicable`** → validation error. If the scope really is one step of a journey, name that scope up front and leave goal completion out of `expected_criteria` and `required_criteria`; the verdict then covers that step only.

A confirmed failure and an untested requirement are different facts, and the record keeps them apart.

## 4. Comparing two runs

Two scores are comparable only when **all** of the following match:

1. the stated test `conditions` (every key),
2. the scoring policy: `policy_version`, `min_coverage`, `required_criteria`,
3. the set of **applicable** criterion IDs,
4. the set of **assessed** criterion IDs.

Otherwise `audit-record` returns `comparison_unavailable` with the mismatching keys and no before/after delta. Changing a budget, or excluding a criterion as not applicable, therefore stops the comparison instead of producing a flattering number.

**A finding missing from a later report is not a fixed finding.** It is reported as `fixed` only when the run that produced it was repeated under matching conditions; otherwise the recorder reports the mismatch and claims nothing.

## 5. Performance thresholds and budgets

| Kind | Source | Scored |
|---|---|---|
| LCP, INP, CLS | published Core Web Vitals (web.dev) | yes, as lab medians, labelled lab |
| FCP, TTFB, blocking, transfer, slowest API, repeated requests | engineering-ops defaults | yes, labelled `engineering_ops_default` |
| `result_visible_ms`, `spa_navigation_ms`, `action_ms` | **a project or user budget only** | only with a budget |

* **No budget, measured** → the value and the sample count are reported as a baseline: `points: null`, `status: "measured_no_budget"`, outside the score.
* **Budget, not measured** → `status: "required_not_measured"`, `points: null`, recorded as owed.
* **A single maximum** → met (2) or exceeded (0). There is no middle band: an intermediate score needs a declared `needs_improvement_max_ms`.
* Each budget records `source`, `unit`, `measure_start`, `measure_end`, `summary` (how the samples were reduced) and `scenario`. A measurement is compared with a budget only when the scenario and the summary method agree.
* The legacy `action_budget_ms` default of 1000 ms is still read, and is marked `kind: "legacy_default"` on the criterion so reports can tell it apart from an approved scenario budget.

### Lab is not field

Lab runs produce `lab_core_web_vitals` only. A **field** Core Web Vitals assessment uses the **75th percentile** of field data for the relevant device class, and passes only when LCP, INP **and** CLS all meet their targets. With partial or missing field data the result is `{assessed: false, reason, available: […]}` and `core_web_vitals_pass` stays `null`. Successful browser runs never produce a field pass.

## References

* [W3C WCAG-EM — scope, sampling, recording results](https://www.w3.org/TR/WCAG-EM/)
* [ISO 9241-11 context of use, as cited by NIST](https://csrc.nist.gov/glossary/term/Usability)
* [Nielsen Norman — how to conduct a heuristic evaluation](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/) · [the ten usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
* [ISTQB CTFL v4.0.1 §1.4.1, 4.2, 4.5.2, 5.1.3, 5.2.3](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf)
* [CMU SEI — evaluating system architecture with scenarios](https://www.sei.cmu.edu/history-of-innovation/evaluating-system-architecture/)
* [Web Vitals](https://web.dev/articles/vitals) · [lab and field data](https://web.dev/articles/lab-and-field-data-differences) · [performance budgets](https://web.dev/articles/performance-budgets-101)
