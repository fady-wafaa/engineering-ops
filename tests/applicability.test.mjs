// Acceptance tests for docs/SCORING-POLICY.md — applicability, coverage, required criteria,
// performance budgets and field-vs-lab separation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compareScoringBasis, meetsCoverage, parseCoverageRule, scoreAudit } from "../scripts/lib/audit.mjs";
import { assessFieldCoreWebVitals, pointsAgainstBudget, scorePerf } from "../scripts/lib/perf.mjs";

const state = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "state.mjs");
const cli = (dir, command, data, ...options) => {
  const file = path.join(dir, `${command}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  const result = spawnSync(process.execPath, [state, command, ...options, "--json-file", file], { encoding: "utf8", env: { ...process.env, ENGOPS_STATE_DIR: dir } });
  return JSON.parse(result.stdout);
};
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const assessed = (id, points, evidence = `observed on ${id}`) => ({ id, status: "assessed", points, evidence });
const notAssessed = (id, reason, reason_code) => ({ id, status: "not_assessed", points: null, reason, ...(reason_code ? { reason_code } : {}) });
const notApplicable = (id, reason, basis = "product_property") => ({ id, status: "not_applicable", points: null, reason, basis });

const UX_JOURNEY = ["J1-1", "J1-2", "J1-3", "J1-4", "J1-5", "J1-6"];
const ARCH = ["ARCH-1", "ARCH-2", "ARCH-3", "ARCH-4", "ARCH-5", "ARCH-6", "ARCH-7", "ARCH-8", "ARCH-9"];
const UI = ["UI-1", "UI-2", "UI-3", "UI-4", "UI-5", "UI-6", "UI-7", "UI-8"];

describe("coverage rules are exact ratios", () => {
  it("admits 4 of 6, 5 of 8 and 6 of 9, which the old 0.67 decimal rejected", () => {
    assert.equal(meetsCoverage(4, 6, parseCoverageRule("4/6")), true);
    assert.equal(meetsCoverage(6, 9, parseCoverageRule("6/9")), true);
    assert.equal(meetsCoverage(5, 8, parseCoverageRule("5/8")), true);
    // The contradiction this replaces: the agents said 4/6 and 6/9, the skills passed 0.67.
    assert.equal(meetsCoverage(4, 6, parseCoverageRule(0.67)), false);
    assert.equal(meetsCoverage(6, 9, parseCoverageRule(0.67)), false);
  });

  it("ACCEPTANCE 1: 4 assessed of 6 in UX passes, 6 of 9 in Architecture passes", () => {
    const ux = scoreAudit({
      expected_criteria: UX_JOURNEY, total_criteria: 6, min_coverage: "4/6", required_criteria: ["J1-3"],
      criteria: [
        assessed("J1-1", 2), assessed("J1-2", 2), assessed("J1-3", 2), assessed("J1-4", 2),
        notAssessed("J1-5", "no safe way to trigger the error state without changing data", "out_of_scope_data"),
        notAssessed("J1-6", "no keyboard-capable browser session in this run", "tool_unavailable"),
      ],
      findings: [],
    });
    assert.equal(ux.verdict, "PASS");
    assert.equal(ux.score, 100);
    assert.deepEqual([ux.coverage.expected, ux.coverage.applicable, ux.coverage.assessed, ux.coverage.not_assessed, ux.coverage.not_applicable], [6, 6, 4, 2, 0]);

    const arch = scoreAudit({
      expected_criteria: ARCH, total_criteria: 9, min_coverage: "6/9",
      criteria: [
        ...["ARCH-1", "ARCH-2", "ARCH-3", "ARCH-4", "ARCH-5", "ARCH-6"].map((id) => assessed(id, 2)),
        ...["ARCH-7", "ARCH-8", "ARCH-9"].map((id) => notAssessed(id, "outside the sampled paths for this run")),
      ],
      findings: [],
    });
    assert.equal(arch.verdict, "PASS");
    assert.equal(arch.coverage.min_assessed, 6);
  });

  it("applies the same ratio to the applicable count after an exclusion", () => {
    const criteria = [
      assessed("UI-1", 2), assessed("UI-2", 2), assessed("UI-3", 2), assessed("UI-4", 2),
      notAssessed("UI-5", "deep links are not part of this build"),
      notAssessed("UI-7", "no mobile device available"),
      notAssessed("UI-8", "console access not exposed by the tool"),
      notApplicable("UI-6", "the product has a single role; no permission rules exist", "product_property"),
    ];
    const r = scoreAudit({ expected_criteria: UI, total_criteria: 8, min_coverage: "5/8", required_criteria: ["UI-1"], criteria, findings: [] });
    // 7 applicable, 5/8 of 7 = ceil(4.375) = 5, only 4 assessed.
    assert.equal(r.coverage.applicable, 7);
    assert.equal(r.coverage.min_assessed, 5);
    assert.equal(r.verdict, "INSUFFICIENT_COVERAGE");
    assert.match(r.reason, /assessed 4\/7 applicable, minimum 5 \(5\/8\)/);
  });

  it("withholds the score when nothing applies, and separates that from nothing assessed", () => {
    const none = scoreAudit({
      expected_criteria: ["X-1", "X-2"], total_criteria: 2, min_coverage: "1/2",
      criteria: [notApplicable("X-1", "feature absent", "scope"), notApplicable("X-2", "feature absent", "scope")], findings: [],
    });
    assert.equal(none.verdict, "NOT_APPLICABLE");
    assert.equal(none.score, null);

    const blocked = scoreAudit({
      expected_criteria: ["X-1", "X-2"], total_criteria: 2, min_coverage: "1/2",
      criteria: [notAssessed("X-1", "no test account"), notAssessed("X-2", "no test account")], findings: [],
    });
    assert.equal(blocked.verdict, "BLOCKED");
  });

  it("reads a legacy record with points: null as not assessed", () => {
    const legacy = scoreAudit({ criteria: [{ id: "A", points: 2, evidence: "ok" }, { id: "B", points: null, evidence: "browser unavailable" }], findings: [] });
    assert.equal(legacy.coverage.not_assessed, 1);
    assert.equal(legacy.coverage.not_applicable, 0);
    assert.equal(legacy.criteria_status.find((c) => c.id === "B").status, "not_assessed");
    assert.deepEqual(legacy.contradictions, []);
  });
});

describe("ACCEPTANCE 2: RTL applicability", () => {
  const journey = (rtl) => ({
    expected_criteria: UX_JOURNEY, total_criteria: 6, min_coverage: "4/6", required_criteria: ["J1-3"],
    criteria: [
      assessed("J1-1", 2), assessed("J1-2", 2), assessed("J1-3", 2), assessed("J1-4", 2), assessed("J1-5", 2),
      {
        id: "J1-6", status: "assessed", points: 1, evidence: "focus order is correct; the 375 px layout clips the action bar",
        sub_checks: [
          { id: "J1-6.keyboard", status: "assessed", points: 2, evidence: "tab order reaches every control" },
          { id: "J1-6.narrow", status: "assessed", points: 1, evidence: "action bar clipped at 375 px" },
          rtl,
        ],
      },
    ],
    findings: [],
  });

  it("an English-only product records RTL as not applicable and keeps the composite criterion", () => {
    const r = scoreAudit(journey({ id: "J1-6.rtl", status: "not_applicable", points: null, basis: "product_property", reason: "the product ships English only; no right-to-left locale exists" }));
    assert.deepEqual(r.contradictions, []);
    assert.equal(r.verdict, "PASS");
    assert.equal(r.score, 92, "the composite scores 1, not 2, because the narrow layout clipped");
    assert.equal(r.coverage.applicable, 6, "an RTL sub-check does not remove the composite criterion");
    const sub = r.criteria_status.find((c) => c.id === "J1-6").sub_checks;
    assert.equal(sub.find((s) => s.id === "J1-6.rtl").status, "not_applicable");
    assert.equal(sub.find((s) => s.id === "J1-6.keyboard").points, 2);
  });

  it("an Arabic-supporting product that could not be tested records RTL as applicable, not assessed", () => {
    const r = scoreAudit(journey({ id: "J1-6.rtl", status: "not_assessed", points: null, reason_code: "no_test_account", reason: "the Arabic locale needs an account this run did not have" }));
    assert.deepEqual(r.contradictions, []);
    const rtl = r.criteria_status.find((c) => c.id === "J1-6").sub_checks.find((s) => s.id === "J1-6.rtl");
    assert.equal(rtl.status, "not_assessed");
    assert.equal(rtl.reason_code, "no_test_account");
  });

  it("refuses a full pass on the composite while an applicable sub-check went untested", () => {
    const input = journey({ id: "J1-6.rtl", status: "not_assessed", points: null, reason: "Arabic locale untested" });
    input.criteria.find((c) => c.id === "J1-6").points = 2;
    const r = scoreAudit(input);
    assert.match(r.contradictions.join(" "), /J1-6 cannot be a full pass while J1-6.rtl was not assessed/);
    assert.equal(r.score, null);
  });
});

describe("ACCEPTANCE 3: required criteria and ambiguous expectations", () => {
  const ux = (goal) => scoreAudit({
    expected_criteria: UX_JOURNEY, total_criteria: 6, min_coverage: "4/6", required_criteria: ["J1-3"],
    criteria: [assessed("J1-1", 2), assessed("J1-2", 2), goal, assessed("J1-4", 2), assessed("J1-5", 2), assessed("J1-6", 2)],
    findings: [],
  });

  it("a failed main path forces FAIL even when every other criterion is a pass", () => {
    const r = ux(assessed("J1-3", 0, "the Save button returns a 500 and the order is never created"));
    assert.equal(r.verdict, "FAIL");
    assert.equal(r.score, 83, "the arithmetic score is still shown, but it cannot buy a pass");
    assert.deepEqual(r.required.failed, ["J1-3"]);
  });

  it("an untested main path is insufficient coverage, which is not a failure", () => {
    const r = ux(notAssessed("J1-3", "the order could not be submitted: data changes were not allowed", "out_of_scope_data"));
    assert.equal(r.verdict, "INSUFFICIENT_COVERAGE");
    assert.equal(r.score, null);
    assert.deepEqual(r.required.not_assessed, ["J1-3"]);
    assert.deepEqual(r.required.failed, []);
    assert.match(r.reason, /not a failure, it was not tested/);
  });

  it("the main path cannot be excluded as not applicable; narrow the scope instead", () => {
    const r = ux(notApplicable("J1-3", "we only looked at the first step", "scope"));
    assert.match(r.contradictions.join(" "), /required criterion cannot be "not_applicable": J1-3/);

    // Narrowing the declared scope is the supported way: the step is the whole verdict.
    const step = scoreAudit({
      expected_criteria: ["J1-1", "J1-2"], total_criteria: 2, min_coverage: "1/2",
      criteria: [assessed("J1-1", 2), assessed("J1-2", 2)], findings: [],
    });
    assert.equal(step.verdict, "PASS");
    assert.deepEqual(step.required.ids, []);
  });

  it("a UI case with an ambiguous expectation is kept as a note, with no PASS and no FAIL", () => {
    const r = scoreAudit({
      expected_criteria: UI, total_criteria: 8, min_coverage: "5/8", required_criteria: ["UI-1"],
      criteria: [
        assessed("UI-1", 2), assessed("UI-2", 2), assessed("UI-3", 2), assessed("UI-4", 2), assessed("UI-5", 2),
        notAssessed("UI-6", "observed: a viewer sees the Delete button. No requirement states whether that is intended.", "expected_undefined"),
        notAssessed("UI-7", "no mobile device"), notAssessed("UI-8", "console not exposed"),
      ],
      findings: [],
    });
    assert.equal(r.verdict, "PASS");
    const ui6 = r.criteria_status.find((c) => c.id === "UI-6");
    assert.equal(ui6.status, "not_assessed");
    assert.equal(ui6.points, null, "no functional PASS or FAIL for an undefined expectation");
    assert.equal(ui6.reason_code, "expected_undefined");
  });
});

describe("contradictory states are refused, not repaired", () => {
  for (const [name, criterion] of [
    ["assessed without points", { id: "A", status: "assessed", points: null, evidence: "x" }],
    ["not assessed with points", { id: "A", status: "not_assessed", points: 2, reason: "x" }],
    ["not applicable with points", { id: "A", status: "not_applicable", points: 0, reason: "x", basis: "scope" }],
    ["not applicable without a basis", { id: "A", status: "not_applicable", points: null, reason: "x" }],
    ["not applicable with an invented basis", { id: "A", status: "not_applicable", points: null, reason: "x", basis: "ran_out_of_time" }],
    ["an unknown status", { id: "A", status: "skipped", points: null, reason: "x" }],
    ["an unknown reason code", { id: "A", status: "not_assessed", points: null, reason: "x", reason_code: "whatever" }],
  ]) {
    it(`rejects ${name}`, () => {
      const r = scoreAudit({ expected_criteria: ["A", "B"], total_criteria: 2, min_coverage: "1/2", criteria: [criterion, assessed("B", 2)], findings: [] });
      assert.ok(r.contradictions.length, `${name} should be a contradiction`);
      assert.equal(r.score, null);
    });
  }

  it("ACCEPTANCE 6: audit-record refuses to store a contradictory record", () => {
    const dir = tmp("engops-contradiction-");
    const bad = cli(dir, "audit-record", {
      target: "/orders", conditions: { scope: "/orders", role: "admin" },
      expected_criteria: ["UI-1"], total_criteria: 1, min_coverage: "1/1",
      criteria: [{ id: "UI-1", status: "not_applicable", points: 2, reason: "unclear", basis: "scope" }], findings: [],
    }, "--kind", "ui-test");
    assert.equal(bad.ok, false);
    assert.match(bad.contradictions.join(" "), /UI-1/);
    assert.equal(cli(dir, "audit-list", {}, "--kind", "ui-test").runs.length, 0, "nothing contradictory reaches the history");
  });
});

describe("ACCEPTANCE 6: the real commands store and read the new states", () => {
  const conditions = { scope: "/orders", environment: "testing", role: "admin", language: "en", device: "desktop" };
  const uxInput = (over = {}) => ({
    target: "orders journey", conditions, expected_criteria: UX_JOURNEY, total_criteria: 6,
    min_coverage: "4/6", required_criteria: ["J1-3"],
    criteria: [
      assessed("J1-1", 2), assessed("J1-2", 2), assessed("J1-3", 2), assessed("J1-4", 2),
      notAssessed("J1-5", "error state not safely reachable"),
      notApplicable("J1-6", "English-only product, no RTL; keyboard and narrow layout were folded into J1-4", "product_property"),
    ],
    findings: [], ...over,
  });

  it("saves the three states, counts them, and scores over the applicable ones", () => {
    const dir = tmp("engops-record-");
    const saved = cli(dir, "audit-record", uxInput(), "--kind", "ux");
    assert.equal(saved.ok, true);
    assert.equal(saved.record.verdict, "PASS");
    assert.deepEqual(
      [saved.record.coverage.expected, saved.record.coverage.assessed, saved.record.coverage.not_assessed, saved.record.coverage.not_applicable],
      [6, 4, 1, 1],
    );
    assert.equal(saved.record.coverage.rule, "4/6");
    assert.equal(saved.record.scoring_policy.policy_version, "2026.11-applicability-1");
    assert.equal(saved.record.criteria_status.find((c) => c.id === "J1-6").basis, "product_property");
  });

  it("stops comparing when the applicable criteria or the policy change", () => {
    const dir = tmp("engops-compare-");
    cli(dir, "audit-record", uxInput(), "--kind", "ux");
    const same = cli(dir, "audit-record", uxInput(), "--kind", "ux");
    assert.equal(same.comparison.score_after, 100);
    assert.match(same.comparison.fixed_note, /before calling it fixed/);

    // Now J1-6 becomes applicable again: the denominator changed, so the scores are not comparable.
    const widened = uxInput({
      criteria: [
        assessed("J1-1", 2), assessed("J1-2", 2), assessed("J1-3", 2), assessed("J1-4", 2),
        notAssessed("J1-5", "error state not safely reachable"),
        assessed("J1-6", 1, "focus order is fine; the action bar clips at 375 px"),
      ],
    });
    const changed = cli(dir, "audit-record", widened, "--kind", "ux");
    assert.equal(changed.comparison, null);
    assert.match(changed.comparison_unavailable.join(" "), /applicable criteria: different|assessed criteria: different/);
  });

  it("reads a legacy record saved without statuses and keeps comparing like for like", () => {
    const dir = tmp("engops-legacy-");
    const legacy = (points) => ({
      target: "legacy", conditions, total_criteria: 3,
      criteria: [{ id: "A", points, evidence: "observed" }, { id: "B", points: 2, evidence: "observed" }, { id: "C", points: null, evidence: "tool missing" }],
      findings: [],
    });
    const first = cli(dir, "audit-record", legacy(1), "--kind", "architecture");
    assert.equal(first.record.coverage.not_assessed, 1);
    const second = cli(dir, "audit-record", legacy(2), "--kind", "architecture");
    assert.equal(second.comparison.score_before, 75);
    assert.equal(second.comparison.score_after, 100);
  });

  it("withholds the score through the CLI when no criterion applies", () => {
    const dir = tmp("engops-na-");
    const saved = cli(dir, "audit-record", {
      target: "static marketing page", conditions, expected_criteria: ["UI-1", "UI-2"], total_criteria: 2, min_coverage: "1/2",
      criteria: [
        notApplicable("UI-1", "the declared scope is the print stylesheet only", "scope"),
        notApplicable("UI-2", "the page has no inputs", "product_property"),
      ],
      findings: [],
    }, "--kind", "ui-test");
    assert.equal(saved.record.verdict, "NOT_APPLICABLE");
    assert.equal(saved.record.score, null);
  });
});

describe("ACCEPTANCE 5: performance budgets", () => {
  const runs = (ms) => ms.map((v) => ({ action: { result_visible_ms: v }, resources: { transfer_kb: 100, repeated: [], api_calls: { count: 0 } } }));
  const budget = (max, extra = {}) => ({
    max_ms: max, unit: "ms", source: "docs/perf-budget.md §2", summary: "median",
    measure_start: "click on the status filter", measure_end: "the changed rows are visible",
    scenario: "Open status filter → changed table rows visible", ...extra,
  });

  it("a 1500 ms median exceeds a 1000 ms budget and meets a 2000 ms budget", () => {
    const over = scorePerf(runs([1400, 1500, 1600]), { budgets: { result_visible_ms: budget(1000) } });
    const under = scorePerf(runs([1400, 1500, 1600]), { budgets: { result_visible_ms: budget(2000) } });
    const criterion = (r) => r.criteria.find((c) => c.id === "result_visible_ms");
    assert.equal(criterion(over).value, 1500);
    assert.equal(criterion(over).points, 0);
    assert.equal(criterion(under).points, 2);
    assert.match(criterion(over).evidence, /budget 1000 ms \(single maximum: met or exceeded\)/);
    assert.match(criterion(over).evidence, /docs\/perf-budget\.md/);
  });

  it("an intermediate score needs a declared needs-improvement range", () => {
    assert.equal(pointsAgainstBudget(1500, { max_ms: 1000, needs_improvement_max_ms: null }), 0);
    assert.equal(pointsAgainstBudget(1500, { max_ms: 1000, needs_improvement_max_ms: 2000 }), 1);
    assert.equal(pointsAgainstBudget(2500, { max_ms: 1000, needs_improvement_max_ms: 2000 }), 0);
  });

  it("no budget produces a measured baseline outside the score, not a verdict", () => {
    const r = scorePerf(runs([1400, 1500, 1600]));
    const c = r.criteria.find((c) => c.id === "result_visible_ms");
    assert.equal(c.points, null);
    assert.equal(c.status, "measured_no_budget");
    assert.equal(c.value, 1500);
    assert.equal(c.samples, 3);
    assert.deepEqual(r.baselines.map((b) => b.id), ["result_visible_ms"]);
    assert.equal(r.scored_criteria.includes("result_visible_ms"), false);
  });

  it("a budget with no measurement is recorded as owed", () => {
    const r = scorePerf([{ resources: { transfer_kb: 100, repeated: [], api_calls: { count: 0 } } }], { budgets: { spa_navigation_ms: budget(800) } });
    const c = r.criteria.find((c) => c.id === "spa_navigation_ms");
    assert.equal(c.status, "required_not_measured");
    assert.equal(c.points, null);
    assert.deepEqual(r.owed_measurements.map((o) => o.id), ["spa_navigation_ms"]);
  });

  it("changing the budget stops the score comparison", () => {
    const dir = tmp("engops-budget-");
    const conditions = { target: "/orders", scenario: "filter", device: "desktop", viewport: "1365x768", network: "unthrottled", throttling: "none", build: "production", environment: "testing", cache: "warm", role: "admin" };
    const record = (max) => cli(dir, "audit-record", {
      target: "/orders", conditions, median: { result_visible_ms: 1500 },
      budgets: { result_visible_ms: { max_ms: max, source: "docs/perf-budget.md" } },
      expected_criteria: ["result_visible_ms"], total_criteria: 1, min_coverage: "1/1",
      criteria: [assessed("result_visible_ms", max >= 2000 ? 2 : 0, `median 1500 ms vs budget ${max} ms`)], findings: [],
    }, "--kind", "performance");
    record(1000);
    const relaxed = record(2000);
    assert.equal(relaxed.comparison, null);
    assert.match(relaxed.comparison_unavailable.join(" "), /budgets/);
  });

  it("the legacy action_ms input still works and is marked as a legacy default", () => {
    const r = scorePerf(runs([100]), { action_ms: 300 });
    const c = r.criteria.find((c) => c.id === "action_ms");
    assert.equal(c.points, 2);
    assert.equal(c.budget.kind, "legacy_default");
    assert.match(c.budget.source, /not an approved scenario budget/);
  });

  it("successful browser runs never produce a field Core Web Vitals pass", () => {
    const fast = [{ web_vitals: { lcp_ms: 900, inp_ms: 40, cls: 0.01 }, resources: { transfer_kb: 50, repeated: [], api_calls: { count: 0 } } }];
    const r = scorePerf(fast);
    assert.equal(r.lab_core_web_vitals.all_good, true);
    assert.equal(r.core_web_vitals_pass, null);
    assert.equal(r.core_web_vitals_field.assessed, false);
    assert.match(r.core_web_vitals_field.reason, /lab data/);
  });

  it("a field assessment uses p75 and needs all three metrics", () => {
    const partial = assessFieldCoreWebVitals({ source: "CrUX", device_class: "phone", metrics: { lcp_ms: { p75: 2100 }, cls: { p75: 0.05 } } });
    assert.equal(partial.assessed, false);
    assert.deepEqual(partial.missing, ["inp_ms"]);

    const full = scorePerf([{ web_vitals: { lcp_ms: 5000, inp_ms: 900, cls: 0.4 } }], {
      field: { source: "CrUX", device_class: "phone", metrics: { lcp_ms: { p75: 2100 }, inp_ms: { p75: 150 }, cls: { p75: 0.05 } } },
    });
    assert.equal(full.core_web_vitals_field.percentile, 75);
    assert.equal(full.core_web_vitals_pass, true, "the field verdict is independent of the slow lab runs");
    assert.equal(full.lab_core_web_vitals.all_good, false);

    const failing = assessFieldCoreWebVitals({ metrics: { lcp_ms: { p75: 2100 }, inp_ms: { p75: 150 }, cls: { p75: 0.4 } } });
    assert.equal(failing.pass, false, "one metric over target fails the whole assessment");
  });
});

describe("scoring basis comparison", () => {
  it("names every reason two runs are not comparable", () => {
    const run = (over = {}) => ({
      scoring_policy: { policy_version: "2026.11-applicability-1", min_coverage: "4/6", required_criteria: ["J1-3"] },
      coverage: { applicable_ids: ["J1-1", "J1-2", "J1-3"], assessed_ids: ["J1-1", "J1-2"] },
      ...over,
    });
    assert.equal(compareScoringBasis(run(), run()).comparable, true);
    assert.match(compareScoringBasis(run(), run({ scoring_policy: { policy_version: "x", min_coverage: "4/6", required_criteria: ["J1-3"] } })).reasons.join(" "), /policy_version/);
    assert.match(compareScoringBasis(run(), run({ scoring_policy: { policy_version: "2026.11-applicability-1", min_coverage: "0.67", required_criteria: ["J1-3"] } })).reasons.join(" "), /min_coverage/);
    assert.match(compareScoringBasis(run(), run({ coverage: { applicable_ids: ["J1-1"], assessed_ids: ["J1-1", "J1-2"] } })).reasons.join(" "), /applicable criteria/);
    assert.match(compareScoringBasis(run(), run({ coverage: { applicable_ids: ["J1-1", "J1-2", "J1-3"], assessed_ids: ["J1-1"] } })).reasons.join(" "), /assessed criteria/);
  });
});
