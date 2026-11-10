// Performance scoring from perf-probe results. Thresholds are the published Core Web
// Vitals "good / needs improvement" boundaries (web.dev/vitals) plus simple page-weight and
// request rules. Several runs are reduced to the MEDIAN to limit noise.

export const THRESHOLDS = {
  lcp_ms: { good: 2500, poor: 4000, wcv: true, label: "LCP — main content visible" },
  inp_ms: { good: 200, poor: 500, wcv: true, label: "INP — response to interaction" },
  cls: { good: 0.1, poor: 0.25, wcv: true, label: "CLS — layout stability" },
  fcp_ms: { good: 1800, poor: 3000, label: "FCP — first content" },
  ttfb_ms: { good: 800, poor: 1800, label: "TTFB — server response" },
  tbt_ms: { good: 200, poor: 600, label: "Main-thread blocking (long tasks over 50 ms)" },
  transfer_kb: { good: 1600, poor: 3000, label: "Page weight (transferred)" },
  slowest_api_ms: { good: 1000, poor: 3000, label: "Slowest API call" },
  repeated_requests: { good: 0, poor: 3, label: "Repeated identical requests" },
  result_visible_ms: { good: 1000, poor: 3000, label: "Action trigger → useful visible result" },
  spa_navigation_ms: { good: 1000, poor: 3000, label: "SPA navigation → useful visible content" },
};

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 1000) / 1000;
}

function metricsOf(run) {
  return {
    lcp_ms: run.web_vitals?.lcp_ms ?? null,
    inp_ms: run.web_vitals?.inp_ms ?? null,
    cls: run.web_vitals?.cls ?? null,
    fcp_ms: run.web_vitals?.fcp_ms ?? null,
    ttfb_ms: run.navigation?.ttfb_ms ?? null,
    tbt_ms: run.long_tasks ? run.long_tasks.total_blocking_ms : null,
    transfer_kb: run.resources?.transfer_kb ?? null,
    slowest_api_ms: run.resources?.api_calls?.count ? run.resources.api_calls.slowest_ms : null,
    repeated_requests: run.resources ? (run.resources.repeated || []).reduce((s, r) => s + (r.times - 1), 0) : null,
    result_visible_ms: run.action?.result_visible_ms ?? null,
    spa_navigation_ms: run.spa_navigation?.result_visible_ms ?? null,
  };
}

export function scorePerf(runs, { action_ms = null, action_budget_ms = 1000, conditions = null } = {}) {
  const per = runs.map(metricsOf);
  const med = {};
  for (const k of Object.keys(THRESHOLDS)) med[k] = median(per.map((p) => p[k]));
  const criteria = Object.entries(THRESHOLDS).map(([k, t]) => {
    const v = med[k];
    if (v == null) return { id: k, label: t.label, value: null, points: null, source: "local_browser", samples: 0, evidence: "لم يُقَس: browser/tool did not expose it, or no interaction/API call" };
    const points = v <= t.good ? 2 : v <= t.poor ? 1 : 0;
    const n = per.filter((p) => p[k] != null).length;
    return { id: k, label: t.label, value: v, points, source: "local_browser", samples: n, evidence: `median of ${n} measured run(s): ${v}${k === "cls" ? "" : k.endsWith("_kb") ? " KB" : k.endsWith("_ms") ? " ms" : ""} (good ≤ ${t.good}, poor > ${t.poor})` };
  });
  if (action_ms != null) {
    const v = Number(action_ms);
    criteria.push({ id: "action_ms", label: "Named user action, trigger → visible result", value: v, points: v <= action_budget_ms ? 2 : v <= action_budget_ms * 3 ? 1 : 0, evidence: `${v} ms (budget ${action_budget_ms} ms)` });
  }
  const cwv = ["lcp_ms", "inp_ms", "cls"].map((k) => criteria.find((c) => c.id === k));
  const cwvPass = cwv.every((c) => c.points === 2) ? true : cwv.some((c) => c.points === 0) ? false : null;
  return { runs: runs.length, conditions, median: med, criteria, unavailable: criteria.filter((c) => c.points == null).map((c) => ({ id: c.id, reason: c.evidence })), core_web_vitals_pass: cwvPass, note: runs.length < 3 ? "Fewer than 3 runs: numbers are noisy." : null };
}
