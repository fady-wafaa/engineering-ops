import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scorePerf } from "../scripts/lib/perf.mjs";
import { comparePerformance, parsePerfReport } from "../scripts/lib/perf-reports.mjs";

const conditions = { target: "SuiteFleet/tasks", scenario: "Open status filter → new table rows visible", device: "desktop", viewport: "1365x768", network: "unthrottled", throttling: "none", build: "test-build", environment: "testing", cache: "warm", role: "tester" };
const run = (ms) => ({ action: { result_visible_ms: ms }, web_vitals: { inp_ms: null, observed_slowest_interaction_ms: 48 }, resources: { transfer_kb: 100, repeated: [], api_calls: { count: 1, slowest_ms: 140 } } });
const state = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "state.mjs");
const cli = (dir, command, data, ...options) => {
  const file = path.join(dir, `${command}-${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  const result = spawnSync(process.execPath, [state, command, ...options, "--json-file", file], { encoding: "utf8", env: { ...process.env, ENGOPS_STATE_DIR: dir } });
  return JSON.parse(result.stdout);
};

describe("SuiteFleet table filter acceptance", () => {
  it("reports visible rows, evidence, and a same-condition delta", () => {
    const before = scorePerf([run(310), run(320), run(330)]);
    const after = scorePerf([run(160), run(170), run(180)]);
    assert.equal(before.median.result_visible_ms, 320);
    assert.equal(after.criteria.find((c) => c.id === "result_visible_ms").samples, 3);
    assert.equal(after.criteria.find((c) => c.id === "inp_ms").points, null);
    assert.equal(comparePerformance({ conditions, median: before.median }, { conditions, median: after.median }).metrics.result_visible_ms.delta, -150);
  });
  it("refuses a delta when cache, device, or scenario differs or is missing", () => {
    const before = { conditions, median: { result_visible_ms: 320 } };
    assert.equal(comparePerformance(before, { conditions: { ...conditions, cache: "cold" }, median: { result_visible_ms: 170 } }).comparable, false);
    assert.equal(comparePerformance(before, { conditions: {}, median: { result_visible_ms: 170 } }).comparable, false);
  });
  it("CLI records comparable performance runs only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-acceptance-"));
    const input = (ms, c) => ({ target: conditions.target, conditions: c, median: { result_visible_ms: ms }, criteria: [{ id: "result_visible_ms", points: 2 }], findings: [], total_criteria: 1 });
    cli(dir, "audit-record", input(320, conditions), "--kind", "performance");
    const changed = cli(dir, "audit-record", input(170, { ...conditions, device: "mobile" }), "--kind", "performance");
    assert.equal(changed.comparison, null);
    assert.match(changed.comparison_unavailable.join(" "), /device/);
    const same = cli(dir, "audit-record", input(170, conditions), "--kind", "performance");
    assert.equal(same.comparison, null, "latest run has incompatible conditions");
  });
});

describe("imported performance reports", () => {
  it("distinguishes CrUX page and origin field data", () => {
    const metrics = { largest_contentful_paint: { percentiles: { p75: 2100 } } };
    assert.equal(parsePerfReport("crux", { record: { key: { url: "https://example.test/page" }, metrics } }).scope, "page");
    assert.equal(parsePerfReport("crux", { record: { key: { origin: "https://example.test" }, metrics } }).scope, "origin");
  });
  it("calculates server percentiles and errors, keeping trace evidence", () => {
    const report = parsePerfReport("server", { requests: [
      { route: "/api/tasks", duration_ms: 100, status: 200 },
      { route: "/api/tasks", duration_ms: 200, status: 200, trace_id: "t2", db_ms: 140 },
      { route: "/api/tasks", duration_ms: 900, status: 500, trace_id: "t3" },
    ] });
    assert.deepEqual([report.routes[0].p50_ms, report.routes[0].p95_ms, report.routes[0].p99_ms, report.routes[0].samples], [200, 900, 900, 3]);
    assert.equal(report.routes[0].error_rate, 1 / 3);
    assert.equal(report.routes[0].traces[0].trace_id, "t2");
  });
  it("imports a k6 summary without generating load", () => {
    const report = parsePerfReport("k6", { metrics: { http_req_duration: { values: { "p(50)": 120, "p(95)": 410, "p(99)": 850 } }, http_reqs: { values: { count: 1200 } }, http_req_failed: { values: { rate: .02 } } } });
    assert.deepEqual(report.http_req_duration, { p50_ms: 120, p95_ms: 410, p99_ms: 850, samples: 1200 });
    assert.equal(report.error_rate, .02);
  });
  it("perf-report CLI reads an existing k6 JSON summary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perf-report-"));
    const result = cli(dir, "perf-report", { metrics: { http_req_duration: { values: { "p(95)": 400 } }, http_reqs: { values: { count: 10 } } } }, "--type", "k6");
    assert.equal(result.report.http_req_duration.p95_ms, 400);
    assert.equal(result.report.http_req_duration.samples, 10);
  });
  it("leaves unavailable RUM metrics unmeasured", () => {
    const report = parsePerfReport("rum", { scope: "page", url: "https://example.test/page", metrics: { inp_ms: [] } });
    assert.deepEqual(report.metrics.inp_ms, { samples: 0, p50_ms: null, p95_ms: null, p99_ms: null });
  });
});
