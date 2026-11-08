// Audit scoring — one rule for every auditor (references/audit-contract.md).
// The model supplies criteria points and findings with evidence; the score and verdict
// are computed here so they are consistent and cannot drift between agents.

export const SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"];

export function scoreAudit({ criteria = [], findings = [], min_coverage = 0.5, total_criteria } = {}) {
  const tested = criteria.filter((c) => c.points === 0 || c.points === 1 || c.points === 2);
  const total = Number(total_criteria) || criteria.length;
  const earned = tested.reduce((s, c) => s + c.points, 0);
  const coverage = { tested: tested.length, total, ratio: total ? tested.length / total : 0 };
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of findings) {
    const sev = SEVERITIES.find((s) => s.toLowerCase() === String(f.severity || "").toLowerCase());
    if (sev) counts[sev]++;
  }
  const invalid = findings.filter((f) => !SEVERITIES.some((s) => s.toLowerCase() === String(f.severity || "").toLowerCase())).map((f) => f.id || f.title);

  if (tested.length === 0) return { score: null, verdict: "BLOCKED", coverage, counts, invalid_severity: invalid, reason: "no criterion could be tested" };
  const score = Math.round((100 * earned) / (2 * tested.length));
  if (coverage.ratio < min_coverage) {
    return { score: null, verdict: "INSUFFICIENT_COVERAGE", coverage, counts, invalid_severity: invalid, reason: `tested ${tested.length}/${total}, minimum ${Math.ceil(min_coverage * total)}` };
  }
  let verdict;
  if (counts.Critical > 0 || score < 60) verdict = "FAIL";
  else if (score >= 85 && counts.High === 0) verdict = "PASS";
  else verdict = "PASS_WITH_ISSUES";
  return { score, verdict, coverage, counts, invalid_severity: invalid };
}
