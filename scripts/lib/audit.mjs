// Audit scoring — one rule for every auditor (references/audit-contract.md).
// The model supplies criteria points and findings with evidence; the score and verdict
// are computed here so they are consistent and cannot drift between agents.

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];

export function compareAuditConditions(before, after) {
  if (before == null && after == null) return { comparable: true, reasons: [] }; // legacy records
  if (before == null || after == null) return { comparable: false, reasons: ["conditions missing on one run"] };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const reasons = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((key) => `${key}: missing or different`);
  return { comparable: reasons.length === 0, reasons };
}

export function scoreAudit({ criteria = [], findings = [], min_coverage = 0.5, total_criteria, expected_criteria = null } = {}) {
  const strict = Array.isArray(expected_criteria);
  const expected = strict ? [...new Set(expected_criteria.map(String))] : null;
  const seen = new Set();
  const validationErrors = [];
  if (strict && expected.length !== expected_criteria.length) validationErrors.push("duplicate expected criterion");
  if (strict && total_criteria != null && Number(total_criteria) !== expected.length) validationErrors.push("total_criteria differs from expected_criteria length");
  for (const c of criteria) {
    const id = String(c.id || "");
    if (!id) validationErrors.push("criterion without id");
    if (seen.has(id)) validationErrors.push(`duplicate criterion: ${id}`);
    seen.add(id);
    if (strict && !expected.includes(id)) validationErrors.push(`unexpected criterion: ${id}`);
    if (strict && !String(c.evidence || "").trim()) validationErrors.push(`missing evidence or untested reason: ${id}`);
    if (strict && c.points !== null && c.points !== 0 && c.points !== 1 && c.points !== 2) validationErrors.push(`invalid points: ${id}`);
  }
  if (strict) for (const id of expected) if (!seen.has(id)) validationErrors.push(`missing criterion: ${id}`);
  const tested = criteria.filter((c) => c.points === 0 || c.points === 1 || c.points === 2);
  const total = strict ? expected.length : Number(total_criteria) || criteria.length;
  const earned = tested.reduce((s, c) => s + c.points, 0);
  const coverage = { tested: tested.length, total, ratio: total ? tested.length / total : 0 };
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) {
    const sev = SEVERITIES.find((s) => s.toLowerCase() === String(f.severity || "").toLowerCase());
    if (sev) counts[sev]++;
  }
  const invalid = findings.filter((f) => !SEVERITIES.some((s) => s.toLowerCase() === String(f.severity || "").toLowerCase())).map((f) => f.id || f.title);
  if (strict && invalid.length) validationErrors.push(`invalid finding severity: ${invalid.join(", ")}`);

  if (tested.length === 0) return { score: null, verdict: "BLOCKED", coverage, counts, invalid_severity: invalid, validation_errors: validationErrors, reason: "no criterion could be tested" };
  if (validationErrors.length) return { score: null, verdict: "INSUFFICIENT_COVERAGE", coverage, counts, invalid_severity: invalid, validation_errors: validationErrors, reason: "invalid criterion evidence or coverage" };
  const score = Math.round((100 * earned) / (2 * tested.length));
  if (coverage.ratio < min_coverage) {
    return { score: null, verdict: "INSUFFICIENT_COVERAGE", coverage, counts, invalid_severity: invalid, validation_errors: validationErrors, reason: `tested ${tested.length}/${total}, minimum ${Math.ceil(min_coverage * total)}` };
  }
  let verdict;
  if (counts.Critical > 0 || score < 60) verdict = "FAIL";
  else if (score >= 85 && counts.High === 0) verdict = "PASS";
  else verdict = "PASS_WITH_ISSUES";
  return { score, verdict, coverage, counts, invalid_severity: invalid, validation_errors: validationErrors };
}
