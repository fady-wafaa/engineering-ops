// File walker + rule runner for the static scan. Read-only. Never prints secret values.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { A11Y_RULES, SECURITY_RULES } from "./scan-rules.mjs";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", "coverage", "vendor",
  ".venv", "venv", "__pycache__", "target", "bin", "obj", ".idea", ".vscode", "storybook-static", ".cache", ".parcel-cache",
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 20000;
const MAX_HITS_PER_RULE = 50;

function extOf(file) {
  const base = path.basename(file).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base.startsWith(".env")) return "env";
  return base.includes(".") ? base.split(".").pop() : "";
}

export function walk(root, { maxFiles = MAX_FILES } = {}) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (/\.min\.(js|css)$/i.test(e.name) || /(^|\.)lock$|-lock\.(json|yaml)$|\.lock(b)?$|\.map$/i.test(e.name)) continue;
        files.push(full);
      }
    }
  }
  return files;
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function redact(text) {
  return text
    .replace(/(["'])[^"'\s]{8,}\1/g, (m, q) => `${q}***REDACTED***${q}`)
    .replace(/(AKIA)[0-9A-Z]{16}/g, "$1***REDACTED***")
    .replace(/(gh[pousr]_|github_pat_|sk_live_|xox[baprs]-|AIza)[A-Za-z0-9_-]+/g, "$1***REDACTED***")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, "-----BEGIN PRIVATE KEY----- ***REDACTED***");
}

const PLACEHOLDER = /(process\.env|os\.environ|getenv|import\.meta\.env|\$\{|example|changeme|change_me|placeholder|your[_-]?|xxx+|\*\*\*|<[^>]+>|dummy|sample|redacted|fake|mock)/i;
const TEST_FILE = /(\.|_|\/)(test|spec|stories|fixture|mock)s?(\.|\/|_)|__tests__|__mocks__|\/fixtures?\//i;

export function scanFiles(root, rules, { includeTests = false } = {}) {
  const hits = [];
  const perRule = new Map();
  const files = walk(root);
  let scanned = 0;
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const ext = extOf(file);
    const applicable = rules.filter((r) => r.exts.includes(ext));
    if (!applicable.length) continue;
    const isTest = TEST_FILE.test("/" + rel);
    if (isTest && !includeTests) continue;
    let content;
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    scanned++;
    for (const rule of applicable) {
      if ((perRule.get(rule.id) || 0) >= MAX_HITS_PER_RULE) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(content))) {
        if (m[0].length === 0) {
          rule.re.lastIndex++;
          continue;
        }
        if (rule.secret && PLACEHOLDER.test(m[0])) continue;
        const line = lineOf(content, m.index);
        const lineText = content.split("\n")[line - 1] || "";
        // Code comments and doc blocks are not executed: skip ("* <Input …/>" examples, "// TODO").
        // The security-todo rule is the exception: it exists to find comments.
        if (rule.id !== "security-todo" && /^\s*(\*|\/\/|\/\*|#(?!!)|<!--|--)/.test(lineText) && ext !== "env") continue;
        if (rule.validate && !rule.validate(m[0], lineText)) continue;
        const snippet = (rule.secret ? redact(lineText) : lineText).trim().slice(0, 200);
        hits.push({ rule: rule.id, category: rule.category || null, wcag: rule.wcag || null, severity_hint: rule.severity, title: rule.title, file: rel, line, snippet, fix_hint: rule.fix });
        perRule.set(rule.id, (perRule.get(rule.id) || 0) + 1);
        if (perRule.get(rule.id) >= MAX_HITS_PER_RULE) break;
      }
    }
  }
  const capped = [...perRule.entries()].filter(([, n]) => n >= MAX_HITS_PER_RULE).map(([id]) => id);
  return { hits, files_scanned: scanned, files_seen: files.length, capped_rules: capped };
}

// Project-level supply-chain and secret-hygiene checks (A02/A03/A04). Read-only.
export function projectChecks(root) {
  const checks = [];
  const has = (f) => fs.existsSync(path.join(root, f));
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      checks.push({ rule: "package-json-invalid", category: "A03", severity_hint: "Low", title: "package.json is not valid JSON", file: "package.json" });
    }
    if (!["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "npm-shrinkwrap.json"].some(has)) {
      checks.push({ rule: "no-lockfile", category: "A03", severity_hint: "High", title: "No lockfile: installs are not reproducible", file: "package.json", fix_hint: "Commit the package manager's lockfile and use `npm ci` / `pnpm install --frozen-lockfile` in CI." });
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const loose = Object.entries(deps).filter(([, v]) => /^(\*|latest|x|)$/.test(String(v).trim()) || /^(git|https?):/.test(String(v)));
    if (loose.length) checks.push({ rule: "unpinned-deps", category: "A03", severity_hint: "Medium", title: `Dependencies with no version pin: ${loose.map(([n, v]) => `${n}@${v || "''"}`).slice(0, 10).join(", ")}`, file: "package.json", fix_hint: "Pin to a semver range and rely on the lockfile; avoid git/URL dependencies or pin them to a commit." });
    const scripts = Object.entries(pkg.scripts || {}).filter(([k, v]) => /^(pre|post)?install$/.test(k) && /(curl|wget|iwr)\b/.test(String(v)));
    if (scripts.length) checks.push({ rule: "install-script-download", category: "A03", severity_hint: "High", title: `Install script downloads code: ${scripts.map(([k]) => k).join(", ")}`, file: "package.json" });
  }
  if (has("requirements.txt")) {
    const unpinned = fs.readFileSync(path.join(root, "requirements.txt"), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#") && !/[=<>~!]=|@/.test(l));
    if (unpinned.length) checks.push({ rule: "python-unpinned", category: "A03", severity_hint: "Medium", title: `Unpinned Python requirements: ${unpinned.slice(0, 8).join(", ")}`, file: "requirements.txt", fix_hint: "Pin versions (or use a lock: uv.lock / poetry.lock / pip-compile with hashes)." });
  }
  // Committed env files (only the names, never contents).
  try {
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).split("\n");
    const envs = tracked.filter((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template|dist)$/.test(f));
    if (envs.length) checks.push({ rule: "env-file-committed", category: "A04", severity_hint: "High", title: `Environment file(s) tracked by git: ${envs.slice(0, 5).join(", ")}`, file: envs[0], fix_hint: "Remove from git (git rm --cached), add to .gitignore, rotate any secrets they held, commit a .env.example instead." });
    const keys = tracked.filter((f) => /\.(pem|key|p12|pfx|jks)$/.test(f) || /(^|\/)id_(rsa|ed25519|ecdsa)$/.test(f));
    if (keys.length) checks.push({ rule: "key-file-committed", category: "A04", severity_hint: "Critical", title: `Key/certificate file(s) tracked by git: ${keys.slice(0, 5).join(", ")}`, file: keys[0], fix_hint: "Remove, rotate the key, purge from history if the repo is shared." });
  } catch {
    checks.push({ rule: "not-a-git-repo", category: null, severity_hint: "Info", title: "Not a git repository: committed-secret file check skipped", file: "." });
  }
  return checks;
}

// Optional dependency vulnerability audit. Contacts the package registry, so it runs only
// when explicitly requested. Read-only: never installs or fixes.
export function dependencyAudit(root, pm) {
  const cmd = pm === "pnpm" ? ["pnpm", ["audit", "--json"]] : pm === "yarn" ? ["yarn", ["npm", "audit", "--json"]] : ["npm", ["audit", "--json", "--omit=dev"]];
  try {
    const out = execFileSync(cmd[0], cmd[1], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
    return summarizeAudit(out, cmd);
  } catch (e) {
    // npm/pnpm audit exit non-zero when vulnerabilities exist; stdout still holds the JSON.
    if (e.stdout) return summarizeAudit(String(e.stdout), cmd);
    return { ran: false, command: cmd.flat().join(" "), error: String(e.code === "ENOENT" ? `${cmd[0]} not installed` : (e.message || e)).split("\n")[0] };
  }
}

function summarizeAudit(out, cmd) {
  let j;
  try {
    j = JSON.parse(out);
  } catch {
    return { ran: true, command: cmd.flat().join(" "), parsed: false };
  }
  const counts = j.metadata?.vulnerabilities || j.metadata?.vulnerabilities || null;
  const advisories = Object.values(j.vulnerabilities || j.advisories || {}).slice(0, 25).map((v) => ({ name: v.name || v.module_name, severity: v.severity, via: Array.isArray(v.via) ? v.via.map((x) => (typeof x === "string" ? x : x.title)).filter(Boolean).slice(0, 2) : v.title, fix_available: Boolean(v.fixAvailable ?? v.patched_versions) }));
  return { ran: true, command: cmd.flat().join(" "), counts, advisories };
}

export function scanSecurity(root, opts = {}) {
  const files = scanFiles(root, SECURITY_RULES, opts);
  return { kind: "security", standard: "OWASP Top 10:2025", ...files, project_checks: projectChecks(root) };
}

export function scanA11y(root, opts = {}) {
  return { kind: "accessibility", standard: "WCAG 2.2 AA (static subset)", ...scanFiles(root, A11Y_RULES, opts) };
}
