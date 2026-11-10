// Model routing (#6): pick the cheapest model that is reliable for each stage, based on
// task size. Deterministic so the orchestrator does not spend tokens deciding, and so the
// rule is testable. Premium models are never chosen silently: they are returned as
// "proposed" with approval_required until the user approves a bounded scope.
//
// Model aliases are the ones Claude Code accepts for agents/skills: haiku, sonnet, opus.
// "opus" stands for "the premium tier available to this account" — the orchestrator must
// check what the account really offers and say so if it differs.
import { recommendAgentModel } from "./agent-model.mjs";

export const STAGE_WORKERS = {
  "0_prompt": "prompt-refiner",
  "1_intake": "orchestrator",
  "2_baseline": "browser-qa",
  "3_analysis": "requirements-analyst",
  "4_questions": "orchestrator",
  "5_mode_branch_gate": "orchestrator",
  "6_implementation": "code-implementer",
  "7_checks_postcheck": "quality-gate+browser-qa",
  "8_final_review": "code-reviewer",
  "9_report_handoff": "orchestrator",
};

// Score -> size. Each signal adds points; thresholds are simple on purpose.
export function sizeTask(input = {}) {
  const reasons = [];
  let score = 0;
  const files = Number(input.estimated_files ?? NaN);
  if (Number.isFinite(files)) {
    if (files <= 2) reasons.push(`${files} file(s) expected`);
    else if (files <= 6) (score += 2), reasons.push(`${files} files expected`);
    else if (files <= 15) (score += 4), reasons.push(`${files} files expected`);
    else (score += 6), reasons.push(`${files}+ files expected`);
  } else {
    score += 2;
    reasons.push("file count unknown (assume medium)");
  }
  const amb = String(input.ambiguity || "low").toLowerCase();
  if (amb === "medium") (score += 1), reasons.push("some ambiguity");
  if (amb === "high") (score += 3), reasons.push("high ambiguity");
  const type = String(input.type || "").toUpperCase();
  if (type === "MIXED") (score += 1), reasons.push("mixed bug + feature");
  if (input.shared_code) (score += 2), reasons.push("touches shared code used in many places");
  if (input.cross_layer) (score += 2), reasons.push("crosses frontend/backend or data model");
  if (input.security_sensitive) (score += 2), reasons.push("security / permissions / payments");
  if (input.migration) (score += 3), reasons.push("data migration or public API contract");
  const size = score <= 1 ? "S" : score <= 4 ? "M" : score <= 8 ? "L" : "XL";
  return { size, score, reasons };
}

const BASE = {
  S: { "0_prompt": "haiku", "1_intake": "haiku", "2_baseline": "haiku", "3_analysis": "haiku", "6_implementation": "sonnet", "7_checks_postcheck": "haiku", "8_final_review": "haiku" },
  M: { "0_prompt": "haiku", "1_intake": "haiku", "2_baseline": "sonnet", "3_analysis": "sonnet", "6_implementation": "sonnet", "7_checks_postcheck": "haiku", "8_final_review": "sonnet" },
  L: { "0_prompt": "haiku", "1_intake": "sonnet", "2_baseline": "sonnet", "3_analysis": "sonnet", "6_implementation": "sonnet", "7_checks_postcheck": "haiku", "8_final_review": "sonnet" },
  XL: { "0_prompt": "haiku", "1_intake": "sonnet", "2_baseline": "sonnet", "3_analysis": "sonnet", "6_implementation": "sonnet", "7_checks_postcheck": "sonnet", "8_final_review": "sonnet" },
};

// Context budget per size: how much the orchestrator passes to each worker.
const BUDGET = {
  S: { max_files_in_packet: 5, max_search_paths: 3, note: "Pass only the card, the baseline summary and the named files." },
  M: { max_files_in_packet: 12, max_search_paths: 6, note: "Pass the packet plus the code map; no full-repo scans." },
  L: { max_files_in_packet: 25, max_search_paths: 10, note: "Split the work by area; pass each worker only its area." },
  XL: { max_files_in_packet: 40, max_search_paths: 15, note: "Propose splitting into smaller tasks before implementation." },
};

export function routeTask(input = {}) {
  const sized = input.size ? { size: String(input.size).toUpperCase(), score: null, reasons: ["size given"] } : sizeTask(input);
  const size = BASE[sized.size] ? sized.size : "M";
  const models = { ...BASE[size] };
  // Base adjustments come first and only ever raise a stage (haiku -> sonnet).
  const raise = (stage) => {
    if (models[stage] === "haiku") models[stage] = "sonnet";
  };
  if (String(input.ambiguity || "").toLowerCase() === "high") raise("3_analysis");
  if (Number(input.repair_rounds || 0) >= 1) raise("6_implementation");
  const proposals = [];
  const approved = new Set((input.premium_approved_stages || []).map(String));

  const propose = (stage, why) => {
    if (approved.has(stage)) {
      models[stage] = "opus";
      proposals.push({ stage, model: "opus", why, approval_required: false, approved: true });
    } else {
      proposals.push({ stage, model: "opus", why, approval_required: true, approved: false });
    }
  };
  if (size === "XL") propose("3_analysis", "very large or risky task: a stronger model may plan it better");
  if (Number(input.failed_diagnoses || 0) >= 2) propose("3_analysis", "two diagnoses already failed");
  if (Number(input.repair_rounds || 0) >= 2) propose("6_implementation", "repairs keep failing");

  const workerStages = {
    "prompt-refiner": "0_prompt", "browser-qa": "2_baseline", "requirements-analyst": "3_analysis",
    "code-implementer": "6_implementation", "quality-gate": "7_checks_postcheck", "code-reviewer": "8_final_review",
  };
  const workerModels = Object.fromEntries(Object.entries(workerStages).map(([agent, stage]) => [agent,
    recommendAgentModel({ ...input, agent, scope_items: input.estimated_files,
      allow_premium: proposals.some((p) => p.stage === stage),
      premium_reason: proposals.find((p) => p.stage === stage)?.why,
      premium_approved: approved.has(stage) || approved.has(agent) })]));

  return {
    ok: true,
    size,
    score: sized.score,
    reasons: sized.reasons,
    models,
    worker_models: workerModels,
    workers: STAGE_WORKERS,
    premium_proposals: proposals,
    approval_required: proposals.some((p) => p.approval_required) || Object.values(workerModels).some((p) => p.approval_required),
    context_budget: BUDGET[size],
    split_recommended: size === "XL",
  };
}
