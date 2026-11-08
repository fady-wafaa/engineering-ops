#!/usr/bin/env node
// Engineering Ops state helper — deterministic, non-LLM.
//
// Ported from SuiteFleet's ai-workflow/scripts/watcher-state.mjs (see docs/AUDIT.md).
// Prompt text alone cannot guarantee a time window, a lock, duplicate prevention or a
// correct duration. This script does that work with atomic file operations and prints
// JSON. Skills and agents run it and act on the JSON; they do not re-derive decisions.
//
// It never talks to Trello, Jira or GitHub on its own, with one exception:
// `worklog-github` may run the local `gh` CLI read-only when no --json-file is given.
//
// State: <ENGOPS_HOME>/projects/<slug>/ (outside the repository). See scripts/lib/common.mjs.
// Every command accepts --project <slug>. Run `paths` to see where state lives.
//
// Commands (original):   window, lock-acquire, lock-release, lock-refresh, lock-status,
//   card-check, card-upsert, task-get, stage-done, task-resume, action-begin,
//   action-resolve, fingerprint, report-line, poll-record, poll-last
// Commands (new):        paths, run-id, config-get, config-set, card-assess, watch-ingest,
//   watcher-status, cards-list, notify-history, task-start, task-pause, task-stop,
//   worklog-list, worklog-export, worklog-github, alert-check, alert-list, alert-ack

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { assessCard } from "./lib/assess.mjs";
import { scoreAudit } from "./lib/audit.mjs";
import { scorePerf } from "./lib/perf.mjs";
import { scorePrompt } from "./lib/prompt-score.mjs";
import { routeTask } from "./lib/routing.mjs";
import {
  atomicWrite,
  deepMerge,
  fail,
  jsonArg,
  parseArgs,
  parseJsonArg,
  printJson,
  readJsonSafe,
  removeQuietly,
  resolveProject,
  sleepMs,
  truncate,
  utcRunId,
} from "./lib/common.mjs";

// The command is the first non-flag argument, so `--project <slug> <command>` also works.
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const PROJECT = resolveProject(args);
const STATE_DIR = PROJECT.stateDir;
const LEDGER_PATH = path.join(STATE_DIR, "ledger.json");
const NOTIFY_PATH = path.join(STATE_DIR, "notifications.json");
const WORKLOG_PATH = path.join(STATE_DIR, "worklog.json");
const ALERTS_PATH = path.join(STATE_DIR, "alerts.json");
const AUDITS_PATH = path.join(STATE_DIR, "audits.json");

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function nowDate() {
  // --at lets tests use a fixed instant instead of the real clock.
  const d = args.at ? new Date(args.at) : new Date();
  if (Number.isNaN(d.getTime())) throw new Error("--at is not a valid date");
  return d;
}

function config() {
  return readJsonSafe(PROJECT.configPath, null) || {};
}

// ---- paths / config ---------------------------------------------------------------

function cmdPaths() {
  printJson({
    ok: true,
    project: PROJECT.slug,
    state_dir: STATE_DIR,
    config_path: PROJECT.configPath,
    config_exists: fs.existsSync(PROJECT.configPath),
  });
}

function cmdRunId() {
  printJson({ ok: true, run_id: utcRunId(String(args.prefix || "run"), nowDate()) });
}

function cmdConfigGet() {
  const cfg = readJsonSafe(PROJECT.configPath, null);
  printJson({ ok: true, exists: cfg !== null, config: cfg, config_path: PROJECT.configPath });
}

// Secrets never belong in config. Refuse anything that looks like one.
const SECRET_KEY = /(token|secret|password|api[_-]?key|apikey|cookie)/i;
function findSecretKeys(obj, prefix = "") {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    const self = SECRET_KEY.test(k) && typeof v === "string" && v.length > 0 ? [p] : [];
    return [...self, ...findSecretKeys(v, p)];
  });
}

function cmdConfigSet() {
  const parsed = parseJsonArg(args, "config-set");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const secrets = findSecretKeys(parsed.value);
  if (secrets.length)
    return fail("config must not contain secrets; use environment variables", { keys: secrets });
  ensureStateDir();
  const current = args.replace ? {} : readJsonSafe(PROJECT.configPath, {}) || {};
  const merged = deepMerge(current, parsed.value);
  merged.version = merged.version || 1;
  merged.updated_at = new Date().toISOString();
  atomicWrite(PROJECT.configPath, JSON.stringify(merged, null, 2));
  printJson({ ok: true, config: merged, config_path: PROJECT.configPath });
}

// ---- window -----------------------------------------------------------------------

function cmdWindow() {
  const w = config().watcher || {};
  const tz = args.tz || w.timezone || config().timezone || "UTC";
  const start = args.start || w.start || "00:00";
  const end = args.end || w.end || "23:59";
  const daysArg = args.days || w.working_days || "all";
  const now = nowDate();
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return fail(`unknown time zone: ${tz}`);
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const hhmm = `${hour}:${parts.minute}`;
  const localIso = `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
  const weekday = parts.weekday;

  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  const nowMinutes = Number(hour) * 60 + Number(parts.minute);
  // A scheduler may dispatch a slot a few minutes late. Grace lets the last slot through
  // without allowing the next one. Start is strict: jitter only delays.
  const graceMinutes = Number(args["grace-minutes"] ?? w.grace_minutes ?? 15);
  const inTimeRange = nowMinutes >= sh * 60 + sm && nowMinutes <= eh * 60 + em + graceMinutes;

  let dayOk = true;
  let daysSource = "configured";
  if (!daysArg || daysArg === "all" || daysArg === true) {
    daysSource = "not configured; applied every day";
  } else {
    const allowed = String(daysArg).split(",").map((d) => d.trim().slice(0, 3));
    dayOk = allowed.includes(weekday);
  }
  const inWindow = inTimeRange && dayOk;
  printJson({
    ok: true,
    inWindow,
    timezone: tz,
    nowLocal: hhmm,
    nowLocalIso: localIso,
    weekday,
    window: `${start}-${end}`,
    graceMinutesAfterEnd: graceMinutes,
    daysConfigured: daysArg === "all" || daysArg === true ? "all" : daysArg,
    daysSource,
    reason: inWindow
      ? "within configured window"
      : !inTimeRange
        ? `outside time window (${start}-${end} ${tz})`
        : `outside configured working days (today is ${weekday})`,
  });
}

// ---- locks ------------------------------------------------------------------------

function lockFilePath(name) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(STATE_DIR, `${safe}.lock.json`);
}

function cmdLockAcquire() {
  if (!args.name || !args["run-id"]) return fail("lock-acquire requires --name and --run-id");
  ensureStateDir();
  const staleMinutes = Number(args["stale-minutes"] || 90);
  const file = lockFilePath(args.name);
  const payload = { run_id: args["run-id"], acquired_at: new Date().toISOString(), note: args.note || null };

  // Atomic exclusive create with complete content: write a temp file, then hard-link it to
  // the lock name. link() fails with EEXIST if the lock exists, and a reader never sees a
  // half-written lock.
  function tryCreate() {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    try {
      fs.linkSync(tmp, file);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      return false;
    } finally {
      removeQuietly(tmp);
    }
  }

  // Take over a dead lock. The original used rename() alone as the arbiter, but that has a
  // race: run B judges the lock stale, run A takes it over and writes a FRESH lock, then
  // B's rename removes A's fresh lock and both runs win (seen under load in the
  // "same stale lock" test). Fix: one exclusive takeover guard, and the staleness decision
  // is made again inside it, so a lock renewed by another run is never taken.
  function takeOver(extra, judged) {
    const guard = `${file}.takeover`;
    try {
      fs.closeSync(fs.openSync(guard, "wx"));
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(guard).mtimeMs > 60000) removeQuietly(guard); // crashed guard holder
      } catch {
        // guard vanished meanwhile; another run is finishing its takeover
      }
      return printJson({ ok: true, acquired: false, reason: "another_run_recovered_lock_first" });
    }
    try {
      let current = null;
      try {
        current = readJsonSafe(file, null);
      } catch {
        current = null;
      }
      const exists = fs.existsSync(file);
      const sameLock = judged
        ? current && current.run_id === judged.run_id && current.acquired_at === judged.acquired_at
        : !current || !current.acquired_at; // still unreadable/corrupt
      if (exists && !sameLock) {
        return printJson({ ok: true, acquired: false, reason: "another_run_recovered_lock_first", holder_run_id: current?.run_id || null });
      }
      if (exists) {
        const stalePath = `${file}.${process.pid}.${Date.now()}.stale`;
        try {
          fs.renameSync(file, stalePath);
        } catch {
          return printJson({ ok: true, acquired: false, reason: "another_run_recovered_lock_first" });
        }
        removeQuietly(stalePath);
      }
      if (!tryCreate()) return printJson({ ok: true, acquired: false, reason: "another_run_recovered_lock_first" });
      return printJson({ ok: true, acquired: true, recovered_stale: true, ...extra, lock: payload });
    } finally {
      removeQuietly(guard);
    }
  }

  try {
    if (tryCreate()) return printJson({ ok: true, acquired: true, recovered_stale: false, lock: payload });
  } catch (e) {
    return fail("lock-acquire failed", { detail: String(e) });
  }

  let existing = null;
  try {
    existing = readJsonSafe(file, null);
  } catch {
    existing = null;
  }
  if (!existing || !existing.acquired_at) return takeOver({ reason: "existing lock file was unreadable/corrupt" });

  const ageMinutes = (Date.now() - new Date(existing.acquired_at).getTime()) / 60000;
  if (ageMinutes >= staleMinutes) {
    return takeOver({ previous_run_id: existing.run_id, previous_age_minutes: Math.round(ageMinutes) }, existing);
  }
  // A fresh lock is never cleared just because a new run started.
  return printJson({
    ok: true,
    acquired: false,
    reason: "active_lock_held",
    holder_run_id: existing.run_id,
    age_minutes: Math.round(ageMinutes),
  });
}

function readLock(name) {
  try {
    return { lock: readJsonSafe(lockFilePath(name), null) };
  } catch {
    return { unreadable: true };
  }
}

function cmdLockRelease() {
  if (!args.name || !args["run-id"]) return fail("lock-release requires --name and --run-id");
  const { lock, unreadable } = readLock(args.name);
  if (unreadable) return printJson({ ok: true, released: false, reason: "lock_unreadable" });
  if (!lock) return printJson({ ok: true, released: false, reason: "no_lock_present" });
  if (lock.run_id !== args["run-id"])
    return printJson({ ok: true, released: false, reason: "not_owner", holder_run_id: lock.run_id });
  fs.unlinkSync(lockFilePath(args.name));
  return printJson({ ok: true, released: true });
}

// A long run calls this after each completed stage, so an active lock never looks stale.
function cmdLockRefresh() {
  if (!args.name || !args["run-id"]) return fail("lock-refresh requires --name and --run-id");
  const { lock, unreadable } = readLock(args.name);
  if (unreadable) return printJson({ ok: true, refreshed: false, reason: "lock_unreadable" });
  if (!lock) return printJson({ ok: true, refreshed: false, reason: "no_lock_present" });
  if (lock.run_id !== args["run-id"])
    return printJson({ ok: true, refreshed: false, reason: "not_owner", holder_run_id: lock.run_id });
  lock.acquired_at = new Date().toISOString();
  atomicWrite(lockFilePath(args.name), JSON.stringify(lock, null, 2));
  printJson({ ok: true, refreshed: true, lock });
}

function cmdLockStatus() {
  if (!args.name) return fail("lock-status requires --name");
  const { lock, unreadable } = readLock(args.name);
  if (unreadable) return printJson({ ok: true, present: true, unreadable: true });
  if (!lock) return printJson({ ok: true, present: false });
  const age = (Date.now() - new Date(lock.acquired_at).getTime()) / 60000;
  printJson({ ok: true, present: true, lock, age_minutes: Math.round(age) });
}

// ---- ledger -----------------------------------------------------------------------

function loadLedger() {
  return readJsonSafe(LEDGER_PATH, { version: 1, tasks: {}, polls: [] });
}

function saveLedger(ledger) {
  atomicWrite(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

// The watcher and an interactive session may both write state files. Each
// read-modify-write runs under a short exclusive lock. A lock older than 2 minutes is a
// crashed writer and is taken over.
function withWriteLock(fn) {
  ensureStateDir();
  const file = path.join(STATE_DIR, "ledger.write.lock");
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(file, "wx"));
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(file).mtimeMs > 120000;
      } catch {
        continue;
      }
      if (stale) {
        removeQuietly(file);
        continue;
      }
      if (Date.now() > deadline) throw new Error("state write lock busy for 10s");
      sleepMs(100);
    }
  }
  try {
    return fn();
  } finally {
    removeQuietly(file);
  }
}

function cmdCardCheck() {
  if (!args.id) return fail("card-check requires --id");
  const entry = loadLedger().tasks[args.id];
  if (!entry || !entry.last_seen_fingerprint) return printJson({ ok: true, status: "new" });
  if (args.fingerprint && entry.last_seen_fingerprint === args.fingerprint)
    return printJson({ ok: true, status: "unchanged", last_seen_at: entry.last_seen_at, entry });
  return printJson({ ok: true, status: "changed", previous_fingerprint: entry.last_seen_fingerprint || null, entry });
}

function cmdCardUpsert() {
  if (!args.id) return fail("card-upsert requires --id");
  const parsed = parseJsonArg(args, "card-upsert");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const ledger = loadLedger();
  const merged = { ...(ledger.tasks[args.id] || {}), ...parsed.value, updated_at: new Date().toISOString() };
  ledger.tasks[args.id] = merged;
  saveLedger(ledger);
  printJson({ ok: true, entry: merged });
}

// External actions use a two-phase record: "pending" BEFORE the action, "done" AFTER it.
// A crash between them leaves "pending" = outcome uncertain: check the real system first.
function cmdActionBegin() {
  if (!args.id || !args.action) return fail("action-begin requires --id and --action");
  const key = String(args.action);
  const ledger = loadLedger();
  const entry = ledger.tasks[args.id] || {};
  const actions = entry.completed_external_actions || {};
  const prior = actions[key];
  if (prior?.status === "done") return printJson({ ok: true, proceed: false, reason: "already_done", action: prior });
  if (prior?.status === "pending")
    return printJson({ ok: true, proceed: false, reason: "outcome_uncertain_reconcile_first", action: prior });
  actions[key] = { status: "pending", started_at: new Date().toISOString(), intent: args.intent || null };
  ledger.tasks[args.id] = { ...entry, completed_external_actions: actions, updated_at: new Date().toISOString() };
  saveLedger(ledger);
  printJson({ ok: true, proceed: true, action: actions[key] });
}

function cmdActionResolve() {
  if (!args.id || !args.action || !args.result)
    return fail("action-resolve requires --id, --action and --result done|not_done");
  const key = String(args.action);
  const ledger = loadLedger();
  const entry = ledger.tasks[args.id] || {};
  const actions = entry.completed_external_actions || {};
  if (args.result === "done") {
    actions[key] = { ...(actions[key] || {}), status: "done", completed_at: new Date().toISOString(), evidence: args.evidence || null };
  } else if (args.result === "not_done") {
    delete actions[key];
  } else {
    return fail("--result must be done or not_done");
  }
  ledger.tasks[args.id] = { ...entry, completed_external_actions: actions, updated_at: new Date().toISOString() };
  saveLedger(ledger);
  printJson({ ok: true, action: actions[key] || null, result: args.result });
}

// Canonical stage order. Stages 1-6 are valid only for the task version (fingerprint)
// they ran against; stages 7-9 also for the exact change identity (diff SHA-256).
const STAGES = [
  "1_intake",
  "2_baseline",
  "3_analysis",
  "4_questions",
  "5_mode_branch_gate",
  "6_implementation",
  "7_checks_postcheck",
  "8_final_review",
  "9_report_handoff",
];
const CHANGE_BOUND = new Set(["7_checks_postcheck", "8_final_review", "9_report_handoff"]);

function cmdStageDone() {
  if (!args.id || !args.stage || !args.fingerprint) return fail("stage-done requires --id, --stage and --fingerprint");
  if (!STAGES.includes(args.stage)) return fail("unknown stage", { stages: STAGES });
  if (CHANGE_BOUND.has(args.stage) && !args["change-identity"])
    return fail(`${args.stage} requires --change-identity (diff SHA-256)`);
  const ledger = loadLedger();
  const entry = ledger.tasks[args.id] || {};
  const stages = entry.stages || {};
  stages[args.stage] = {
    status: "done",
    task_fingerprint: args.fingerprint,
    change_identity: args["change-identity"] || null,
    evidence: args.evidence || null,
    run_id: args["run-id"] || entry.run_id || null,
    // Planned vs actual model are recorded separately; "actual" only when verifiable.
    model_planned: args["model-planned"] || null,
    model_actual: args["model-actual"] || null,
    completed_at: nowDate().toISOString(),
  };
  const patch = { stages, current_stage: args.stage };
  if (args.stage === "6_implementation" && args["change-identity"]) patch.change_identity = args["change-identity"];
  ledger.tasks[args.id] = { ...entry, ...patch, updated_at: new Date().toISOString() };
  saveLedger(ledger);
  printJson({ ok: true, stage: args.stage, record: stages[args.stage] });
}

function cmdTaskResume() {
  if (!args.id || !args.fingerprint) return fail("task-resume requires --id and --fingerprint");
  const entry = loadLedger().tasks[args.id];
  if (!entry || !entry.stages)
    return printJson({ ok: true, resume_at: STAGES[0], reason: "no_saved_stages", invalidated: [] });
  const currentChange = args["change-identity"] || entry.change_identity || null;
  const invalidated = [];
  let resumeAt = null;
  let reason = "all_stages_valid";
  for (const stage of STAGES) {
    const rec = entry.stages[stage];
    if (resumeAt) {
      if (rec) invalidated.push(stage);
      continue;
    }
    if (!rec || rec.status !== "done") {
      resumeAt = stage;
      reason = "first_incomplete_stage";
      continue;
    }
    if (rec.task_fingerprint !== args.fingerprint) {
      resumeAt = stage;
      reason = "task_changed_since_stage";
      invalidated.push(stage);
      continue;
    }
    if (CHANGE_BOUND.has(stage) && rec.change_identity !== currentChange) {
      resumeAt = stage;
      reason = "change_identity_differs_from_checked_version";
      invalidated.push(stage);
    }
  }
  printJson({ ok: true, resume_at: resumeAt, reason, invalidated, current_change_identity: currentChange });
}

// Requirement fingerprint: only fields that define the task. Moves, members, comments and
// the branch suffix this workflow appends are excluded.
function fingerprintCard(card, stripSuffix) {
  let name = String(card.name || "").trim();
  if (stripSuffix) {
    const suffix = ` ${String(stripSuffix).trim()}`;
    if (name.endsWith(suffix)) name = name.slice(0, -suffix.length).trimEnd();
  }
  const canonical = {
    name,
    desc: String(card.desc || "").replace(/\r\n/g, "\n").trim(),
    labels: [...(card.labels || [])].map((l) => (typeof l === "string" ? l : l.name)).sort(),
    due: card.due || null,
    checklists: (card.checklists || []).map((cl) => ({
      name: cl.name,
      items: (cl.items || cl.checkItems || []).map((i) => `${i.state || ""}:${i.name}`),
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

function cmdFingerprint() {
  const parsed = parseJsonArg(args, "fingerprint");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  printJson({
    ok: true,
    fingerprint: fingerprintCard(parsed.value, args["strip-suffix"]),
    canonical_fields: ["name", "desc", "labels", "due", "checklists"],
  });
}

function cmdCardAssess() {
  const parsed = parseJsonArg(args, "card-assess");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  printJson({ ok: true, assessment: assessCard(parsed.value) });
}

// "No new cards" is never produced: a successful check with nothing new is quiet, and a
// check that did not complete is always reported as incomplete/blocked.
function reportLineFor(poll) {
  if (poll.status === "blocked") return { quiet: false, line: `BLOCKED: ${poll.reason || "unknown reason"}` };
  if (poll.status !== "ok") return { quiet: false, line: `Check incomplete: ${poll.reason || "unknown reason"}` };
  const fmt = (tag, c) => {
    const where = c.board ? `${c.board} / ${c.list}` : c.list;
    const check = c.readiness
      ? ` | Card check: ${c.readiness}${c.missing?.length ? ` - ${c.missing.join(", ")}` : ""}`
      : "";
    return `${tag}: ${c.name} | ${where} | ${c.url}${check}`;
  };
  const lines = [
    ...(poll.new_cards || []).map((c) => fmt("NEW", c)),
    ...(poll.changed_cards || []).map((c) => fmt("CHANGED", c)),
  ];
  return lines.length ? { quiet: false, line: lines.join("\n") } : { quiet: true, line: "" };
}

function cmdReportLine() {
  const parsed = parseJsonArg(args, "report-line");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  printJson({ ok: true, ...reportLineFor(parsed.value) });
}

function cmdTaskGet() {
  if (!args.id) return fail("task-get requires --id");
  printJson({ ok: true, entry: loadLedger().tasks[args.id] || null });
}

function recordPoll(ledger, record) {
  record.recorded_at = new Date().toISOString();
  ledger.polls.push(record);
  ledger.polls = ledger.polls.slice(-50); // rolling log, not an archive
  return record;
}

function cmdPollRecord() {
  const parsed = parseJsonArg(args, "poll-record");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const ledger = loadLedger();
  const record = recordPoll(ledger, parsed.value);
  saveLedger(ledger);
  printJson({ ok: true, record });
}

function cmdPollLast() {
  printJson({ ok: true, polls: loadLedger().polls.slice(-Number(args.limit || 5)) });
}

// ---- notifications ----------------------------------------------------------------
// One aggregated notification per run, never twice for the same content. A repeated
// identical failure is announced once until a successful check clears it.

function loadNotify() {
  return readJsonSafe(NOTIFY_PATH, { version: 1, history: [], active_failure_key: null });
}

function decideNotification(poll, notify) {
  const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
  if (poll.status !== "ok") {
    const key = `fail:${hash(`${poll.status}:${poll.reason || ""}`)}`;
    if (notify.active_failure_key === key) return { send: false, reason: "same_failure_already_notified", key };
    const what = poll.status === "blocked" ? "Task check blocked" : "Task check incomplete";
    return { send: true, key, failure: true, message: truncate(`${what}: ${poll.reason || "unknown reason"}`, 190) };
  }
  const items = [...(poll.new_cards || []), ...(poll.changed_cards || [])];
  if (!items.length) return { send: false, reason: "nothing_new_or_changed" };
  const key = `cards:${hash(items.map((c) => `${c.id}:${c.fingerprint}`).sort().join("|"))}`;
  if (notify.history.some((h) => h.key === key)) return { send: false, reason: "already_notified", key };
  const n = (poll.new_cards || []).length;
  const ch = (poll.changed_cards || []).length;
  let message;
  if (items.length === 1) {
    const c = items[0];
    message = `${n ? "New" : "Changed"} card for you: ${truncate(c.name, 80)} (${truncate(c.list, 30)}). Card check: ${c.readiness || "n/a"}`;
  } else {
    const parts = [n ? `${n} new` : "", ch ? `${ch} changed` : ""].filter(Boolean).join(", ");
    const ready = items.filter((c) => c.readiness === "READY").length;
    message = `${parts} cards for you. ${ready} READY, ${items.length - ready} MISSING_INFO. Open the report for details.`;
  }
  return { send: true, key, message: truncate(message, 190) };
}

function saveNotification(notify, decision, poll) {
  if (poll.status === "ok") notify.active_failure_key = null;
  if (decision.send) {
    if (decision.failure) notify.active_failure_key = decision.key;
    notify.history.push({ key: decision.key, message: decision.message, at: new Date().toISOString(), run_id: poll.run_id || null });
    notify.history = notify.history.slice(-100);
  }
  atomicWrite(NOTIFY_PATH, JSON.stringify(notify, null, 2));
}

function cmdNotifyHistory() {
  printJson({ ok: true, ...loadNotify(), history: loadNotify().history.slice(-Number(args.limit || 10)) });
}

// ---- watch-ingest: one deterministic step for the whole watcher poll ---------------
// Input (from the Trello MCP read or scripts/trello.mjs fetch):
//   { status: "ok"|"incomplete"|"blocked", reason?, member_id, cards: [ { id, name, desc,
//     url, list, board, labels, due, checklists, members|idMembers, closed } ] }
// Filters open cards assigned to member_id, fingerprints them, classifies new / changed /
// unchanged, runs the Card Check on new + changed cards, saves everything, records the
// poll and decides the single notification. An incomplete read marks nothing as seen.

function memberIds(card) {
  const raw = card.members || card.idMembers || [];
  return raw.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
}

// Accepts the neutral shape AND the Trello MCP connector's native shape (verified against
// a live read-only call): list/board as {id,name} objects, members as objects with ARI ids,
// webUrl/url, lastActivityAt, and cards wrapped in {nodes:[...]}. So the model can pass the
// connector output through without rewriting it.
function cardList(input) {
  const c = input.cards;
  if (Array.isArray(c)) return c;
  if (c && Array.isArray(c.nodes)) return c.nodes;
  return [];
}

function normalizeInputCard(card) {
  const nameOf = (v) => (v && typeof v === "object" ? v.name ?? null : v ?? null);
  const due = card.due && typeof card.due === "object" ? card.due.date ?? null : card.due ?? null;
  return {
    ...card,
    url: card.url || card.webUrl || card.shortUrl || null,
    list: nameOf(card.list),
    board: nameOf(card.board),
    due,
    dateLastActivity: card.dateLastActivity || card.lastActivityAt || card.last_activity || null,
  };
}

function cmdWatchIngest() {
  const parsed = parseJsonArg(args, "watch-ingest");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const input = parsed.value;
  const runId = String(args["run-id"] || input.run_id || utcRunId("poll"));
  const ledger = loadLedger();
  const notify = loadNotify();

  let poll;
  const cardsOut = [];
  if (input.status !== "ok") {
    poll = { run_id: runId, status: input.status || "incomplete", reason: input.reason || "provider read did not complete" };
  } else {
    const memberId = input.member_id || config().provider?.member_id;
    if (!memberId) return fail("watch-ingest needs member_id (input or config provider.member_id)");
    const eligible = cardList(input)
      .map(normalizeInputCard)
      .filter((c) => !c.closed && memberIds(c).includes(memberId));
    poll = { run_id: runId, status: "ok", new_cards: [], changed_cards: [], unchanged_count: 0, eligible_count: eligible.length };
    for (const card of eligible) {
      const prev = ledger.tasks[card.id] || {};
      const fp = fingerprintCard(card, prev.branch);
      const state = !prev.last_seen_fingerprint ? "new" : prev.last_seen_fingerprint === fp ? "unchanged" : "changed";
      const patch = {
        card_name: card.name,
        card_url: card.url || null,
        board_name: card.board || null,
        list_name: card.list || null,
        due: card.due || null,
        last_activity: card.dateLastActivity || null,
        last_seen_fingerprint: fp,
        last_seen_at: new Date().toISOString(),
        last_seen_run_id: runId,
      };
      if (state !== "unchanged") {
        const a = assessCard(card);
        Object.assign(patch, {
          readiness: a.readiness,
          readiness_type: a.type,
          readiness_missing: a.missing_labels,
          readiness_summary: a.summary,
          readiness_next_action: a.next_action,
          readiness_method: a.method,
          readiness_fingerprint: fp,
        });
        if (state === "changed") Object.assign(patch, { needs_reassessment: true, previous_fingerprint: prev.last_seen_fingerprint });
        const item = {
          id: card.id,
          name: card.name,
          url: card.url || null,
          board: card.board || null,
          list: card.list || null,
          fingerprint: fp,
          type: a.type,
          summary: a.summary,
          readiness: a.readiness,
          missing: a.missing_labels,
          next_action: a.next_action,
        };
        (state === "new" ? poll.new_cards : poll.changed_cards).push(item);
        cardsOut.push({ ...item, state });
      } else {
        poll.unchanged_count++;
      }
      ledger.tasks[card.id] = { ...prev, ...patch, updated_at: new Date().toISOString() };
    }
  }

  const report = reportLineFor(poll);
  const decision = decideNotification(poll, notify);
  recordPoll(ledger, {
    run_id: poll.run_id,
    status: poll.status,
    reason: poll.reason || null,
    new_count: poll.new_cards?.length || 0,
    changed_count: poll.changed_cards?.length || 0,
    unchanged_count: poll.unchanged_count || 0,
    notified: decision.send,
  });
  // Only an ok poll writes card entries (above). A failed poll still logs the failure.
  saveLedger(ledger);
  saveNotification(notify, decision, poll);
  printJson({
    ok: true,
    run_id: runId,
    status: poll.status,
    reason: poll.reason || null,
    quiet: report.quiet,
    line: report.line,
    cards: cardsOut,
    unchanged_count: poll.unchanged_count || 0,
    notification: decision,
  });
}

function cmdWatcherStatus() {
  const cfg = config();
  const ledger = loadLedger();
  const lockName = cfg.watcher?.lock_name || "task-watcher";
  const { lock } = readLock(lockName);
  const lastOk = [...ledger.polls].reverse().find((p) => p.status === "ok") || null;
  const cards = Object.values(ledger.tasks).filter((t) => t.card_name);
  printJson({
    ok: true,
    configured: Boolean(cfg.provider?.member_id),
    watcher: cfg.watcher || null,
    lock: lock ? { ...lock, age_minutes: Math.round((Date.now() - new Date(lock.acquired_at).getTime()) / 60000) } : null,
    last_poll: ledger.polls.at(-1) || null,
    last_successful_poll: lastOk,
    cards_tracked: cards.length,
    cards_ready: cards.filter((t) => t.readiness === "READY").length,
    cards_missing_info: cards.filter((t) => t.readiness === "MISSING_INFO").length,
  });
}

function cmdCardsList() {
  const want = args.readiness ? String(args.readiness).toUpperCase() : null;
  const cards = Object.entries(loadLedger().tasks)
    .filter(([, t]) => t.card_name && (!want || t.readiness === want))
    .map(([id, t]) => ({
      id,
      name: t.card_name,
      url: t.card_url,
      board: t.board_name,
      list: t.list_name,
      type: t.readiness_type || null,
      readiness: t.readiness || null,
      missing: t.readiness_missing || [],
      needs_reassessment: Boolean(t.needs_reassessment),
      last_seen_at: t.last_seen_at,
      current_stage: t.current_stage || null,
      status: t.status || null,
    }));
  printJson({ ok: true, cards });
}

// ---- worklog: task name, start/end, active duration, stages, GitHub comments --------

function loadWorklog() {
  return readJsonSafe(WORKLOG_PATH, { version: 1, tasks: {} });
}

function saveWorklog(w) {
  atomicWrite(WORKLOG_PATH, JSON.stringify(w, null, 2));
}

function sessionMinutes(s, at) {
  const end = s.end ? new Date(s.end) : at;
  return Math.max(0, (end.getTime() - new Date(s.start).getTime()) / 60000);
}

function summarizeTask(t, at) {
  const total = t.sessions.reduce((sum, s) => sum + sessionMinutes(s, at), 0);
  const first = t.sessions[0]?.start || null;
  const last = t.sessions.at(-1);
  return {
    id: t.id,
    title: t.title,
    url: t.url || null,
    kind: t.kind || null,
    status: t.status,
    started_at: first,
    ended_at: t.status === "done" ? last?.end || null : null,
    active_minutes: Math.round(total),
    active_hours: Math.round((total / 60) * 100) / 100,
    sessions: t.sessions.length,
    running: Boolean(last && !last.end),
    github: t.github ? { pr: t.github.pr || null, comment_count: (t.github.comments || []).length + (t.github.reviews || []).length } : null,
  };
}

function cmdTaskStart() {
  if (!args.id) return fail("task-start requires --id");
  const at = nowDate();
  const w = loadWorklog();
  const t = w.tasks[args.id] || {
    id: args.id,
    title: args.title || args.id,
    url: args.url || null,
    kind: args.kind || null,
    created_at: at.toISOString(),
    sessions: [],
    status: "new",
  };
  if (args.title) t.title = args.title;
  if (args.url) t.url = args.url;
  if (args.kind) t.kind = args.kind;
  const last = t.sessions.at(-1);
  if (last && !last.end) return printJson({ ok: true, started: false, reason: "already_running", task: summarizeTask(t, at) });
  t.sessions.push({ start: at.toISOString(), end: null, note: args.note || null });
  t.status = "running";
  w.tasks[args.id] = t;
  saveWorklog(w);
  printJson({ ok: true, started: true, resumed: t.sessions.length > 1, task: summarizeTask(t, at) });
}

function closeSession(newStatus) {
  if (!args.id) return fail(`task-${newStatus === "done" ? "stop" : "pause"} requires --id`);
  const at = nowDate();
  const w = loadWorklog();
  const t = w.tasks[args.id];
  if (!t) return fail("unknown task in worklog", { id: args.id });
  const last = t.sessions.at(-1);
  const wasRunning = Boolean(last && !last.end);
  if (wasRunning) {
    if (at < new Date(last.start)) return fail("--at is before the session start");
    last.end = at.toISOString();
    if (args.note) last.note = args.note;
  }
  if (newStatus === "paused" && !wasRunning)
    return printJson({ ok: true, changed: false, reason: "not_running", task: summarizeTask(t, at) });
  t.status = newStatus;
  saveWorklog(w);
  printJson({ ok: true, changed: true, task: summarizeTask(t, at) });
}

function stageDurations(id) {
  const entry = loadLedger().tasks[id];
  if (!entry?.stages) return [];
  const done = STAGES.filter((s) => entry.stages[s]?.completed_at).map((s) => ({ stage: s, at: new Date(entry.stages[s].completed_at) }));
  return done.map((d, i) => ({
    stage: d.stage,
    completed_at: d.at.toISOString(),
    minutes_since_previous: i === 0 ? null : Math.round((d.at - done[i - 1].at) / 60000),
  }));
}

function cmdWorklogList() {
  const at = nowDate();
  const tasks = Object.values(loadWorklog().tasks)
    .filter((t) => !args.status || t.status === args.status)
    .map((t) => ({ ...summarizeTask(t, at), stages: stageDurations(t.id) }));
  const total = tasks.reduce((s, t) => s + t.active_minutes, 0);
  printJson({ ok: true, tasks, total_minutes: total, total_hours: Math.round((total / 60) * 100) / 100 });
}

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function cmdWorklogExport() {
  const at = nowDate();
  const format = String(args.format || "md").toLowerCase();
  const w = loadWorklog();
  const rows = Object.values(w.tasks).map((t) => ({ t, s: summarizeTask(t, at) }));
  let out;
  if (format === "csv") {
    const head = ["id", "title", "kind", "status", "started_at", "ended_at", "active_minutes", "sessions", "url", "pr", "github_comments"];
    out = [head.join(",")]
      .concat(rows.map(({ s }) => [s.id, s.title, s.kind, s.status, s.started_at, s.ended_at, s.active_minutes, s.sessions, s.url, s.github?.pr?.url, s.github?.comment_count ?? 0].map(csvCell).join(",")))
      .join("\n");
  } else if (format === "md") {
    const lines = ["# Work log", "", `Generated: ${at.toISOString()}`, "", "| Task | Status | Started (UTC) | Ended (UTC) | Active time | GitHub |", "|---|---|---|---|---|---|"];
    for (const { s } of rows) {
      const h = Math.floor(s.active_minutes / 60);
      const m = s.active_minutes % 60;
      const name = s.url ? `[${s.title.replace(/\|/g, "\\|")}](${s.url})` : s.title.replace(/\|/g, "\\|");
      const gh = s.github?.pr ? `[PR #${s.github.pr.number}](${s.github.pr.url}) · ${s.github.comment_count} comments` : "";
      lines.push(`| ${name} | ${s.status} | ${s.started_at || ""} | ${s.ended_at || ""} | ${h}h ${m}m | ${gh} |`);
    }
    for (const { t } of rows) {
      const comments = [...(t.github?.reviews || []), ...(t.github?.comments || [])];
      if (!comments.length) continue;
      lines.push("", `## ${t.title} — GitHub comments`, "");
      for (const c of comments) lines.push(`- **${c.author}** (${c.created_at || ""}${c.state ? `, ${c.state}` : ""}): ${String(c.body || "").replace(/\s+/g, " ")}`);
    }
    out = lines.join("\n");
  } else {
    return fail("--format must be csv or md");
  }
  if (args.out) {
    atomicWrite(String(args.out), out + "\n");
    return printJson({ ok: true, written: String(args.out), format, tasks: rows.length });
  }
  printJson({ ok: true, format, content: out });
}

function normalizeGh(raw) {
  const author = (a) => (typeof a === "string" ? a : a?.login || a?.name || "unknown");
  return {
    pr: raw.number ? { number: raw.number, url: raw.url || null, title: raw.title || null, state: raw.state || null } : null,
    comments: (raw.comments || []).map((c) => ({ author: author(c.author), created_at: c.createdAt || c.created_at || null, body: truncate(c.body, 500), url: c.url || null })),
    reviews: (raw.reviews || [])
      .filter((r) => r.body || r.state)
      .map((r) => ({ author: author(r.author), created_at: r.submittedAt || r.submitted_at || null, state: r.state || null, body: truncate(r.body, 500) })),
  };
}

function cmdWorklogGithub() {
  if (!args.id) return fail("worklog-github requires --id");
  let raw;
  if (jsonArg(args)) {
    const parsed = parseJsonArg(args, "worklog-github");
    if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
    raw = parsed.value;
  } else {
    const branch = args.branch || loadLedger().tasks[args.id]?.branch;
    if (!branch) return fail("no branch known for this task; pass --branch or --json-file");
    try {
      const out = execFileSync("gh", ["pr", "view", String(branch), "--json", "number,url,title,state,comments,reviews"], {
        encoding: "utf8",
        cwd: args.repo ? String(args.repo) : process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      });
      raw = JSON.parse(out);
    } catch (e) {
      if (e.code === "ENOENT") return fail("gh_not_installed", { hint: "Install GitHub CLI (https://cli.github.com) and run `gh auth login`, or pass --json-file." });
      const msg = String(e.stderr || e.message || e).trim().split("\n")[0];
      return fail("gh_failed", { detail: truncate(msg, 300) });
    }
  }
  const gh = { ...normalizeGh(raw), fetched_at: new Date().toISOString() };
  const w = loadWorklog();
  const t = w.tasks[args.id];
  if (!t) return fail("unknown task in worklog; run task-start first", { id: args.id });
  t.github = gh;
  saveWorklog(w);
  printJson({ ok: true, id: args.id, github: gh });
}

// ---- alerts: stuck work and problems -------------------------------------------------

function loadAlerts() {
  return readJsonSafe(ALERTS_PATH, { version: 1, active: {} });
}

function detectAlerts(at) {
  const cfg = config().alerts || {};
  const stuckMinutes = Number(args["stuck-minutes"] ?? cfg.stuck_minutes ?? 60);
  const timerHours = Number(args["long-timer-hours"] ?? cfg.long_timer_hours ?? 8);
  const maxRepairs = Number(args["max-repair-rounds"] ?? cfg.max_repair_rounds ?? 2);
  const found = [];

  // 1) A task lock that has not been refreshed: no stage finished for too long.
  if (fs.existsSync(STATE_DIR)) {
    for (const f of fs.readdirSync(STATE_DIR)) {
      if (!/^task-.*\.lock\.json$/.test(f)) continue;
      let lock;
      try {
        lock = JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf8"));
      } catch {
        continue;
      }
      const age = (at.getTime() - new Date(lock.acquired_at).getTime()) / 60000;
      if (age >= stuckMinutes) {
        const id = f.replace(/^task-/, "").replace(/\.lock\.json$/, "");
        found.push({
          key: `STUCK:${id}:${lock.run_id}`,
          kind: "STUCK",
          id,
          message: `Task ${id} has made no progress for ${Math.round(age)} min (run ${lock.run_id}).`,
        });
      }
    }
  }

  // 2) Ledger problems: BLOCKED, or repairs used up.
  for (const [id, t] of Object.entries(loadLedger().tasks)) {
    const name = t.card_name || id;
    if (String(t.status || "").toUpperCase() === "BLOCKED") {
      const reason = t.blocked_reason || "no reason saved";
      found.push({ key: `BLOCKED:${id}:${crypto.createHash("sha256").update(reason).digest("hex").slice(0, 8)}`, kind: "BLOCKED", id, message: `${name} is BLOCKED: ${reason}` });
    }
    if (Number(t.repair_rounds || 0) >= maxRepairs && String(t.status || "").toUpperCase() !== "READY_FOR_REVIEW") {
      found.push({ key: `REPAIR_LIMIT:${id}:${t.repair_rounds}`, kind: "REPAIR_LIMIT", id, message: `${name} used all ${maxRepairs} repair rounds. A person must decide the next step.` });
    }
  }

  // 3) Last watcher poll failed.
  const last = loadLedger().polls.at(-1);
  if (last && last.status !== "ok") {
    found.push({ key: `WATCHER:${last.run_id}`, kind: "WATCHER_FAILED", id: null, message: `Task watcher failed: ${last.reason || last.status}` });
  }

  // 4) A worklog timer running for too long (forgotten pause).
  for (const t of Object.values(loadWorklog().tasks)) {
    const s = t.sessions.at(-1);
    if (s && !s.end && sessionMinutes(s, at) >= timerHours * 60) {
      found.push({ key: `TIMER:${t.id}:${s.start}`, kind: "TIMER_RUNNING", id: t.id, message: `Timer for "${t.title}" has run for ${Math.round(sessionMinutes(s, at) / 60)} h. Did you forget to pause it?` });
    }
  }
  return found;
}

function cmdAlertCheck() {
  const at = nowDate();
  const store = loadAlerts();
  const found = detectAlerts(at);
  const foundKeys = new Set(found.map((a) => a.key));
  const resolved = Object.keys(store.active).filter((k) => !foundKeys.has(k));
  for (const k of resolved) delete store.active[k];
  const fresh = [];
  for (const a of found) {
    if (!store.active[a.key]) {
      store.active[a.key] = { ...a, first_seen: at.toISOString(), notified_at: at.toISOString(), acked: false };
      fresh.push(a);
    }
  }
  ensureStateDir();
  atomicWrite(ALERTS_PATH, JSON.stringify(store, null, 2));
  const message = fresh.length === 0 ? "" : fresh.length === 1 ? fresh[0].message : `${fresh.length} alerts: ${fresh.map((a) => a.message).join(" | ")}`;
  printJson({
    ok: true,
    notify: fresh.length > 0,
    message: truncate(message, 190),
    new_alerts: fresh,
    active_count: Object.keys(store.active).length,
    resolved,
  });
}

function cmdAlertList() {
  printJson({ ok: true, alerts: Object.values(loadAlerts().active) });
}

function cmdAlertAck() {
  if (!args.key) return fail("alert-ack requires --key");
  const store = loadAlerts();
  if (!store.active[args.key]) return fail("unknown alert key", { key: args.key });
  store.active[args.key].acked = true;
  atomicWrite(ALERTS_PATH, JSON.stringify(store, null, 2));
  printJson({ ok: true, alert: store.active[args.key] });
}

// ---- v0.2: pipeline helpers ---------------------------------------------------------

function cmdRouteTask() {
  const parsed = jsonArg(args) ? parseJsonArg(args, "route-task") : { value: {} };
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const input = { ...parsed.value };
  if (args.size) input.size = args.size;
  const result = routeTask(input);
  if (args.id) {
    withWriteLock(() => {
      const ledger = loadLedger();
      ledger.tasks[args.id] = { ...(ledger.tasks[args.id] || {}), routing: { size: result.size, models: result.models, at: new Date().toISOString() }, updated_at: new Date().toISOString() };
      saveLedger(ledger);
    });
  }
  printJson(result);
}

function cmdPromptScore() {
  let text;
  if (args.text) text = String(args.text);
  else {
    const parsed = parseJsonArg(args, "prompt-score");
    if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
    text = typeof parsed.value === "string" ? parsed.value : parsed.value.text;
  }
  printJson(scorePrompt(text));
}

// Creates the run folder for one task run, outside the repository.
function cmdRunInit() {
  if (!args.id) return fail("run-init requires --id");
  const runId = String(args["run-id"] || utcRunId("run"));
  const dir = path.join(STATE_DIR, "runs", runId.replace(/[^a-zA-Z0-9._-]/g, "_"));
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  const ledger = loadLedger();
  const entry = ledger.tasks[args.id] || {};
  ledger.tasks[args.id] = { ...entry, run_id: runId, run_dir: dir, updated_at: new Date().toISOString() };
  saveLedger(ledger);
  printJson({ ok: true, id: args.id, run_id: runId, run_dir: dir, packet_path: path.join(dir, "task-packet.md"), evidence_dir: path.join(dir, "evidence"), previous_run_id: entry.run_id || null });
}

// Change identity = SHA-256 over the diff against a base (default HEAD) plus every
// untracked, non-ignored file's path and content hash. Read-only git commands only.
function cmdDiffIdentity() {
  const repo = path.resolve(String(args.repo || process.cwd()));
  const base = String(args.base || "HEAD");
  const git = (...a) => execFileSync("git", a, { cwd: repo, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  let diff;
  let untracked;
  let branch;
  let baseCommit;
  try {
    diff = git("diff", "--binary", "--no-ext-diff", base);
    untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean).sort();
    branch = git("rev-parse", "--abbrev-ref", "HEAD").toString("utf8").trim();
    baseCommit = git("rev-parse", base).toString("utf8").trim();
  } catch (e) {
    return fail("git_failed", { detail: truncate(String(e.stderr || e.message || e).split("\n")[0], 300) });
  }
  const manifest = untracked.map((f) => {
    let h = "unreadable";
    try {
      h = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, f))).digest("hex");
    } catch {
      // deleted between listing and reading; keep the marker so the identity still changes
    }
    return `${f}\t${h}`;
  });
  const hash = crypto.createHash("sha256").update(diff).update("\n--untracked--\n").update(manifest.join("\n")).digest("hex");
  const changedFiles = git("diff", "--name-only", base).toString("utf8").split("\n").filter(Boolean);
  let saved = null;
  if (args.save) {
    const dir = path.resolve(String(args.save));
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(path.join(dir, `diff-${hash.slice(0, 12)}.patch`), diff.toString("utf8"));
    atomicWrite(path.join(dir, `untracked-${hash.slice(0, 12)}.txt`), manifest.join("\n") + "\n");
    saved = dir;
  }
  printJson({
    ok: true,
    change_identity: hash,
    short: hash.slice(0, 12),
    base,
    base_commit: baseCommit,
    branch,
    changed_files: changedFiles,
    untracked_files: untracked,
    empty: diff.length === 0 && untracked.length === 0,
    saved_to: saved,
  });
}

const FINAL_STATUSES = new Set([
  "READY_FOR_IMPLEMENTATION", "NEEDS_CLARIFICATION", "NEEDS_BRANCH_DECISION", "CHANGES_REQUIRED", "READY_FOR_REVIEW",
  "AWAITING_DEPLOYMENT", "BLOCKED", "IN_PROGRESS", "INTAKE_DONE",
]);

function cmdTaskStatus() {
  if (!args.id || !args.status) return fail("task-status requires --id and --status");
  const status = String(args.status).toUpperCase();
  if (!FINAL_STATUSES.has(status)) return fail("unknown status", { allowed: [...FINAL_STATUSES] });
  const ledger = loadLedger();
  const entry = ledger.tasks[args.id] || {};
  const patch = { status, status_at: new Date().toISOString() };
  if (status === "BLOCKED") patch.blocked_reason = args.reason ? String(args.reason) : entry.blocked_reason || "no reason saved";
  else patch.blocked_reason = null;
  ledger.tasks[args.id] = { ...entry, ...patch, updated_at: new Date().toISOString() };
  saveLedger(ledger);
  printJson({ ok: true, id: args.id, ...patch });
}

// ---- v0.3: audit history ------------------------------------------------------------

const AUDIT_KINDS = new Set(["security", "accessibility", "performance", "ui-test", "ux", "architecture", "market"]);

function cmdAuditRecord() {
  const kind = String(args.kind || "");
  if (!AUDIT_KINDS.has(kind)) return fail("audit-record requires --kind", { kinds: [...AUDIT_KINDS] });
  const parsed = parseJsonArg(args, "audit-record");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const input = parsed.value;
  if (!input.target) return fail("audit-record input needs a target");
  const scored = kind === "market" ? { score: null, verdict: input.verdict || "REPORT", coverage: null, counts: null } : scoreAudit(input);
  const store = readJsonSafe(AUDITS_PATH, { version: 1, runs: [] });
  const previous = [...store.runs].reverse().find((r) => r.kind === kind && r.target === input.target) || null;
  const record = {
    id: utcRunId(`audit-${kind}`, nowDate()),
    kind,
    target: input.target,
    at: nowDate().toISOString(),
    ...scored,
    criteria: input.criteria || [],
    findings: (input.findings || []).map((f) => ({ id: f.id, title: f.title, severity: f.severity, location: f.location || null, fix: f.fix || null })),
    report_path: input.report_path || null,
  };
  store.runs.push(record);
  store.runs = store.runs.slice(-200);
  ensureStateDir();
  atomicWrite(AUDITS_PATH, JSON.stringify(store, null, 2));
  let comparison = null;
  if (previous) {
    const prevIds = new Set(previous.findings.map((f) => f.id));
    const nowIds = new Set(record.findings.map((f) => f.id));
    comparison = {
      previous_id: previous.id,
      previous_at: previous.at,
      score_before: previous.score,
      score_after: record.score,
      verdict_before: previous.verdict,
      fixed: previous.findings.filter((f) => !nowIds.has(f.id)).map((f) => ({ id: f.id, severity: f.severity })),
      new: record.findings.filter((f) => !prevIds.has(f.id)).map((f) => ({ id: f.id, severity: f.severity })),
    };
  }
  printJson({ ok: true, record, comparison });
}

// Input: an array of perf-probe results (one per run), or {runs:[…], action_ms, action_budget_ms}.
function cmdPerfScore() {
  const parsed = parseJsonArg(args, "perf-score");
  if (parsed.error) return fail(parsed.error, { detail: parsed.detail });
  const v = parsed.value;
  const runs = Array.isArray(v) ? v : v.runs || [];
  if (!runs.length) return fail("perf-score needs at least one probe result");
  printJson({ ok: true, ...scorePerf(runs, { action_ms: v.action_ms ?? null, action_budget_ms: v.action_budget_ms ?? 1000 }) });
}

function cmdAuditList() {
  const store = readJsonSafe(AUDITS_PATH, { version: 1, runs: [] });
  const runs = store.runs
    .filter((r) => (!args.kind || r.kind === args.kind) && (!args.target || r.target === args.target))
    .slice(-Number(args.limit || 20))
    .map(({ criteria, findings, ...rest }) => ({ ...rest, findings: findings.length }));
  printJson({ ok: true, runs });
}

function cmdRepairRound() {
  if (!args.id) return fail("repair-round requires --id");
  const max = Number(args.max ?? config().alerts?.max_repair_rounds ?? 2);
  const ledger = loadLedger();
  const entry = ledger.tasks[args.id] || {};
  const used = Number(entry.repair_rounds || 0);
  if (used >= max) return printJson({ ok: true, allowed: false, reason: "max_repair_rounds_reached", repair_rounds: used, max });
  ledger.tasks[args.id] = { ...entry, repair_rounds: used + 1, updated_at: new Date().toISOString() };
  saveLedger(ledger);
  printJson({ ok: true, allowed: true, repair_rounds: used + 1, max, remaining: max - used - 1 });
}

// ---- main -------------------------------------------------------------------------

const COMMANDS = {
  "audit-record": () => withWriteLock(cmdAuditRecord),
  "audit-list": cmdAuditList,
  "perf-score": cmdPerfScore,
  "route-task": cmdRouteTask,
  "prompt-score": cmdPromptScore,
  "run-init": () => withWriteLock(cmdRunInit),
  "diff-identity": cmdDiffIdentity,
  "task-status": () => withWriteLock(cmdTaskStatus),
  "repair-round": () => withWriteLock(cmdRepairRound),
  paths: cmdPaths,
  "run-id": cmdRunId,
  "config-get": cmdConfigGet,
  "config-set": cmdConfigSet,
  window: cmdWindow,
  "lock-acquire": cmdLockAcquire,
  "lock-release": cmdLockRelease,
  "lock-refresh": cmdLockRefresh,
  "lock-status": cmdLockStatus,
  "card-check": cmdCardCheck,
  "card-upsert": () => withWriteLock(cmdCardUpsert),
  "card-assess": cmdCardAssess,
  "task-get": cmdTaskGet,
  "stage-done": () => withWriteLock(cmdStageDone),
  "task-resume": cmdTaskResume,
  "action-begin": () => withWriteLock(cmdActionBegin),
  "action-resolve": () => withWriteLock(cmdActionResolve),
  fingerprint: cmdFingerprint,
  "report-line": cmdReportLine,
  "poll-record": () => withWriteLock(cmdPollRecord),
  "poll-last": cmdPollLast,
  "watch-ingest": () => withWriteLock(cmdWatchIngest),
  "watcher-status": cmdWatcherStatus,
  "cards-list": cmdCardsList,
  "notify-history": cmdNotifyHistory,
  "task-start": () => withWriteLock(cmdTaskStart),
  "task-pause": () => withWriteLock(() => closeSession("paused")),
  "task-stop": () => withWriteLock(() => closeSession("done")),
  "worklog-list": cmdWorklogList,
  "worklog-export": cmdWorklogExport,
  "worklog-github": () => withWriteLock(cmdWorklogGithub),
  "alert-check": () => withWriteLock(cmdAlertCheck),
  "alert-list": cmdAlertList,
  "alert-ack": () => withWriteLock(cmdAlertAck),
};

const handler = COMMANDS[command];
if (!handler) {
  fail("unknown command", { commands: Object.keys(COMMANDS) });
} else {
  try {
    handler();
  } catch (e) {
    fail("command failed", { command, detail: String(e.message || e) });
  }
}
