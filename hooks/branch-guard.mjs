#!/usr/bin/env node
// PreToolUse hook (Bash / PowerShell). Opt-in per project: it does nothing unless this
// project's config has workflow.branch_policy.guard_enabled = true.
// Exit 0 = allowed; exit 2 = blocked (stderr is shown to Claude).
// Any internal error allows the command (a broken guard must not block all shell use).

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { analyzeCommand, formatBlockMessage } from "../scripts/lib/branch-guard.mjs";
import { loadConfig, resolveProject } from "../scripts/lib/common.mjs";

async function main() {
  let raw = "";
  // Async stdin read: the synchronous fd-0 read is unreliable on Windows.
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw || "{}");
  if (!["Bash", "PowerShell"].includes(payload.tool_name ?? "")) return 0;
  const command = String(payload.tool_input?.command ?? "");
  if (!/\bgit\b/.test(command)) return 0;

  const cwd = payload.cwd || process.cwd();
  const policy = loadConfig(resolveProject({}, cwd))?.workflow?.branch_policy;
  if (!policy?.guard_enabled) return 0;

  const branchAt = (dir) => {
    try {
      return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: path.resolve(cwd, dir), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    } catch {
      return "";
    }
  };
  const result = analyzeCommand(command, { policy, branch: branchAt("."), branchAt });
  if (!result.blocked) return 0;
  process.stderr.write(formatBlockMessage(result.findings, policy));
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(0));
