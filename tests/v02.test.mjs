// v0.2 tests: stack detection, model routing, prompt score, branch guard (lib + real hook
// process), pipeline state commands. Throwaway folders and git repos only.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeCommand } from "../scripts/lib/branch-guard.mjs";
import { scorePrompt } from "../scripts/lib/prompt-score.mjs";
import { routeTask, sizeTask } from "../scripts/lib/routing.mjs";
import { detectStack } from "../scripts/lib/stack.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, "scripts", "state.mjs");
const HOOK = path.join(ROOT, "hooks", "branch-guard.mjs");
let tmp;
let stateDir;

function write(rel, content) {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
}

function run(...args) {
  const r = spawnSync(process.execPath, [STATE, ...args], { env: { ...process.env, ENGOPS_STATE_DIR: stateDir }, encoding: "utf8" });
  return JSON.parse(r.stdout);
}

function git(cwd, ...a) {
  return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engops-v02-"));
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "engops-v02-state-"));
});

describe("detect-stack (#9)", () => {
  it("React + Vite pnpm monorepo: frontend, workspace packages, pnpm commands, route dirs", () => {
    write("package.json", { name: "root", scripts: { test: "vitest", lint: "eslint .", "type-check": "tsc -b", build: "turbo build", dev: "turbo dev", "test:e2e": "playwright test" }, devDependencies: { typescript: "5" } });
    write("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    write("pnpm-lock.yaml", "");
    write("apps/web/package.json", { name: "web", dependencies: { react: "19", vite: "6" }, devDependencies: { vitest: "3" } });
    write("apps/web/src/app/routes/index.tsx", "");
    write("packages/ui/package.json", { name: "ui" });
    const s = detectStack(tmp);
    assert.deepEqual(s.kinds, ["frontend"]);
    assert.deepEqual(s.frontend.sort(), ["React", "Vite"]);
    assert.equal(s.package_manager, "pnpm");
    assert.deepEqual(s.monorepo.packages.map((p) => p.path).sort(), ["apps/web", "packages/ui"]);
    assert.equal(s.validation_commands.unit, "pnpm test");
    assert.equal(s.validation_commands.typecheck, "pnpm type-check");
    assert.equal(s.validation_commands.e2e, "pnpm test:e2e");
    assert.ok(s.entry_dirs.includes("apps/web/src/app/routes"));
    assert.ok(s.test_tools.includes("Vitest"));
  });

  it("Next.js with yarn; the npm-init placeholder test script is ignored", () => {
    write("package.json", { scripts: { test: 'echo "Error: no test specified" && exit 1', lint: "next lint", build: "next build", dev: "next dev" }, dependencies: { next: "15", react: "19" } });
    write("yarn.lock", "");
    write("src/app/page.tsx", "");
    const s = detectStack(tmp);
    assert.deepEqual(s.frontend.sort(), ["Next.js", "React"]);
    assert.equal(s.validation_commands.unit, null);
    assert.equal(s.validation_commands.lint, "yarn lint");
    assert.ok(s.notes.some((n) => /Next\.js/.test(n)));
  });

  it("Express + Prisma backend with npm", () => {
    write("package.json", { scripts: { test: "jest", start: "node server.js" }, dependencies: { express: "4", "@prisma/client": "5" }, devDependencies: { jest: "29" } });
    write("package-lock.json", "{}");
    write("src/routes/orders.js", "");
    const s = detectStack(tmp);
    assert.deepEqual(s.kinds, ["backend"]);
    assert.ok(s.backend.includes("Express") && s.backend.includes("Prisma"));
    assert.equal(s.validation_commands.unit, "npm test");
    assert.equal(s.validation_commands.dev, "npm run start");
  });

  it("Django with pytest and ruff", () => {
    write("requirements.txt", "Django==5.0\npytest\nruff\n");
    write("manage.py", "");
    const s = detectStack(tmp);
    assert.deepEqual(s.kinds, ["backend"]);
    assert.ok(s.backend.includes("Django"));
    assert.equal(s.validation_commands.unit, "pytest");
    assert.equal(s.validation_commands.lint, "ruff check .");
  });

  it("NetSuite SuiteCloud SDF project", () => {
    write("suitecloud.config.js", "module.exports = {};");
    write("src/manifest.xml", '<manifest projecttype="ACCOUNTCUSTOMIZATION"></manifest>');
    write("src/FileCabinet/SuiteScripts/ue_order.js", "/** @NApiVersion 2.1 @NScriptType UserEventScript */");
    write("package.json", { scripts: { test: "jest" }, devDependencies: { "@oracle/suitecloud-unit-testing": "1", jest: "29" } });
    const s = detectStack(tmp);
    assert.ok(s.kinds.includes("netsuite"));
    assert.equal(s.netsuite.project_type, "ACCOUNTCUSTOMIZATION");
    assert.equal(s.validation_commands.validate, "suitecloud project:validate");
    assert.ok(s.entry_dirs.includes("src/FileCabinet/SuiteScripts"));
    assert.ok(s.notes.some((n) => /never deploy/.test(n)));
  });

  it("no manifest at the root: finds client/ and server/ sub-projects", () => {
    write("client/package.json", { scripts: { build: "vite build" }, dependencies: { react: "19" } });
    write("server/package.json", { scripts: { test: "jest" }, dependencies: { express: "4" } });
    write("docs/readme.md", "x");
    const s = detectStack(tmp);
    assert.deepEqual(s.kinds.sort(), ["backend", "frontend"]);
    assert.deepEqual(s.subprojects.map((p) => p.dir).sort(), ["client", "server"]);
    assert.equal(s.subprojects.find((p) => p.dir === "server").validation_commands.unit, "npm test");
  });

  it("an empty folder reports nothing instead of guessing", () => {
    const s = detectStack(tmp);
    assert.deepEqual(s.kinds, []);
    assert.equal(s.validation_commands.unit, null);
  });
});

describe("model routing (#6)", () => {
  it("small clear bug: haiku for cheap stages, sonnet for code, no approval", () => {
    const r = routeTask({ type: "BUG", estimated_files: 1, ambiguity: "low" });
    assert.equal(r.size, "S");
    assert.equal(r.models["3_analysis"], "haiku");
    assert.equal(r.models["6_implementation"], "sonnet");
    assert.equal(r.models["7_checks_postcheck"], "haiku");
    assert.equal(r.approval_required, false);
  });

  it("medium task uses sonnet for analysis and review", () => {
    const r = routeTask({ estimated_files: 4, ambiguity: "medium" });
    assert.equal(r.size, "M");
    assert.equal(r.models["3_analysis"], "sonnet");
    assert.equal(r.models["8_final_review"], "sonnet");
  });

  it("XL never silently uses a premium model; approval switches only that stage", () => {
    const input = { estimated_files: 30, ambiguity: "high", cross_layer: true, migration: true };
    const r = routeTask(input);
    assert.equal(r.size, "XL");
    assert.equal(r.approval_required, true);
    assert.equal(r.models["3_analysis"], "sonnet");
    assert.equal(r.split_recommended, true);
    const ok = routeTask({ ...input, premium_approved_stages: ["3_analysis"] });
    assert.equal(ok.models["3_analysis"], "opus");
    assert.equal(ok.models["6_implementation"], "sonnet");
    assert.equal(ok.approval_required, false);
  });

  it("repeated failures propose a stronger model, with approval", () => {
    const r = routeTask({ estimated_files: 2, failed_diagnoses: 2, repair_rounds: 2 });
    const stages = r.premium_proposals.map((p) => p.stage).sort();
    assert.deepEqual(stages, ["3_analysis", "6_implementation"]);
    assert.ok(r.premium_proposals.every((p) => p.approval_required));
  });

  it("unknown file count is treated as medium, with a reason", () => {
    const s = sizeTask({});
    assert.equal(s.size, "M");
    assert.ok(s.reasons.some((x) => /unknown/.test(x)));
  });

  it("route-task --id saves the routing in the ledger", () => {
    fs.writeFileSync(path.join(stateDir, "r.json"), JSON.stringify({ estimated_files: 1 }));
    run("route-task", "--id", "t1", "--json-file", path.join(stateDir, "r.json"));
    assert.equal(run("task-get", "--id", "t1").entry.routing.size, "S");
  });
});

describe("prompt score (#7)", () => {
  it("a vague request needs the refiner", () => {
    const r = scorePrompt("fix the filter");
    assert.equal(r.run_refiner, true);
    assert.equal(r.verdict, "NEEDS_IMPROVEMENT");
    assert.ok(r.missing.includes("Constraints (limits / rules)"));
  });

  it("a complete request skips the refiner (no token cost)", () => {
    const r = scorePrompt("Fix the Open status filter on the tasks page (src/features/tasks/TaskFilters.tsx). It must not change the API. Expected: only open tasks show and the existing tests pass. Give me a short plan and the diff.");
    assert.ok(r.score >= 8, `score ${r.score}`);
    assert.equal(r.run_refiner, false);
  });

  it("understands Arabic requests", () => {
    const r = scorePrompt("عايز اصلاح الفلتر في صفحة الطلبات بدون تغيير الـ API، المتوقع يظهر المفتوح بس، واعمل تقرير بالخطوات");
    assert.ok(r.score >= 6, `score ${r.score}`);
  });

  it("CLI accepts --text and JSON input", () => {
    assert.equal(run("prompt-score", "--text", "fix it").run_refiner, true);
    fs.writeFileSync(path.join(stateDir, "p.json"), JSON.stringify({ text: "fix it" }));
    assert.equal(run("prompt-score", "--json-file", path.join(stateDir, "p.json")).score <= 3, true);
  });
});

describe("branch guard", () => {
  const policy = { guard_enabled: true, base_ref: "origin/main", protected_branches: ["main", "master"], protected_patterns: ["release/*"], integration_branches: ["develop"] };
  const check = (cmd, branch = "feature/x") => analyzeCommand(cmd, { policy, branch, branchAt: () => branch });

  it("blocks taking code from the integration branch on a task branch", () => {
    for (const cmd of ["git merge develop", "git pull origin develop", "git rebase origin/develop", "git cherry-pick develop~2", "git checkout develop -- src/a.ts", "git restore --source=develop src/a.ts", "git switch -c feature/y origin/develop", "git branch -u origin/develop"]) {
      assert.equal(check(cmd).blocked, true, cmd);
    }
  });

  it("allows reading, updating the integration branch itself, and merging INTO it", () => {
    for (const cmd of ["git log develop", "git diff origin/develop", "git fetch origin develop", "git merge origin/main", "git switch -c feature/y origin/main"]) {
      assert.equal(check(cmd).blocked, false, cmd);
    }
    assert.equal(check("git merge feature/x", "develop").blocked, false);
    assert.equal(check("git checkout develop && git merge feature/x").blocked, false);
  });

  it("tracks branch switches inside one command", () => {
    assert.equal(check("git checkout develop && git pull && git checkout feature/x && git merge develop").blocked, true);
  });

  it("ignores a commit message that only mentions develop (heredoc)", () => {
    const cmd = "git commit -F - <<'EOF'\nfix: do not git merge develop here\nEOF";
    assert.equal(check(cmd).blocked, false);
  });

  it("blocks commits on protected branches and patterns, unless turned off", () => {
    assert.equal(check("git commit -m x", "main").blocked, true);
    assert.equal(check("git commit -m x", "release/2.1").blocked, true);
    assert.equal(check("git commit -m x", "feature/x").blocked, false);
    assert.equal(analyzeCommand("git commit -m x", { policy: { ...policy, block_commit_on_protected: false }, branch: "main" }).blocked, false);
  });

  it("with no integration branches configured, only the commit rule applies", () => {
    const r = analyzeCommand("git merge develop", { policy: { guard_enabled: true, protected_branches: ["main"] }, branch: "feature/x" });
    assert.equal(r.blocked, false);
  });

  it("real hook process: opt-in, exit 2 with a message when blocked, 0 otherwise", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "engops-hook-"));
    git(repo, "init", "-q", "-b", "feature/x");
    const hook = (command, env) =>
      spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: repo }), encoding: "utf8", env: { ...process.env, ENGOPS_STATE_DIR: stateDir, ...env } });

    assert.equal(hook("git merge develop").status, 0, "no config: guard is off");
    fs.writeFileSync(path.join(stateDir, "config.json"), JSON.stringify({ workflow: { branch_policy: policy } }));
    const blocked = hook("git merge develop");
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /Blocked by the Engineering Ops branch guard/);
    assert.equal(hook("git status").status, 0);
    assert.equal(hook("ls -la").status, 0);
    fs.writeFileSync(path.join(stateDir, "config.json"), JSON.stringify({ workflow: { branch_policy: { ...policy, guard_enabled: false } } }));
    assert.equal(hook("git merge develop").status, 0, "disabled again");
    const broken = spawnSync(process.execPath, [HOOK], { input: "{not json", encoding: "utf8" });
    assert.equal(broken.status, 0, "a broken payload never blocks the shell");
  });
});

describe("pipeline state commands", () => {
  it("diff-identity: stable for the same change, changes on edits and new files", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "engops-diff-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "init");

    const clean = run("diff-identity", "--repo", repo);
    assert.equal(clean.empty, true);
    fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
    const d1 = run("diff-identity", "--repo", repo);
    assert.equal(d1.empty, false);
    assert.deepEqual(d1.changed_files, ["a.txt"]);
    assert.equal(run("diff-identity", "--repo", repo).change_identity, d1.change_identity, "same change, same identity");
    fs.writeFileSync(path.join(repo, "new.txt"), "x");
    const d2 = run("diff-identity", "--repo", repo, "--save", path.join(stateDir, "ev"));
    assert.notEqual(d2.change_identity, d1.change_identity, "an untracked file changes the identity");
    assert.deepEqual(d2.untracked_files, ["new.txt"]);
    assert.ok(fs.readdirSync(path.join(stateDir, "ev")).some((f) => f.endsWith(".patch")));
    fs.writeFileSync(path.join(repo, "new.txt"), "y");
    assert.notEqual(run("diff-identity", "--repo", repo).change_identity, d2.change_identity, "editing an untracked file changes it too");
    assert.equal(run("diff-identity", "--repo", tmp).ok, false, "not a git repo -> clear error");
  });

  it("run-init creates the run folder outside the repo and records it", () => {
    const r = run("run-init", "--id", "t1", "--run-id", "run-20261108T080000Z");
    assert.ok(r.run_dir.startsWith(stateDir));
    assert.ok(fs.existsSync(r.evidence_dir));
    assert.equal(run("task-get", "--id", "t1").entry.run_id, "run-20261108T080000Z");
  });

  it("task-status feeds alerts; repair-round enforces the limit", () => {
    assert.equal(run("task-status", "--id", "t1", "--status", "nonsense").ok, false);
    run("task-status", "--id", "t1", "--status", "blocked", "--reason", "needs test login");
    assert.equal(run("alert-check").new_alerts[0].kind, "BLOCKED");
    run("task-status", "--id", "t1", "--status", "IN_PROGRESS");
    assert.equal(run("alert-check").active_count, 0, "alert resolves when status changes");
    assert.equal(run("repair-round", "--id", "t1", "--max", "2").remaining, 1);
    assert.equal(run("repair-round", "--id", "t1", "--max", "2").remaining, 0);
    const third = run("repair-round", "--id", "t1", "--max", "2");
    assert.equal(third.allowed, false);
    assert.equal(third.reason, "max_repair_rounds_reached");
  });

  it("stage-done records planned and actual model separately", () => {
    run("stage-done", "--id", "t1", "--stage", "3_analysis", "--fingerprint", "f", "--model-planned", "sonnet");
    const rec = run("task-get", "--id", "t1").entry.stages["3_analysis"];
    assert.equal(rec.model_planned, "sonnet");
    assert.equal(rec.model_actual, null);
  });
});
