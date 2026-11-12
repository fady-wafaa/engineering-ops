// Audit scoring — one rule for every auditor (references/audit-contract.md, docs/SCORING-POLICY.md).
// The model supplies criteria states and findings with evidence; the score and verdict
// are computed here so they are consistent and cannot drift between agents.
//
// Scores, criterion IDs, weights and coverage ratios are engineering-ops' own instrument,
// not a published standard. WCAG (accessibility) and OWASP (security) outcomes keep their
// own meaning inside the audits that cite them.

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];

export const SCORING_POLICY_VERSION = "2026.11-applicability-1";

/** The three states an expected criterion can be in. */
export const CRITERION_STATUSES = ["assessed", "not_assessed", "not_applicable"];

/** A criterion is only "not applicable" on a basis fixed before the audit, or a confirmed product property. */
export const NOT_APPLICABLE_BASES = ["scope", "product_property"];

/** Optional machine-readable reasons for "applicable but not assessed". */
export const NOT_ASSESSED_REASON_CODES = [
  "no_test_account", "access_blocked", "tool_unavailable",
  "expected_undefined", "requirement_unclear", "out_of_scope_data", "other",
];

const POINTS = [0, 1, 2];
const isPoints = (p) => POINTS.includes(p);
const text = (v) => String(v ?? "").trim();

/**
 * Coverage rules are exact ratios: "4/6", "5/8", "6/9".
 * A decimal (0.67) does not admit 4/6 — that mismatch is why this parser exists.
 * Decimals are still accepted so older inputs keep working.
 */
export function parseCoverageRule(value) {
  if (value == null) return { num: 1, den: 2, text: "1/2", form: "default" };
  if (typeof value === "object" && !Array.isArray(value)) {
    const num = Number(value.numerator ?? value.min_assessed);
    const den = Number(value.denominator ?? value.of);
    if (Number.isInteger(num) && Number.isInteger(den) && den > 0 && num >= 0) return { num, den, text: `${num}/${den}`, form: "ratio" };
    return null;
  }
  const raw = String(value).trim();
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
  if (fraction) {
    const [, n, d] = fraction;
    if (Number(d) === 0) return null;
    return { num: Number(n), den: Number(d), text: `${Number(n)}/${Number(d)}`, form: "ratio" };
  }
  const decimal = Number(raw);
  if (!Number.isFinite(decimal) || decimal < 0 || decimal > 1) return null;
  // Keep the decimal exact: 0.67 -> 67/100, so it keeps rejecting 4/6 as it always did.
  const den = 10 ** ((raw.split(".")[1] || "").length);
  return { num: Math.round(decimal * den), den, text: raw, form: "decimal" };
}

/** assessed × den ≥ num × applicable — integer arithmetic, no float drift. */
export function meetsCoverage(assessed, applicable, rule) {
  return assessed * rule.den >= rule.num * applicable;
}

export function minAssessedFor(applicable, rule) {
  return Math.ceil((rule.num * applicable) / rule.den);
}

/**
 * Reads one criterion or sub-check into a single state.
 * Legacy input (points: null, no status) means "not assessed" and keeps that meaning.
 */
export function normalizeCriterion(raw, { label = "criterion" } = {}) {
  const id = text(raw?.id);
  const errors = [];
  const points = raw?.points === undefined ? null : raw.points;
  const declared = raw?.status === undefined || raw?.status === null ? null : text(raw.status);
  let status = declared;

  if (status && !CRITERION_STATUSES.includes(status)) {
    errors.push(`unknown status on ${label} ${id || "(no id)"}: ${status}`);
    status = null;
  }
  if (!status) status = isPoints(points) ? "assessed" : "not_assessed"; // legacy: points null -> not assessed

  // Contradictions are rejected, never repaired.
  if (status === "assessed" && !isPoints(points)) errors.push(`${label} ${id} is "assessed" without points 0, 1 or 2`);
  if (status !== "assessed" && points !== null) errors.push(`${label} ${id} is "${status}" but carries points ${JSON.stringify(points)}`);

  const reason = text(raw?.reason) || (status === "assessed" ? "" : text(raw?.evidence));
  const evidence = text(raw?.evidence) || (status === "assessed" ? "" : reason);
  const basis = text(raw?.basis) || null;
  const reasonCode = text(raw?.reason_code) || null;

  if (status === "not_applicable") {
    if (!basis) errors.push(`${label} ${id} is "not_applicable" without a basis (scope | product_property)`);
    else if (!NOT_APPLICABLE_BASES.includes(basis)) errors.push(`${label} ${id} has an unknown not_applicable basis: ${basis}`);
    if (!reason) errors.push(`${label} ${id} is "not_applicable" without a reason`);
  }
  if (status === "not_assessed") {
    if (reasonCode && !NOT_ASSESSED_REASON_CODES.includes(reasonCode)) errors.push(`${label} ${id} has an unknown reason_code: ${reasonCode}`);
  }

  return {
    id,
    status,
    points: status === "assessed" ? points : null,
    evidence,
    reason,
    basis: status === "not_applicable" ? basis : null,
    reason_code: status === "not_assessed" ? reasonCode : null,
    declared_status: declared,
    errors,
  };
}

/**
 * A composite criterion (UX keyboard + narrow layout + RTL) records one state per sub-check.
 * RTL being not applicable never removes the parent criterion, and the parent cannot be a
 * full pass while an applicable sub-check went untested.
 */
function normalizeSubChecks(raw, parent) {
  if (!Array.isArray(raw?.sub_checks) || raw.sub_checks.length === 0) return { sub_checks: null, errors: [] };
  const errors = [];
  const seen = new Set();
  const subs = raw.sub_checks.map((s, index) => {
    const sub = normalizeCriterion(s, { label: `sub-check of ${parent.id}` });
    if (!sub.id) errors.push(`sub-check ${index + 1} of ${parent.id} has no id`);
    else if (seen.has(sub.id)) errors.push(`duplicate sub-check of ${parent.id}: ${sub.id}`);
    seen.add(sub.id);
    errors.push(...sub.errors);
    return sub;
  });
  const applicable = subs.filter((s) => s.status !== "not_applicable");
  if (applicable.length === 0 && parent.status !== "not_applicable") {
    errors.push(`${parent.id}: every sub-check is not applicable, so the criterion itself must be "not_applicable"`);
  }
  if (applicable.length > 0 && parent.status === "not_applicable") {
    errors.push(`${parent.id} is "not_applicable" but ${applicable.map((s) => s.id).join(", ")} still applies`);
  }
  const untested = applicable.filter((s) => s.status === "not_assessed");
  if (untested.length && parent.points === 2) {
    errors.push(`${parent.id} cannot be a full pass while ${untested.map((s) => s.id).join(", ")} was not assessed`);
  }
  return { sub_checks: subs.map(({ errors: _e, declared_status: _d, ...rest }) => rest), errors };
}

export function compareAuditConditions(before, after) {
  if (before == null && after == null) return { comparable: true, reasons: [] }; // legacy records
  if (before == null || after == null) return { comparable: false, reasons: ["conditions missing on one run"] };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const reasons = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((key) => `${key}: missing or different`);
  return { comparable: reasons.length === 0, reasons };
}

const sameSet = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Two scores are comparable only when the conditions, the scoring policy and the sets of
 * applicable and assessed criteria all match. Anything else is a different measurement.
 */
export function compareScoringBasis(before, after) {
  const reasons = [];
  const a = before?.scoring_policy, b = after?.scoring_policy;
  if (a && b) {
    if (a.policy_version !== b.policy_version) reasons.push("policy_version: different");
    if (a.min_coverage !== b.min_coverage) reasons.push("min_coverage: different");
    if (!sameSet(a.required_criteria, b.required_criteria)) reasons.push("required_criteria: different");
  } else if (a || b) {
    reasons.push("scoring_policy: recorded on one run only");
  }
  // A changed performance budget is a changed scoring rule: the two scores stop being comparable.
  if (before?.budgets || after?.budgets) {
    if (JSON.stringify(before?.budgets ?? null) !== JSON.stringify(after?.budgets ?? null)) reasons.push("budgets: missing or different");
  }
  const ca = before?.coverage, cb = after?.coverage;
  if (ca?.applicable_ids && cb?.applicable_ids && !sameSet(ca.applicable_ids, cb.applicable_ids)) reasons.push("applicable criteria: different");
  if (ca?.assessed_ids && cb?.assessed_ids && !sameSet(ca.assessed_ids, cb.assessed_ids)) reasons.push("assessed criteria: different");
  return { comparable: reasons.length === 0, reasons };
}

export function scoreAudit({
  criteria = [],
  findings = [],
  min_coverage = 0.5,
  total_criteria,
  expected_criteria = null,
  required_criteria = null,
} = {}) {
  const strict = Array.isArray(expected_criteria);
  const expected = strict ? [...new Set(expected_criteria.map(String))] : null;
  const required = Array.isArray(required_criteria) ? [...new Set(required_criteria.map(String))] : [];
  const seen = new Set();
  const validationErrors = [];

  const rule = parseCoverageRule(min_coverage);
  if (!rule) validationErrors.push(`invalid min_coverage: ${JSON.stringify(min_coverage)}`);
  const coverageRule = rule || { num: 1, den: 2, text: "1/2", form: "default" };

  if (strict && expected.length !== expected_criteria.length) validationErrors.push("duplicate expected criterion");
  if (strict && total_criteria != null && Number(total_criteria) !== expected.length) validationErrors.push("total_criteria differs from expected_criteria length");
  if (strict) for (const id of required) if (!expected.includes(id)) validationErrors.push(`required criterion is not expected: ${id}`);

  // "Contradictions" are states that cannot be repaired by testing more: a criterion that is
  // "assessed" without points, "not_applicable" without a basis, a composite scored 2 while a
  // sub-check went untested. audit-record refuses to store these at all.
  const contradictions = [];
  const states = [];
  for (const raw of criteria) {
    const state = normalizeCriterion(raw);
    const id = state.id;
    if (!id) validationErrors.push("criterion without id");
    if (seen.has(id)) validationErrors.push(`duplicate criterion: ${id}`);
    seen.add(id);
    if (strict && !expected.includes(id)) validationErrors.push(`unexpected criterion: ${id}`);
    contradictions.push(...state.errors);
    if (strict) {
      if (state.status === "assessed" && !state.evidence) validationErrors.push(`missing evidence: ${id}`);
      if (state.status !== "assessed" && !state.reason) validationErrors.push(`missing reason for "${state.status}": ${id}`);
    }
    const { sub_checks, errors: subErrors } = normalizeSubChecks(raw, state);
    contradictions.push(...subErrors);
    states.push({ ...state, sub_checks });
  }
  if (strict) for (const id of expected) if (!seen.has(id)) validationErrors.push(`missing criterion: ${id}`);

  const assessed = states.filter((c) => c.status === "assessed");
  const notApplicable = states.filter((c) => c.status === "not_applicable");
  const notAssessed = states.filter((c) => c.status === "not_assessed");
  const expectedCount = strict ? expected.length : Number(total_criteria) || states.length;
  const applicableCount = Math.max(0, expectedCount - notApplicable.length);
  const earned = assessed.reduce((s, c) => s + c.points, 0);

  const coverage = {
    expected: expectedCount,
    applicable: applicableCount,
    assessed: assessed.length,
    not_assessed: notAssessed.length,
    not_applicable: notApplicable.length,
    ratio: applicableCount ? assessed.length / applicableCount : 0,
    rule: coverageRule.text,
    min_assessed: minAssessedFor(applicableCount, coverageRule),
    applicable_ids: states.filter((c) => c.status !== "not_applicable").map((c) => c.id),
    assessed_ids: assessed.map((c) => c.id),
    not_applicable_ids: notApplicable.map((c) => c.id),
    not_assessed_ids: notAssessed.map((c) => c.id),
    // legacy field names, unchanged meaning
    tested: assessed.length,
    total: expectedCount,
  };

  const requiredState = {
    ids: required,
    failed: required.filter((id) => states.find((c) => c.id === id && c.status === "assessed" && c.points === 0)),
    not_assessed: required.filter((id) => states.find((c) => c.id === id)?.status === "not_assessed" || !states.find((c) => c.id === id)),
    not_applicable: required.filter((id) => states.find((c) => c.id === id)?.status === "not_applicable"),
  };
  for (const id of requiredState.not_applicable) {
    contradictions.push(`required criterion cannot be "not_applicable": ${id} — narrow the declared scope instead`);
  }
  validationErrors.push(...contradictions);

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) {
    const sev = SEVERITIES.find((s) => s.toLowerCase() === String(f.severity || "").toLowerCase());
    if (sev) counts[sev]++;
  }
  const invalid = findings.filter((f) => !SEVERITIES.some((s) => s.toLowerCase() === String(f.severity || "").toLowerCase())).map((f) => f.id || f.title);
  if (strict && invalid.length) validationErrors.push(`invalid finding severity: ${invalid.join(", ")}`);

  const scoring_policy = {
    policy_version: SCORING_POLICY_VERSION,
    min_coverage: coverageRule.text,
    required_criteria: required,
    scale: "0 | 1 | 2 over assessed criteria; engineering-ops instrument, not a published standard",
  };
  const base = {
    coverage,
    counts,
    invalid_severity: invalid,
    validation_errors: validationErrors,
    contradictions,
    criteria_status: states.map(({ errors: _e, declared_status: _d, ...rest }) => rest),
    required: requiredState,
    scoring_policy,
  };

  if (expectedCount > 0 && applicableCount === 0) {
    return validationErrors.length
      ? { score: null, verdict: "INSUFFICIENT_COVERAGE", ...base, reason: "invalid not-applicable basis or criterion state" }
      : { score: null, verdict: "NOT_APPLICABLE", ...base, reason: "no expected criterion applies to this target" };
  }
  if (assessed.length === 0) {
    return { score: null, verdict: "BLOCKED", ...base, reason: "no applicable criterion could be assessed" };
  }
  if (validationErrors.length) {
    return { score: null, verdict: "INSUFFICIENT_COVERAGE", ...base, reason: "invalid criterion state, evidence or coverage rule" };
  }
  if (requiredState.not_assessed.length) {
    return {
      score: null, verdict: "INSUFFICIENT_COVERAGE", ...base,
      reason: `required criterion not assessed: ${requiredState.not_assessed.join(", ")} — this is not a failure, it was not tested`,
    };
  }
  if (!meetsCoverage(assessed.length, applicableCount, coverageRule)) {
    return {
      score: null, verdict: "INSUFFICIENT_COVERAGE", ...base,
      reason: `assessed ${assessed.length}/${applicableCount} applicable, minimum ${coverage.min_assessed} (${coverageRule.text})`,
    };
  }

  const score = Math.round((100 * earned) / (2 * assessed.length));
  if (requiredState.failed.length) {
    return {
      score, verdict: "FAIL", ...base,
      reason: `required criterion failed: ${requiredState.failed.join(", ")} — no success verdict for the scope that depends on it`,
    };
  }
  let verdict;
  if (counts.Critical > 0 || score < 60) verdict = "FAIL";
  else if (score >= 85 && counts.High === 0) verdict = "PASS";
  else verdict = "PASS_WITH_ISSUES";
  return { score, verdict, ...base };
}
