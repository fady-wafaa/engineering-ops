// Review a requested agent's scope before choosing its model. The agent's frontmatter
// remains a fallback; a caller may pass the returned selected_model to the Agent tool.
export const AGENT_DEFAULTS = Object.freeze({
  "orchestrator": "sonnet", "browser-qa": "sonnet", "requirements-analyst": "sonnet",
  "code-implementer": "sonnet", "quality-gate": "haiku", "code-reviewer": "sonnet",
  "prompt-refiner": "haiku", "security-auditor": "sonnet", "accessibility-auditor": "sonnet",
  "performance-auditor": "sonnet", "ui-tester": "sonnet", "ux-auditor": "sonnet",
  "architecture-auditor": "sonnet",
});

export function recommendAgentModel(input = {}) {
  const agent = String(input.agent || "");
  if (!Object.hasOwn(AGENT_DEFAULTS, agent)) throw new Error(`Unknown agent: ${agent}`);
  const original = AGENT_DEFAULTS[agent];
  const items = Number(input.scope_items ?? input.estimated_files ?? NaN);
  const reasons = [];
  let complexity = 0;
  if (!Number.isFinite(items)) { complexity += 1; reasons.push("scope size unknown"); }
  else if (items > 20) { complexity += 3; reasons.push(`${items} scope items`); }
  else if (items > 5) { complexity += 2; reasons.push(`${items} scope items`); }
  else reasons.push(`${items} scope item(s)`);
  if (input.ambiguity === "high") { complexity += 2; reasons.push("high ambiguity"); }
  if (input.cross_layer) { complexity += 2; reasons.push("cross-layer flow"); }
  if (input.security_sensitive) { complexity += 2; reasons.push("security-sensitive decisions"); }
  if (input.shared_code) { complexity += 1; reasons.push("shared code"); }
  if (Number(input.failed_attempts || 0) >= 2) { complexity += 2; reasons.push("two or more failed attempts"); }
  if (input.requires_browser) reasons.push("browser evidence required");
  if (input.premium_reason) reasons.push(String(input.premium_reason));
  const substantial = new Set(["security-auditor", "accessibility-auditor", "performance-auditor", "architecture-auditor", "code-implementer"]);
  let recommended = original;
  if (original === "haiku" && complexity >= 3) recommended = "sonnet";
  if (original === "sonnet" && complexity === 0 && !substantial.has(agent)) recommended = "haiku";
  if (complexity >= 7 && agent !== "prompt-refiner" && input.allow_premium !== false) recommended = "opus";
  if (input.premium_reason) recommended = "opus";
  const premium = recommended === "opus";
  const approved = premium && input.premium_approved === true;
  const selected = premium && !approved ? "sonnet" : recommended;
  return {
    agent, default_model: original, recommended_model: recommended, selected_model: selected,
    change_proposed: recommended !== original, approval_required: premium && !approved,
    reasons, complexity,
    proposal: recommended !== original ? `${original} → ${recommended}: ${reasons.join(", ")}` : null,
    note: premium && !approved ? "Use sonnet until the user approves opus for this named agent and scope." : null,
  };
}
