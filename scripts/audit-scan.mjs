#!/usr/bin/env node
// Static pre-scan for the auditors. Read-only. Prints candidate findings as JSON.
//   node audit-scan.mjs security [--dir <root>] [--deps] [--include-tests] [--out <file>]
//   node audit-scan.mjs a11y     [--dir <root>] [--include-tests] [--out <file>]
// --deps runs the package manager's audit (contacts the registry; never installs/fixes).

import process from "node:process";
import { atomicWrite, fail, parseArgs, printJson, projectRoot } from "./lib/common.mjs";
import { dependencyAudit, scanA11y, scanSecurity } from "./lib/scanner.mjs";
import { detectStack } from "./lib/stack.mjs";

const args = parseArgs(process.argv.slice(2));
const kind = args._[0];
const root = args.dir ? String(args.dir) : projectRoot();
const opts = { includeTests: Boolean(args["include-tests"]) };

function summarize(result) {
  const bySeverity = {};
  const byGroup = {};
  for (const h of [...result.hits, ...(result.project_checks || [])]) {
    bySeverity[h.severity_hint] = (bySeverity[h.severity_hint] || 0) + 1;
    const g = h.category || h.wcag || "other";
    byGroup[g] = (byGroup[g] || 0) + 1;
  }
  return { by_severity_hint: bySeverity, by_group: byGroup, total_candidates: result.hits.length + (result.project_checks?.length || 0) };
}

try {
  let result;
  if (kind === "security") {
    result = scanSecurity(root, opts);
    if (args.deps) result.dependency_audit = dependencyAudit(root, detectStack(root).package_manager);
  } else if (kind === "a11y" || kind === "accessibility") {
    result = scanA11y(root, opts);
  } else {
    fail("usage: audit-scan.mjs security|a11y [--dir <root>] [--deps] [--include-tests] [--out <file>]");
  }
  if (result) {
    const out = { ok: true, root, note: "Candidates only. Confirm each in context before reporting it as a finding.", summary: summarize(result), ...result };
    if (args.out) {
      atomicWrite(String(args.out), JSON.stringify(out, null, 2));
      printJson({ ok: true, written: String(args.out), summary: out.summary, files_scanned: out.files_scanned });
    } else {
      printJson(out);
    }
  }
} catch (e) {
  fail("audit-scan failed", { detail: String(e?.message || e) });
}
