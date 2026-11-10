import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AGENT_DEFAULTS, recommendAgentModel } from "../scripts/lib/agent-model.mjs";

describe("all-agent model preflight", () => {
  it("returns a reviewed recommendation for every registered agent", () => {
    for (const agent of Object.keys(AGENT_DEFAULTS)) {
      const result = recommendAgentModel({ agent, scope_items: 2 });
      assert.equal(result.agent, agent);
      assert.ok(result.reasons.length);
      assert.ok(["haiku", "sonnet"].includes(result.selected_model));
    }
  });
  it("proposes a cheap model for simple browser work and raises a complex gate", () => {
    assert.equal(recommendAgentModel({ agent: "browser-qa", scope_items: 1 }).recommended_model, "haiku");
    assert.equal(recommendAgentModel({ agent: "quality-gate", scope_items: 12, cross_layer: true }).recommended_model, "sonnet");
  });
  it("proposes premium before execution and keeps the non-premium fallback", () => {
    const input = { agent: "architecture-auditor", scope_items: 25, cross_layer: true, ambiguity: "high" };
    const proposed = recommendAgentModel(input);
    assert.equal(proposed.recommended_model, "opus");
    assert.equal(proposed.selected_model, "sonnet");
    assert.equal(proposed.approval_required, true);
    assert.equal(recommendAgentModel({ ...input, premium_approved: true }).selected_model, "opus");
  });
  it("rejects unknown agents", () => assert.throws(() => recommendAgentModel({ agent: "unknown" }), /Unknown agent/));
  it("agent-model CLI returns the proposed change before execution", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-model-"));
    const file = path.join(dir, "input.json");
    fs.writeFileSync(file, JSON.stringify({ agent: "browser-qa", scope_items: 1 }));
    const state = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "state.mjs");
    const result = JSON.parse(spawnSync(process.execPath, [state, "agent-model", "--json-file", file], { encoding: "utf8", env: { ...process.env, ENGOPS_STATE_DIR: dir } }).stdout);
    assert.equal(result.selected_model, "haiku");
    assert.match(result.proposal, /sonnet → haiku/);
  });
});
