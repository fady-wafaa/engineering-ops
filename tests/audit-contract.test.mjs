import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { compareAuditConditions, scoreAudit } from "../scripts/lib/audit.mjs";

const criterion = (id, points, evidence = "observed") => ({ id, points, evidence });
const state = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "state.mjs");
describe("strict audit evidence contract", () => {
  it("scores one evidenced result per expected criterion", () => {
    const result = scoreAudit({ expected_criteria: ["A", "B"], criteria: [criterion("A", 2), criterion("B", 1)] });
    assert.equal(result.score, 75);
    assert.equal(result.coverage.tested, 2);
    assert.deepEqual(result.validation_errors, []);
  });
  it("withholds scores for duplicate, missing, unexpected or unevidenced criteria", () => {
    for (const criteria of [
      [criterion("A", 2), criterion("A", 2)],
      [criterion("A", 2)],
      [criterion("A", 2), criterion("C", 2)],
      [criterion("A", 2, ""), criterion("B", 2)],
    ]) {
      const result = scoreAudit({ expected_criteria: ["A", "B"], criteria });
      assert.equal(result.score, null);
      assert.ok(result.validation_errors.length);
    }
  });
  it("requires a reason when a criterion was not measured", () => {
    const result = scoreAudit({ expected_criteria: ["A", "B"], criteria: [criterion("A", 2), criterion("B", null, "browser unavailable")] });
    assert.equal(result.coverage.tested, 1);
    assert.equal(result.validation_errors.length, 0);
  });
  it("compares only matching stated conditions", () => {
    const a = { scope: "/tasks", role: "admin", device: "desktop" };
    assert.equal(compareAuditConditions(a, { ...a }).comparable, true);
    assert.equal(compareAuditConditions(a, { ...a, role: "viewer" }).comparable, false);
    assert.equal(compareAuditConditions(null, a).comparable, false);
  });
  it("audit-record CLI suppresses cross-role comparisons", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-context-"));
    const record = (role) => {
      const file = path.join(dir, `${role}.json`);
      fs.writeFileSync(file, JSON.stringify({ target: "/tasks", conditions: { scope: "/tasks", role }, expected_criteria: ["UI-1"], criteria: [criterion("UI-1", 2)], findings: [], total_criteria: 1 }));
      return JSON.parse(spawnSync(process.execPath, [state, "audit-record", "--kind", "ui-test", "--json-file", file], { encoding: "utf8", env: { ...process.env, ENGOPS_STATE_DIR: dir } }).stdout);
    };
    assert.equal(record("admin").record.score, 100);
    const changed = record("viewer");
    assert.equal(changed.comparison, null);
    assert.match(changed.comparison_unavailable.join(" "), /role/);
  });
});
