// Original SuiteFleet synthetic tests (watcher-state.mjs), ported to scripts/state.mjs. They use a throwaway state directory and
// mock card data only: no Trello calls, no messages, no real card changes.
// Run: npm test  (the only change: the generic script has no Cairo defaults,
// so the two window tests below pass --tz/--start/--end explicitly).

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, it, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "state.mjs");
let stateDir;

function run(...args) {
  const out = execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, AI_WORKFLOW_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function runAsync(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, AI_WORKFLOW_STATE_DIR: stateDir },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", () => resolve(JSON.parse(out)));
  });
}

// Mock Trello cards (shape of the fields the watcher reads from the connector).
const cardV1 = {
  id: "card-123",
  name: "Fix vehicle list date column",
  desc: "Date column shows UTC instead of tenant timezone.",
  labels: [{ name: "Bug" }],
  due: null,
  checklists: [],
};

function fp(card, extra = []) {
  return run("fingerprint", "--json", JSON.stringify(card), ...extra).fingerprint;
}

// Same mock poll the watcher performs: classify each eligible card against the ledger,
// then record what it saw.
function mockPoll(cards) {
  const result = { new_cards: [], changed_cards: [], unchanged: [] };
  for (const card of cards) {
    const f = fp(card);
    const check = run("card-check", "--id", card.id, "--fingerprint", f);
    const item = { name: card.name, list: "Backlog", url: `https://trello.example/c/${card.id}` };
    if (check.status === "new") result.new_cards.push(item);
    else if (check.status === "changed") result.changed_cards.push(item);
    else result.unchanged.push(item);
    run(
      "card-upsert",
      "--id",
      card.id,
      "--json",
      JSON.stringify({
        last_seen_fingerprint: f,
        last_seen_at: new Date().toISOString(),
        ...(check.status === "changed"
          ? { needs_reassessment: true, previous_fingerprint: check.previous_fingerprint }
          : {}),
      }),
    );
  }
  return result;
}

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-wf-test-"));
});

describe("scenario 1: same unchanged card in two polls", () => {
  it("reports it once, then stays quiet", () => {
    const first = mockPoll([cardV1]);
    assert.equal(first.new_cards.length, 1);
    const line1 = run("report-line", "--json", JSON.stringify({ status: "ok", ...first }));
    assert.match(line1.line, /^NEW: Fix vehicle list date column/);

    const second = mockPoll([cardV1]);
    assert.equal(second.new_cards.length, 0);
    assert.equal(second.changed_cards.length, 0);
    assert.equal(second.unchanged.length, 1);
    const line2 = run("report-line", "--json", JSON.stringify({ status: "ok", ...second }));
    assert.equal(line2.quiet, true);
    assert.equal(line2.line, "");
  });
});

describe("scenario 2: two polls overlap", () => {
  it("second poll cannot take a fresh lock and cannot release it", () => {
    const a = run("lock-acquire", "--name", "trello-watcher", "--run-id", "poll-A");
    assert.equal(a.acquired, true);
    const b = run("lock-acquire", "--name", "trello-watcher", "--run-id", "poll-B");
    assert.equal(b.acquired, false);
    assert.equal(b.reason, "active_lock_held");
    assert.equal(b.holder_run_id, "poll-A");

    const badRelease = run("lock-release", "--name", "trello-watcher", "--run-id", "poll-B");
    assert.equal(badRelease.released, false);
    assert.equal(badRelease.reason, "not_owner");
    assert.equal(run("lock-status", "--name", "trello-watcher").lock.run_id, "poll-A");

    assert.equal(
      run("lock-release", "--name", "trello-watcher", "--run-id", "poll-A").released,
      true,
    );
    assert.equal(
      run("lock-acquire", "--name", "trello-watcher", "--run-id", "poll-C").acquired,
      true,
    );
  });

  it("truly concurrent acquires: exactly one wins", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runAsync("lock-acquire", "--name", "race", "--run-id", `r${i}`),
      ),
    );
    assert.equal(results.filter((r) => r.acquired).length, 1);
  });

  it("concurrent ledger writes do not lose updates", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runAsync("card-upsert", "--id", `c${i}`, "--json", JSON.stringify({ n: i })),
      ),
    );
    const ledger = JSON.parse(fs.readFileSync(path.join(stateDir, "ledger.json"), "utf8"));
    assert.equal(Object.keys(ledger.tasks).length, 8);
  });
});

describe("scenario 3: an existing card's requirements change", () => {
  it("is reported as CHANGED and invalidates stages from the first affected one", () => {
    mockPoll([cardV1]);
    const f1 = fp(cardV1);
    for (const stage of ["1_intake", "2_baseline", "3_analysis"]) {
      run("stage-done", "--id", cardV1.id, "--stage", stage, "--fingerprint", f1);
    }

    const cardV2 = { ...cardV1, desc: cardV1.desc + " Also the time column." };
    const poll = mockPoll([cardV2]);
    assert.equal(poll.changed_cards.length, 1);
    assert.equal(run("task-get", "--id", cardV1.id).entry.needs_reassessment, true);

    const resume = run("task-resume", "--id", cardV1.id, "--fingerprint", fp(cardV2));
    assert.equal(resume.resume_at, "1_intake");
    assert.equal(resume.reason, "task_changed_since_stage");
    assert.deepEqual(resume.invalidated, ["1_intake", "2_baseline", "3_analysis"]);
  });

  it("a card move or the workflow's own branch suffix is not a requirements change", () => {
    const base = fp(cardV1);
    const renamed = { ...cardV1, name: `${cardV1.name} hotfix/vehicle-list-date-column` };
    assert.equal(fp(renamed, ["--strip-suffix", "hotfix/vehicle-list-date-column"]), base);
    assert.equal(fp({ ...cardV1, idList: "other-list", idMembers: ["x"] }), base);
  });
});

describe("scenario 4: a run is interrupted and restarted", () => {
  it("stale lock is recovered and work resumes at the first incomplete valid stage", () => {
    const f = fp(cardV1);
    run("lock-acquire", "--name", `task-${cardV1.id}`, "--run-id", "run-1");
    run(
      "stage-done",
      "--id",
      cardV1.id,
      "--stage",
      "1_intake",
      "--fingerprint",
      f,
      "--run-id",
      "run-1",
    );
    run(
      "stage-done",
      "--id",
      cardV1.id,
      "--stage",
      "2_baseline",
      "--fingerprint",
      f,
      "--run-id",
      "run-1",
    );
    // Simulated crash: run-1 never releases its lock. Age the lock past the threshold.
    const lockFile = path.join(stateDir, `task-${cardV1.id}.lock.json`);
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    lock.acquired_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(lockFile, JSON.stringify(lock));

    const fresh = run(
      "lock-acquire",
      "--name",
      `task-${cardV1.id}`,
      "--run-id",
      "run-2",
      "--stale-minutes",
      "240",
    );
    assert.equal(fresh.acquired, false, "3h-old lock is NOT stale under a 4h threshold");

    const recovered = run(
      "lock-acquire",
      "--name",
      `task-${cardV1.id}`,
      "--run-id",
      "run-2",
      "--stale-minutes",
      "90",
    );
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.recovered_stale, true);
    assert.equal(recovered.previous_run_id, "run-1");

    const resume = run("task-resume", "--id", cardV1.id, "--fingerprint", f);
    assert.equal(resume.resume_at, "3_analysis");
    assert.equal(resume.reason, "first_incomplete_stage");
  });

  it("after a repair, checks and review for the old diff are not reused", () => {
    const f = fp(cardV1);
    for (const s of ["1_intake", "2_baseline", "3_analysis", "4_questions", "5_mode_branch_gate"]) {
      run("stage-done", "--id", cardV1.id, "--stage", s, "--fingerprint", f);
    }
    run(
      "stage-done",
      "--id",
      cardV1.id,
      "--stage",
      "6_implementation",
      "--fingerprint",
      f,
      "--change-identity",
      "sha-old",
    );
    run(
      "stage-done",
      "--id",
      cardV1.id,
      "--stage",
      "7_checks_postcheck",
      "--fingerprint",
      f,
      "--change-identity",
      "sha-old",
    );
    run(
      "stage-done",
      "--id",
      cardV1.id,
      "--stage",
      "8_final_review",
      "--fingerprint",
      f,
      "--change-identity",
      "sha-old",
    );

    // Repair produced a new diff.
    run(
      "stage-done",
      "--id",
      cardV1.id,
      "--stage",
      "6_implementation",
      "--fingerprint",
      f,
      "--change-identity",
      "sha-new",
    );
    const resume = run("task-resume", "--id", cardV1.id, "--fingerprint", f);
    assert.equal(resume.resume_at, "7_checks_postcheck");
    assert.equal(resume.reason, "change_identity_differs_from_checked_version");
    assert.deepEqual(resume.invalidated, ["7_checks_postcheck", "8_final_review"]);
  });

  it("an owner that refreshes after each stage is never treated as stale", () => {
    run("lock-acquire", "--name", "task-x", "--run-id", "owner");
    const lockFile = path.join(stateDir, "task-x.lock.json");
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    lock.acquired_at = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(lockFile, JSON.stringify(lock));
    assert.equal(run("lock-refresh", "--name", "task-x", "--run-id", "intruder").refreshed, false);
    assert.equal(run("lock-refresh", "--name", "task-x", "--run-id", "owner").refreshed, true);
    assert.equal(
      run("lock-acquire", "--name", "task-x", "--run-id", "other", "--stale-minutes", "240")
        .acquired,
      false,
    );
  });

  it("two runs that both find the same stale lock: exactly one takes it over", async () => {
    fs.mkdirSync(stateDir, { recursive: true });
    const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(stateDir, "trello-watcher.lock.json"),
      JSON.stringify({ run_id: "dead", acquired_at: old }),
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        runAsync(
          "lock-acquire",
          "--name",
          "trello-watcher",
          "--run-id",
          `r${i}`,
          "--stale-minutes",
          "90",
        ),
      ),
    );
    assert.equal(results.filter((r) => r.acquired).length, 1);
    const holder = results.find((r) => r.acquired).lock.run_id;
    assert.equal(run("lock-status", "--name", "trello-watcher").lock.run_id, holder);
  });

  it("corrupt lock file self-heals instead of blocking forever", () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "trello-watcher.lock.json"), "{not json");
    const r = run("lock-acquire", "--name", "trello-watcher", "--run-id", "x");
    assert.equal(r.acquired, true);
    assert.equal(r.recovered_stale, true);
  });
});

describe("scenario 5: external action succeeds before its completion is saved", () => {
  // Mock Trello card: the action appends the branch name to the title.
  const mockCard = { name: "Fix vehicle list date column", list: "Dev. In progress" };
  const branch = "hotfix/vehicle-list-date-column";

  it("uncertain outcome is reconciled against the real card, not repeated", () => {
    const begin = run("action-begin", "--id", cardV1.id, "--action", "append_branch_to_title");
    assert.equal(begin.proceed, true);
    mockCard.name = `${mockCard.name} ${branch}`; // the action succeeded...
    // ...then the run crashed before action-resolve. A restart asks again:
    const retry = run("action-begin", "--id", cardV1.id, "--action", "append_branch_to_title");
    assert.equal(retry.proceed, false);
    assert.equal(retry.reason, "outcome_uncertain_reconcile_first");

    // Reconcile: read the (mock) card. Suffix is already present -> mark done.
    assert.ok(mockCard.name.endsWith(branch));
    run(
      "action-resolve",
      "--id",
      cardV1.id,
      "--action",
      "append_branch_to_title",
      "--result",
      "done",
      "--evidence",
      "title already ends with branch",
    );
    const again = run("action-begin", "--id", cardV1.id, "--action", "append_branch_to_title");
    assert.equal(again.proceed, false);
    assert.equal(again.reason, "already_done");
    assert.equal(mockCard.name.split(branch).length - 1, 1, "suffix appended exactly once");
  });

  it("if reconciliation shows the action did not happen, it may run once more", () => {
    run("action-begin", "--id", cardV1.id, "--action", "move_to_review_list");
    // Crash. Reconcile: mock card is still in the source list -> not done.
    assert.equal(mockCard.list, "Dev. In progress");
    run(
      "action-resolve",
      "--id",
      cardV1.id,
      "--action",
      "move_to_review_list",
      "--result",
      "not_done",
    );
    assert.equal(
      run("action-begin", "--id", cardV1.id, "--action", "move_to_review_list").proceed,
      true,
    );
  });
});

describe("scenario 6: Trello access fails during a check", () => {
  it("is reported as incomplete/blocked, never as 'no new cards'", () => {
    const incomplete = run(
      "report-line",
      "--json",
      JSON.stringify({ status: "incomplete", reason: "Backlog list read failed (401)" }),
    );
    assert.equal(incomplete.quiet, false);
    assert.match(incomplete.line, /^Check incomplete: Backlog list read failed/);
    assert.doesNotMatch(incomplete.line, /no new cards/i);

    const blocked = run(
      "report-line",
      "--json",
      JSON.stringify({ status: "blocked", reason: "Trello connector not available" }),
    );
    assert.match(blocked.line, /^BLOCKED: Trello connector not available/);

    // A partial poll must not mark the unread list's cards as seen: nothing was upserted.
    run(
      "poll-record",
      "--json",
      JSON.stringify({ status: "incomplete", reason: "Backlog list read failed (401)" }),
    );
    assert.equal(run("card-check", "--id", cardV1.id, "--fingerprint", fp(cardV1)).status, "new");
    assert.equal(run("poll-last", "--limit", "1").polls[0].status, "incomplete");
  });

  it("--json-file works (PowerShell-safe input)", () => {
    const f = path.join(stateDir, "poll.json");
    fs.writeFileSync(f, JSON.stringify({ status: "ok", new_cards: [], changed_cards: [] }));
    assert.equal(run("report-line", "--json-file", f).quiet, true);
  });
});

describe("scenario 7: polling time window (Africa/Cairo, 10:00-19:00)", () => {
  // 2026-10-28 is summer time in Cairo (UTC+3); 2026-12-02 is winter time (UTC+2).
  const cases = [
    ["before 10:00 (09:59, summer)", "2026-10-28T06:59:00Z", false, "09:59"],
    ["exactly 10:00 (summer)", "2026-10-28T07:00:00Z", true, "10:00"],
    ["mid-window 14:30", "2026-10-28T11:30:00Z", true, "14:30"],
    ["exactly 19:00", "2026-10-28T16:00:00Z", true, "19:00"],
    ["19:00 slot dispatched 12 min late (scheduler jitter)", "2026-10-28T16:12:00Z", true, "19:12"],
    ["19:30 slot (after 7 PM)", "2026-10-28T16:30:00Z", false, "19:30"],
    ["late evening 23:00", "2026-10-28T20:00:00Z", false, "23:00"],
    ["exactly 10:00 in winter time (UTC+2)", "2026-12-02T08:00:00Z", true, "10:00"],
    [
      "09:00 in winter time — same UTC hour as 10:00 summer",
      "2026-12-02T07:00:00Z",
      false,
      "09:00",
    ],
  ];
  for (const [label, at, expected, local] of cases) {
    it(label, () => {
      const w = run(
        "window",
        "--at",
        at,
        "--tz",
        "Africa/Cairo",
        "--start",
        "10:00",
        "--end",
        "19:00",
      );
      assert.equal(w.nowLocal, local);
      assert.equal(w.inWindow, expected);
    });
  }

  it("with --grace-minutes 0, anything after 19:00 is outside", () => {
    const w = run("window", "--at", "2026-10-28T16:01:00Z", "--tz", "Africa/Cairo", "--start", "10:00", "--end", "19:00", "--grace-minutes", "0");
    assert.equal(w.inWindow, false);
  });

  it("configured working days are respected", () => {
    const w = run("window", "--at", "2026-10-30T09:00:00Z", "--tz", "Africa/Cairo", "--start", "10:00", "--end", "19:00", "--days", "Sun,Mon,Tue,Wed,Thu"); // Friday 12:00
    assert.equal(w.weekday, "Fri");
    assert.equal(w.inWindow, false);
  });
});
