// Generic branch guard (ported from SuiteFleet's guard-branch-workflow.mjs).
//
// Rules, all driven by config.workflow.branch_policy:
//  1. Code from an INTEGRATION branch (e.g. a QA "develop" branch) must never flow into a
//     task branch: merge / pull / rebase / reset / cherry-pick from it, checking out or
//     restoring files from it, creating a branch or worktree from it, or setting it as
//     upstream — unless you are on that integration branch itself.
//  2. Optional: no `git commit` while on a protected branch (main, master, release/*…).
// Reading (log, diff, fetch, show) is always allowed. Pure function: easy to test.

/** Minimal shell tokenizer: whitespace-separated, respects single and double quotes. */
export function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  let inToken = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = "";
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

/** Split a compound command into segments, keeping quoted separators intact. */
export function splitSegments(cmd) {
  const segments = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n" || ch === "&") {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

function parseGit(tokens) {
  const at = tokens.findIndex((t) => /(^|[\\/])git(\.exe)?$/.test(t));
  if (at === -1) return null;
  let i = at + 1;
  let dir = null;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    if (tokens[i] === "-C") dir = tokens[++i];
    else if (tokens[i] === "-c") i++;
    i++;
  }
  if (i >= tokens.length) return null;
  return { sub: tokens[i], args: tokens.slice(i + 1), dir };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRe(glob) {
  return new RegExp(`^${glob.split("*").map(escapeRe).join(".*")}$`);
}

export function makeRefMatcher(names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return () => false;
  const alt = list.map(escapeRe).join("|");
  const ref = new RegExp(`^(?:refs\\/heads\\/|refs\\/remotes\\/)?(?:(?:origin|upstream)\\/)?(?:${alt})(?:[~^]\\d*)*$`);
  // A ref, a range (a..b, a...b) or a refspec (src:dst) that names one of the branches.
  return (token) =>
    String(token)
      .replace(/^\+/, "")
      .split(/\.\.\.?|:/)
      .some((part) => ref.test(part));
}

export function stripHeredocs(command) {
  // Drop heredoc bodies (e.g. a commit message that only *mentions* `git merge develop`).
  return String(command || "").replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, "");
}

/**
 * @param {string} rawCommand  the shell command about to run
 * @param {object} opts { policy, branch, branchAt(dir) }
 * @returns {{ blocked: boolean, findings: Array<{segment, why, branch}> }}
 */
export function analyzeCommand(rawCommand, { policy = {}, branch = "", branchAt = () => "" } = {}) {
  const command = stripHeredocs(rawCommand);
  const findings = [];
  if (!/\bgit\b/.test(command)) return { blocked: false, findings };

  const integration = policy.integration_branches || [];
  const isIntegrationRef = makeRefMatcher(integration);
  const onIntegration = (b) => integration.includes(b);
  const protectedNames = policy.protected_branches || [];
  const protectedPatterns = (policy.protected_patterns || []).map(globToRe);
  const isProtected = (b) => Boolean(b) && (protectedNames.includes(b) || protectedPatterns.some((re) => re.test(b)));
  const blockCommit = policy.block_commit_on_protected !== false;

  let current = branch;
  for (const segment of splitSegments(command)) {
    const git = parseGit(tokenize(segment));
    if (!git) continue;
    const { sub, args } = git;
    const segBranch = git.dir ? branchAt(git.dir) : current;
    const flags = args.filter((a) => a.startsWith("-"));
    const positionals = args.filter((a) => !a.startsWith("-"));
    const block = (why) => findings.push({ segment, why, branch: segBranch || "(unknown)" });

    switch (sub) {
      case "checkout":
      case "switch": {
        const createFlag = args.findIndex((a) => ["-b", "-B", "-c", "-C", "--create", "--force-create", "--orphan"].includes(a));
        if (createFlag !== -1) {
          const newBranch = args[createFlag + 1];
          const start = args.slice(createFlag + 2).find((a) => !a.startsWith("-"));
          if (start && isIntegrationRef(start)) block(`creates \`${newBranch}\` from integration branch \`${start}\` — task branches start from ${policy.base_ref || "the release base"}`);
          if (!git.dir && newBranch) current = newBranch;
          break;
        }
        const dashDash = args.indexOf("--");
        if (dashDash !== -1) {
          const source = args.slice(0, dashDash).find((a) => !a.startsWith("-"));
          if (source && isIntegrationRef(source) && !onIntegration(segBranch)) block("checks out files from an integration branch into this branch");
          break;
        }
        if (sub === "checkout" && positionals.length > 1 && isIntegrationRef(positionals[0]) && !onIntegration(segBranch)) {
          block("checks out files from an integration branch into this branch");
          break;
        }
        const target = positionals[0];
        if (!git.dir && target) current = target === "-" ? "" : target.replace(/^(origin|upstream)\//, "");
        break;
      }
      case "restore": {
        const sourceArg = args.find((a) => a.startsWith("--source="))?.split("=")[1];
        const sIndex = args.findIndex((a) => a === "-s" || a === "--source");
        const source = sourceArg ?? (sIndex !== -1 ? args[sIndex + 1] : undefined);
        if (source && isIntegrationRef(source) && !onIntegration(segBranch)) block("restores files from an integration branch into this branch");
        break;
      }
      case "merge":
      case "pull":
      case "rebase":
      case "reset":
      case "cherry-pick": {
        if (onIntegration(segBranch)) break; // updating the integration branch itself is fine
        if (positionals.some(isIntegrationRef)) {
          const verb = { merge: "merges", pull: "pulls", rebase: "rebases onto", reset: "resets onto", "cherry-pick": "cherry-picks from" }[sub];
          block(`${verb} an integration branch — it carries unreleased work still in QA`);
        }
        break;
      }
      case "branch": {
        const upstream = args.find((a) => a.startsWith("--set-upstream-to="))?.split("=")[1];
        const uIndex = args.findIndex((a) => a === "-u" || a === "--set-upstream-to");
        const upstreamRef = upstream ?? (uIndex !== -1 ? args[uIndex + 1] : undefined);
        if (upstreamRef && isIntegrationRef(upstreamRef) && !onIntegration(segBranch)) {
          block("sets an integration branch as the upstream of a task branch");
          break;
        }
        const otherFlags = flags.some((f) => !["-f", "--force", "--no-track", "-t", "--track"].includes(f));
        if (!otherFlags && positionals.length === 2 && isIntegrationRef(positionals[1])) block(`creates \`${positionals[0]}\` from an integration branch`);
        break;
      }
      case "worktree": {
        if (positionals[0] !== "add") break;
        if (args.some((a) => ["-b", "-B"].includes(a)) && positionals.slice(1).some(isIntegrationRef)) block("creates a worktree branch from an integration branch");
        break;
      }
      case "commit": {
        if (blockCommit && isProtected(segBranch)) block(`commits directly on protected branch \`${segBranch}\` — use a task branch`);
        break;
      }
      default:
        break;
    }
  }
  return { blocked: findings.length > 0, findings };
}

export function formatBlockMessage(findings, policy = {}) {
  let out = "Blocked by the Engineering Ops branch guard (config.workflow.branch_policy):\n";
  for (const f of findings) out += `  • \`${f.segment}\` on \`${f.branch}\` ${f.why}.\n`;
  out += `\nTask branches start from ${policy.base_ref || "the release base"} and must not take code from integration branches (${(policy.integration_branches || []).join(", ") || "none configured"}).\n`;
  out += "If the user really wants this, ask them to run the command themselves, or to change the policy with /engineering-ops:engineering → 9.\n";
  return out;
}
