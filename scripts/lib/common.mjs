// Shared helpers: argument parsing, JSON output, atomic files, state paths, config.
// Zero dependencies. Works on Windows, macOS and Linux with Node >= 18.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// --json-file avoids shell quoting problems (PowerShell 5.1 strips inner double quotes
// from native-command arguments). --json is kept for simple shells and tests.
export function jsonArg(args) {
  if (args["json-file"]) return fs.readFileSync(String(args["json-file"]), "utf8").replace(/^﻿/, "");
  return typeof args.json === "string" ? args.json : undefined;
}

export function parseJsonArg(args, label) {
  const raw = jsonArg(args);
  if (raw === undefined) return { error: `${label} requires --json or --json-file` };
  try {
    return { value: JSON.parse(raw) };
  } catch (e) {
    return { error: `${label}: input is not valid JSON`, detail: String(e.message || e) };
  }
}

export function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

export function fail(reason, extra = {}) {
  printJson({ ok: false, error: reason, ...extra });
  process.exitCode = 1;
}

export function atomicWrite(filePath, dataString) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, dataString, "utf8");
  fs.renameSync(tmp, filePath); // atomic on the same filesystem
}

export function removeQuietly(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // already removed or briefly locked; nothing depends on this cleanup
  }
}

export function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---- paths -----------------------------------------------------------------
// State and personal config live OUTSIDE any repository:
//   <ENGOPS_HOME>/projects/<project-slug>/   (default ENGOPS_HOME = ~/.engineering-ops)
// ENGOPS_STATE_DIR points straight at one state folder (tests use it).
// AI_WORKFLOW_STATE_DIR is accepted for compatibility with the original script.

export function engopsHome() {
  return process.env.ENGOPS_HOME || path.join(os.homedir(), ".engineering-ops");
}

export function projectSlugFor(dir) {
  const resolved = path.resolve(dir);
  const base = path.basename(resolved).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const hash = crypto.createHash("sha256").update(resolved.toLowerCase()).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

export function resolveProject(args = {}) {
  const explicit = args.project || process.env.ENGOPS_PROJECT;
  const slug = explicit ? String(explicit).replace(/[^a-zA-Z0-9._-]/g, "_") : projectSlugFor(process.cwd());
  const stateDir =
    process.env.ENGOPS_STATE_DIR ||
    process.env.AI_WORKFLOW_STATE_DIR ||
    path.join(engopsHome(), "projects", slug);
  return { slug, stateDir, configPath: path.join(stateDir, "config.json") };
}

export function loadConfig(project) {
  return readJsonSafe(project.configPath, null);
}

export function deepMerge(target, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== "object") return patch;
  const out = { ...(target && typeof target === "object" && !Array.isArray(target) ? target : {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

// Real UTC run IDs. The original watcher let the model write a Cairo time with a "Z"
// suffix, so IDs looked two hours late (audit finding D2). The script now owns this.
export function utcRunId(prefix = "run", at = new Date()) {
  const iso = at.toISOString(); // 2026-11-07T13:28:48.777Z
  const compact = iso.slice(0, 19).replace(/[-:]/g, "");
  return `${prefix}-${compact}Z`;
}

export function truncate(text, max) {
  const s = String(text ?? "");
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}
