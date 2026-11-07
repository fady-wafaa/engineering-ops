// Engineering Ops v0.1 tests: watcher ingest, Card Check, notifications, Trello REST
// (mocked fetch), worklog, GitHub comments, alerts, config safety. No network calls,
// no real Trello cards, throwaway state directories only.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { assessCard } from "../scripts/lib/assess.mjs";
import { projectSlugFor } from "../scripts/lib/common.mjs";
import { TrelloError, createTrelloClient, fetchAssignedCards } from "../scripts/lib/trello.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, "scripts", "state.mjs");
const ME = "member-me";
let stateDir;

function run(...args) {
  try {
    const out = execFileSync(process.execPath, [STATE, ...args], {
      env: { ...process.env, ENGOPS_STATE_DIR: stateDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

function writeJson(name, obj) {
  const f = path.join(stateDir, `_in-${name}.json`);
  fs.writeFileSync(f, JSON.stringify(obj));
  return f;
}

function ingest(cards, extra = {}) {
  const f = writeJson("ingest", { status: "ok", member_id: ME, cards, ...extra });
  return run("watch-ingest", "--json-file", f, "--run-id", `poll-${Math.random().toString(36).slice(2, 8)}`);
}

const card = (over = {}) => ({
  id: "c-bug",
  name: "Fix Open filter on the tasks page",
  desc: "Steps to reproduce:\n1. Open the tasks page\n2. Choose Open\nExpected: only open tasks show.\nActual: closed tasks also show.",
  labels: [{ name: "Bug" }],
  due: null,
  checklists: [],
  members: [ME],
  url: "https://trello.example/c/bug",
  list: "Backlog",
  board: "Product",
  ...over,
});

const feature = (over = {}) => ({
  id: "c-feat",
  name: "Add CSV export to the orders report",
  desc: "As an admin I want to export orders so that I can share them.\nAcceptance criteria: a CSV with all visible columns downloads.",
  labels: [{ name: "Feature" }],
  checklists: [],
  members: [ME],
  url: "https://trello.example/c/feat",
  list: "In progress",
  board: "Product",
  ...over,
});

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "engops-test-"));
});

// ---------------------------------------------------------------- GPT scenarios 1-16

describe("watcher ingest (scenarios 1-6)", () => {
  it("1. no assigned cards: quiet, no notification, poll recorded", () => {
    const r = ingest([card({ members: ["someone-else"] }), card({ id: "x2", closed: true })]);
    assert.equal(r.quiet, true);
    assert.equal(r.line, "");
    assert.equal(r.notification.send, false);
    assert.equal(run("poll-last", "--limit", "1").polls[0].status, "ok");
  });

  it("2. one new assigned card: reported with Card Check and one notification", () => {
    const r = ingest([card()]);
    assert.equal(r.cards.length, 1);
    assert.equal(r.cards[0].state, "new");
    assert.equal(r.cards[0].readiness, "READY");
    assert.match(r.line, /^NEW: Fix Open filter on the tasks page \| Product \/ Backlog \| .* \| Card check: READY$/);
    assert.equal(r.notification.send, true);
    assert.match(r.notification.message, /^New card for you: Fix Open filter/);
    assert.ok(r.notification.message.length < 200);
  });

  it("3. multiple new cards: one organized list and ONE aggregated notification", () => {
    const r = ingest([card(), feature(), card({ id: "c-empty", name: "Export", desc: "", labels: [] })]);
    assert.equal(r.cards.length, 3);
    assert.equal(r.line.split("\n").length, 3);
    assert.equal(r.notification.send, true);
    assert.match(r.notification.message, /^3 new cards for you\. 2 READY, 1 MISSING_INFO/);
    assert.equal(run("notify-history").history.length, 1);
  });

  it("4. an existing unchanged card is not reported again", () => {
    ingest([card()]);
    const r = ingest([card()]);
    assert.equal(r.quiet, true);
    assert.equal(r.unchanged_count, 1);
    assert.equal(r.notification.send, false);
  });

  it("5. description change: CHANGED, re-checked, needs reassessment", () => {
    ingest([card()]);
    const r = ingest([card({ desc: "Expected: x. Actual: y." })]);
    assert.equal(r.cards[0].state, "changed");
    assert.match(r.line, /^CHANGED: /);
    assert.deepEqual(r.cards[0].missing, ["Steps to reproduce"]);
    const entry = run("task-get", "--id", "c-bug").entry;
    assert.equal(entry.needs_reassessment, true);
    assert.equal(entry.readiness, "MISSING_INFO");
    assert.ok(entry.previous_fingerprint);
  });

  it("6. checklist change: CHANGED", () => {
    ingest([feature()]);
    const r = ingest([feature({ checklists: [{ name: "AC", items: [{ name: "CSV downloads", state: "incomplete" }] }] })]);
    assert.equal(r.cards[0].state, "changed");
    const r2 = ingest([feature({ checklists: [{ name: "AC", items: [{ name: "CSV downloads", state: "complete" }] }] })]);
    assert.equal(r2.cards[0].state, "changed", "ticking a checklist item is a new task version");
  });

  it("accepts the Trello MCP connector's native shape (cards.nodes, object list/board/members)", () => {
    const meAri = "ari:cloud:trello::user/me";
    const native = {
      status: "ok",
      member_id: meAri,
      cards: {
        nodes: [
          {
            id: "ari:cloud:trello::card/workspace/w/c1",
            name: "Fix Open filter on the tasks page",
            desc: card().desc,
            webUrl: "https://trello.com/c/AbC/1",
            url: "https://trello.com/c/AbC/1",
            list: { id: "ari:cloud:trello::list/workspace/w/l1", name: "Dev. In progress" },
            board: { id: "ari:cloud:trello::board/workspace/w/b1", name: "Product" },
            labels: [{ name: "Bug" }],
            due: null,
            lastActivityAt: "2026-10-13T08:26:36.438Z",
            closed: false,
            members: [{ id: meAri, fullName: "Me" }],
            checklists: [],
          },
          { id: "other", name: "Not mine", desc: "", list: { name: "Backlog" }, members: [{ id: "ari:cloud:trello::user/x" }], closed: false },
        ],
      },
    };
    const r = run("watch-ingest", "--json-file", writeJson("native", native));
    assert.equal(r.cards.length, 1);
    assert.match(r.line, /^NEW: Fix Open filter on the tasks page \| Product \/ Dev\. In progress \| https:\/\/trello\.com\/c\/AbC\/1 \| Card check: READY$/);
    const entry = run("task-get", "--id", "ari:cloud:trello::card/workspace/w/c1").entry;
    assert.equal(entry.list_name, "Dev. In progress");
    assert.equal(entry.last_activity, "2026-10-13T08:26:36.438Z");
  });

  it("a card move or member change is NOT a change", () => {
    ingest([card()]);
    const r = ingest([card({ list: "Doing", members: [ME, "other"] })]);
    assert.equal(r.quiet, true);
  });
});

describe("Card Check (scenarios 7-10)", () => {
  it("7. missing description -> MISSING_INFO with Description", () => {
    const a = assessCard(card({ desc: "" }));
    assert.equal(a.readiness, "MISSING_INFO");
    assert.ok(a.missing.includes("description_present"));
  });

  it("8. bug without reproduction steps", () => {
    const a = assessCard(card({ desc: "The filter on the tasks page is wrong. Expected open tasks only. Actually closed ones too." }));
    assert.equal(a.type, "BUG");
    assert.deepEqual(a.missing, ["repro_steps"]);
    assert.deepEqual(a.missing_labels, ["Steps to reproduce"]);
  });

  it("9. feature without acceptance criteria", () => {
    const a = assessCard(feature({ desc: "As an admin I want to export orders from the report page so that I can share them." }));
    assert.equal(a.type, "FEATURE");
    assert.deepEqual(a.missing, ["acceptance_criteria"]);
  });

  it("9b. a checklist counts as acceptance criteria", () => {
    const a = assessCard(feature({ desc: "As an admin I want to export orders from the report page.", checklists: [{ name: "Done when", items: [{ name: "CSV downloads" }] }] }));
    assert.equal(a.readiness, "READY");
  });

  it("10. ambiguous type -> UNCLEAR, never guessed", () => {
    const a = assessCard({ name: "Fix and add things on the dashboard page", desc: "Some text about the dashboard page here.", labels: [] });
    assert.equal(a.type, "UNCLEAR");
    assert.ok(a.missing.includes("type_clear"));
    assert.equal(a.readiness, "MISSING_INFO");
    const none = assessCard({ name: "Dashboard page widgets", desc: "Some text about the dashboard page here.", labels: [] });
    assert.equal(none.type, "UNCLEAR");
  });

  it("MIXED (bug + feature labels) must satisfy both rule sets (audit D1)", () => {
    const a = assessCard(card({ labels: [{ name: "Bug" }, { name: "Enhancement" }] }));
    assert.equal(a.type, "MIXED");
    assert.ok(a.missing.includes("wanted_behavior"));
    assert.ok(a.missing.includes("acceptance_criteria"));
    assert.ok(!a.missing.includes("repro_steps"));
  });

  it("vague one-word title is not clear; Arabic keywords are understood", () => {
    assert.ok(assessCard({ name: "Fix", desc: "" }).missing.includes("title_clear"));
    const ar = assessCard({ name: "مشكلة في صفحة الطلبات عند الفلترة", desc: "خطوات:\n1. افتح الصفحة\n2. اختر مفتوح\nالمتوقع: الطلبات المفتوحة فقط. الفعلي: يظهر الكل.", labels: [] });
    assert.equal(ar.type, "BUG");
    assert.equal(ar.readiness, "READY");
  });
});

describe("Trello REST provider with mocked fetch (scenarios 11-12)", () => {
  const boards = [{ name: "Product", lists: [{ id: "L1", name: "Backlog" }, { id: "L2", name: "Doing" }] }];

  it("11. authentication failure -> blocked, token never leaks", async () => {
    const fetchImpl = async () => ({ status: 401, ok: false, json: async () => ({}) });
    const client = createTrelloClient({ key: "KEY123", token: "SECRET-TOKEN-XYZ", fetchImpl });
    const r = await fetchAssignedCards(client, { memberId: ME, boards });
    assert.equal(r.status, "blocked");
    assert.equal(r.error_code, "auth_failed");
    assert.doesNotMatch(JSON.stringify(r), /SECRET-TOKEN-XYZ|KEY123/);

    const out = run("watch-ingest", "--json-file", writeJson("auth", r));
    assert.match(out.line, /^BLOCKED: Trello rejected/);
    assert.equal(out.notification.send, true);
    assert.equal(run("card-check", "--id", "c-bug").status, "new", "nothing marked seen");
  });

  it("12. timeout -> incomplete, and a network error message is scrubbed", async () => {
    const timeoutFetch = async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    };
    const r = await fetchAssignedCards(createTrelloClient({ key: "k", token: "t0ken", fetchImpl: timeoutFetch }), { memberId: ME, boards });
    assert.equal(r.status, "incomplete");
    assert.equal(r.error_code, "timeout");

    const netFetch = async (url) => {
      throw new Error(`connect failed for ${url}`);
    };
    const r2 = await fetchAssignedCards(createTrelloClient({ key: "k1", token: "t0ken-very-secret", fetchImpl: netFetch }), { memberId: ME, boards });
    assert.equal(r2.error_code, "network");
    assert.doesNotMatch(r2.reason, /t0ken-very-secret/);
  });

  it("reads every list, normalizes cards, and only uses GET", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url: String(url), method: opts.method });
      const listId = String(url).match(/lists\/(\w+)\/cards/)[1];
      return {
        status: 200,
        ok: true,
        json: async () => [{ id: `card-${listId}`, name: "N", desc: "", idMembers: [ME], labels: [{ name: "Bug" }], checklists: [{ name: "c", checkItems: [{ name: "i", state: "complete" }] }], url: "u" }],
      };
    };
    const r = await fetchAssignedCards(createTrelloClient({ key: "k", token: "t", fetchImpl }), { memberId: ME, boards });
    assert.equal(r.status, "ok");
    assert.equal(r.cards.length, 2);
    assert.deepEqual(r.cards[0].checklists[0].items[0], { name: "i", state: "complete" });
    assert.equal(r.cards[1].list, "Doing");
    assert.ok(calls.every((c) => c.method === "GET"));
  });

  it("missing credentials is a clear error", () => {
    assert.throws(() => createTrelloClient({}), (e) => e instanceof TrelloError && e.code === "missing_credentials");
  });
});

describe("locking and recovery (scenarios 13-16)", () => {
  it("13. duplicate watcher execution: second run does not get the lock", () => {
    assert.equal(run("lock-acquire", "--name", "task-watcher", "--run-id", "poll-A").acquired, true);
    const b = run("lock-acquire", "--name", "task-watcher", "--run-id", "poll-B");
    assert.equal(b.acquired, false);
    assert.equal(b.reason, "active_lock_held");
  });

  it("14. a failing command leaves no write lock behind, and the run lock can still be released", () => {
    run("lock-acquire", "--name", "task-watcher", "--run-id", "poll-A");
    const bad = path.join(stateDir, "bad.json");
    fs.writeFileSync(bad, "{not json");
    const r = run("watch-ingest", "--json-file", bad);
    assert.equal(r.ok, false);
    assert.ok(!fs.existsSync(path.join(stateDir, "ledger.write.lock")));
    assert.equal(run("lock-release", "--name", "task-watcher", "--run-id", "poll-A").released, true);
    assert.equal(run("lock-acquire", "--name", "task-watcher", "--run-id", "poll-B").acquired, true);
  });

  it("15. no duplicate notifications: same cards or same failure are announced once", () => {
    const first = ingest([card()]);
    assert.equal(first.notification.send, true);
    // Simulate a crash that lost the ledger but kept notification history.
    fs.unlinkSync(path.join(stateDir, "ledger.json"));
    const again = ingest([card()]);
    assert.equal(again.cards[0].state, "new");
    assert.equal(again.notification.send, false);
    assert.equal(again.notification.reason, "already_notified");

    const fail = { status: "incomplete", reason: "Backlog: timeout" };
    assert.equal(run("watch-ingest", "--json-file", writeJson("f1", fail)).notification.send, true);
    assert.equal(run("watch-ingest", "--json-file", writeJson("f2", fail)).notification.send, false);
    ingest([card()]); // success clears the failure
    assert.equal(run("watch-ingest", "--json-file", writeJson("f3", fail)).notification.send, true);
  });

  it("16. restart: saved state survives a new process; project slugs are stable", () => {
    ingest([card(), feature()]);
    const status = run("watcher-status");
    assert.equal(status.cards_tracked, 2);
    assert.equal(status.last_successful_poll.new_count, 2);
    assert.equal(ingest([card(), feature()]).quiet, true);
    assert.equal(projectSlugFor("/work/my-app"), projectSlugFor("/work/my-app"));
    assert.notEqual(projectSlugFor("/work/my-app"), projectSlugFor("/other/my-app"));
  });

  it("state lives under ENGOPS_HOME/projects/<slug> when no state dir is forced", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "engops-home-"));
    const env = { ...process.env, ENGOPS_HOME: home };
    delete env.ENGOPS_STATE_DIR;
    delete env.AI_WORKFLOW_STATE_DIR;
    const out = JSON.parse(execFileSync(process.execPath, [STATE, "paths", "--project", "demo-app"], { env, encoding: "utf8" }));
    assert.equal(out.state_dir, path.join(home, "projects", "demo-app"));
  });
});

// ---------------------------------------------------------------- new features

describe("run IDs and config", () => {
  it("run-id is real UTC (audit D2)", () => {
    assert.equal(run("run-id", "--prefix", "poll", "--at", "2026-11-07T13:28:48.777Z").run_id, "poll-20261107T132848Z");
  });

  it("config-set merges, and refuses secrets", () => {
    const f1 = writeJson("c1", { provider: { type: "trello", member_id: ME }, watcher: { interval_minutes: 30 } });
    run("config-set", "--json-file", f1);
    run("config-set", "--json-file", writeJson("c2", { watcher: { timezone: "Africa/Cairo" } }));
    const cfg = run("config-get").config;
    assert.equal(cfg.provider.member_id, ME);
    assert.equal(cfg.watcher.interval_minutes, 30);
    assert.equal(cfg.watcher.timezone, "Africa/Cairo");

    const bad = run("config-set", "--json-file", writeJson("c3", { provider: { trello_token: "abc" } }));
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.keys, ["provider.trello_token"]);
  });

  it("window uses configured watcher settings", () => {
    run("config-set", "--json-file", writeJson("w", { watcher: { timezone: "Africa/Cairo", start: "10:00", end: "19:00", working_days: "Sun,Mon,Tue,Wed,Thu" } }));
    assert.equal(run("window", "--at", "2026-10-28T11:30:00Z").inWindow, true); // Wed 14:30
    assert.equal(run("window", "--at", "2026-10-30T11:30:00Z").inWindow, false); // Fri
  });

  it("watch-ingest takes member_id from config when the input has none", () => {
    run("config-set", "--json-file", writeJson("m", { provider: { member_id: ME } }));
    const f = writeJson("nomember", { status: "ok", cards: [card()] });
    assert.equal(run("watch-ingest", "--json-file", f).cards.length, 1);
  });

  it("cards-list filters by readiness", () => {
    ingest([card(), card({ id: "c-empty", name: "Export", desc: "", labels: [] })]);
    const missing = run("cards-list", "--readiness", "MISSING_INFO").cards;
    assert.equal(missing.length, 1);
    assert.equal(missing[0].id, "c-empty");
  });
});

describe("worklog (#3)", () => {
  it("tracks name, start, end and active time across pauses", () => {
    run("task-start", "--id", "c-bug", "--title", "Fix Open filter", "--url", "https://trello.example/c/bug", "--at", "2026-11-08T08:00:00Z");
    assert.equal(run("task-start", "--id", "c-bug", "--at", "2026-11-08T08:10:00Z").reason, "already_running");
    run("task-pause", "--id", "c-bug", "--at", "2026-11-08T09:30:00Z"); // 90 min
    assert.equal(run("task-pause", "--id", "c-bug", "--at", "2026-11-08T09:40:00Z").reason, "not_running");
    const resumed = run("task-start", "--id", "c-bug", "--at", "2026-11-08T13:00:00Z");
    assert.equal(resumed.resumed, true);
    const stopped = run("task-stop", "--id", "c-bug", "--at", "2026-11-08T13:45:00Z"); // +45
    assert.equal(stopped.task.active_minutes, 135);
    assert.equal(stopped.task.status, "done");
    assert.equal(stopped.task.started_at, "2026-11-08T08:00:00.000Z");
    assert.equal(stopped.task.ended_at, "2026-11-08T13:45:00.000Z");
    assert.equal(stopped.task.sessions, 2);
  });

  it("a running timer counts up to now; list totals; stage timings come from the ledger", () => {
    run("task-start", "--id", "t1", "--title", "One", "--at", "2026-11-08T08:00:00Z");
    run("stage-done", "--id", "t1", "--stage", "1_intake", "--fingerprint", "f", "--at", "2026-11-08T08:05:00Z");
    run("stage-done", "--id", "t1", "--stage", "2_baseline", "--fingerprint", "f", "--at", "2026-11-08T08:35:00Z");
    const list = run("worklog-list", "--at", "2026-11-08T09:00:00Z");
    assert.equal(list.tasks[0].active_minutes, 60);
    assert.equal(list.tasks[0].running, true);
    assert.equal(list.total_minutes, 60);
    assert.equal(list.tasks[0].stages[1].minutes_since_previous, 30);
  });

  it("exports CSV and Markdown, escaping commas and pipes", () => {
    run("task-start", "--id", "t1", "--title", "Fix a, b | c", "--at", "2026-11-08T08:00:00Z");
    run("task-stop", "--id", "t1", "--at", "2026-11-08T08:30:00Z");
    const csv = run("worklog-export", "--format", "csv").content.split("\n");
    assert.equal(csv[0], "id,title,kind,status,started_at,ended_at,active_minutes,sessions,url,pr,github_comments");
    assert.match(csv[1], /^t1,"Fix a, b \| c",,done,2026-11-08T08:00:00.000Z,2026-11-08T08:30:00.000Z,30,1/);
    const md = run("worklog-export", "--format", "md").content;
    assert.match(md, /Fix a, b \\\| c \| done .* \| 0h 30m \|/);
    const out = path.join(stateDir, "export.md");
    assert.equal(run("worklog-export", "--format", "md", "--out", out).written, out);
    assert.ok(fs.readFileSync(out, "utf8").startsWith("# Work log"));
  });

  it("stores GitHub PR comments and reviews for the task (from gh JSON)", () => {
    run("task-start", "--id", "t1", "--title", "One", "--at", "2026-11-08T08:00:00Z");
    const gh = {
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "fix: open filter",
      state: "OPEN",
      comments: [{ author: { login: "alice" }, body: "Please add a test", createdAt: "2026-11-08T10:00:00Z" }],
      reviews: [{ author: { login: "bob" }, state: "CHANGES_REQUESTED", body: "Rename var", submittedAt: "2026-11-08T11:00:00Z" }, { author: { login: "x" }, state: "", body: "" }],
    };
    const r = run("worklog-github", "--id", "t1", "--json-file", writeJson("gh", gh));
    assert.equal(r.github.pr.number, 42);
    assert.equal(r.github.comments[0].author, "alice");
    assert.equal(r.github.reviews.length, 1);
    assert.equal(run("worklog-list").tasks[0].github.comment_count, 2);
    assert.match(run("worklog-export", "--format", "md").content, /\*\*bob\*\* \(2026-11-08T11:00:00Z, CHANGES_REQUESTED\): Rename var/);
  });

  it("without --json-file and without a known branch it explains what is needed", () => {
    run("task-start", "--id", "t1", "--title", "One");
    const r = run("worklog-github", "--id", "t1");
    assert.equal(r.ok, false);
    assert.match(r.error, /no branch known/);
  });
});

describe("alerts (#10)", () => {
  function oldLock(name, minutesAgo, runId = "run-1") {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, `${name}.lock.json`), JSON.stringify({ run_id: runId, acquired_at: new Date(Date.now() - minutesAgo * 60000).toISOString() }));
  }

  it("stuck task (lock not refreshed) alerts once, then resolves", () => {
    oldLock("task-c-bug", 75);
    const a = run("alert-check", "--stuck-minutes", "60");
    assert.equal(a.notify, true);
    assert.equal(a.new_alerts[0].kind, "STUCK");
    assert.match(a.message, /no progress for 75 min/);
    assert.equal(run("alert-check", "--stuck-minutes", "60").notify, false, "same alert is not repeated");
    fs.unlinkSync(path.join(stateDir, "task-c-bug.lock.json"));
    const after = run("alert-check", "--stuck-minutes", "60");
    assert.equal(after.active_count, 0);
    assert.equal(after.resolved.length, 1);
  });

  it("a fresh task lock is not stuck", () => {
    oldLock("task-c-bug", 5);
    assert.equal(run("alert-check", "--stuck-minutes", "60").notify, false);
  });

  it("BLOCKED status, used-up repair rounds, watcher failure and a forgotten timer", () => {
    run("card-upsert", "--id", "c1", "--json-file", writeJson("b", { card_name: "Login page", status: "BLOCKED", blocked_reason: "needs test login" }));
    run("card-upsert", "--id", "c2", "--json-file", writeJson("r", { card_name: "Report", status: "CHANGES_REQUIRED", repair_rounds: 2 }));
    run("watch-ingest", "--json-file", writeJson("wf", { status: "blocked", reason: "Trello connector not available" }));
    run("task-start", "--id", "t9", "--title", "Long one", "--at", "2026-11-08T00:00:00Z");
    const a = run("alert-check", "--at", "2026-11-08T10:00:00Z", "--long-timer-hours", "8");
    const kinds = a.new_alerts.map((x) => x.kind).sort();
    assert.deepEqual(kinds, ["BLOCKED", "REPAIR_LIMIT", "TIMER_RUNNING", "WATCHER_FAILED"]);
    assert.match(a.message, /^4 alerts: /);
    assert.ok(a.message.length < 200);
    const key = a.new_alerts[0].key;
    assert.equal(run("alert-ack", "--key", key).alert.acked, true);
    assert.equal(run("alert-list").alerts.length, 4);
  });
});
