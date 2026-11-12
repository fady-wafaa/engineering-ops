// Performance scoring from perf-probe results (docs/SCORING-POLICY.md §5).
//
// LCP / INP / CLS use the published Core Web Vitals "good / needs improvement" boundaries
// (web.dev/vitals). The page-weight, request and server-timing boundaries are engineering-ops
// defaults, marked as such. Times that depend on the product — "action trigger to visible
// result", "SPA navigation to visible content" — are scored ONLY against a budget the project
// documented or the user gave; with no budget they are reported as a measured baseline outside
// the score. Several runs are reduced to the MEDIAN to limit noise.

/** Published Core Web Vitals thresholds. Field assessment uses p75 of field data, not these medians. */
export const CORE_WEB_VITALS = {
  lcp_ms: { good: 2500, poor: 4000, label: "LCP — main content visible" },
  inp_ms: { good: 200, poor: 500, label: "INP — response to interaction" },
  cls: { good: 0.1, poor: 0.25, label: "CLS — layout stability" },
};

/** engineering-ops defaults. Not a published standard; a project budget overrides them. */
export const DEFAULT_THRESHOLDS = {
  fcp_ms: { good: 1800, poor: 3000, label: "FCP — first content" },
  ttfb_ms: { good: 800, poor: 1800, label: "TTFB — server response" },
  tbt_ms: { good: 200, poor: 600, label: "Main-thread blocking (long tasks over 50 ms)" },
  transfer_kb: { good: 1600, poor: 3000, label: "Page weight (transferred)" },
  slowest_api_ms: { good: 1000, poor: 3000, label: "Slowest API call" },
  repeated_requests: { good: 0, poor: 3, label: "Repeated identical requests" },
};

/** Product-specific timings: measured always, scored only against a declared budget. */
export const BUDGETED_METRICS = {
  result_visible_ms: { label: "Action trigger → useful visible result", unit: "ms" },
  spa_navigation_ms: { label: "SPA navigation → useful visible content", unit: "ms" },
};

/** Kept for callers that read the old flat table; the `source` field says where each boundary comes from. */
export const THRESHOLDS = {
  ...Object.fromEntries(Object.entries(CORE_WEB_VITALS).map(([k, v]) => [k, { ...v, wcv: true, source: "core_web_vitals" }])),
  ...Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([k, v]) => [k, { ...v, source: "engineering_ops_default" }])),
  ...Object.fromEntries(Object.entries(BUDGETED_METRICS).map(([k, v]) => [k, { ...v, source: "budget_required" }])),
};

const SCORED_THRESHOLDS = { ...CORE_WEB_VITALS, ...DEFAULT_THRESHOLDS };
const METRIC_KEYS = [...Object.keys(SCORED_THRESHOLDS), ...Object.keys(BUDGETED_METRICS)];

const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 1000) / 1000;
}

const unitOf = (key) => (key === "cls" ? "" : key.endsWith("_kb") ? " KB" : key.endsWith("_ms") ? " ms" : "");

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

/**
 * A budget records where the number came from and what exactly it measures, so a later
 * measurement is only compared with it when the scenario and the summary method agree.
 */
export function normalizeBudget(raw, { metric, kind = "project_budget" } = {}) {
  if (raw == null) return null;
  const value = typeof raw === "number" || typeof raw === "string" ? { max_ms: Number(raw) } : raw;
  const max = Number(value.max_ms ?? value.max ?? value.budget_ms);
  if (!finite(max)) return null;
  const needsImprovement = Number(value.needs_improvement_max_ms ?? value.needs_improvement_max ?? NaN);
  return {
    metric,
    kind: value.kind || kind,
    max_ms: max,
    needs_improvement_max_ms: finite(needsImprovement) ? needsImprovement : null,
    unit: value.unit || "ms",
    source: value.source || (kind === "legacy_default" ? "engineering-ops legacy default (1000 ms), not an approved scenario budget" : "unstated — record where this budget comes from"),
    measure_start: value.measure_start || null,
    measure_end: value.measure_end || null,
    summary: value.summary || "median",
    scenario: value.scenario || null,
  };
}

/**
 * One maximum means met or exceeded. An intermediate score needs a declared
 * needs_improvement_max_ms range — a middle band is never invented here.
 */
export function pointsAgainstBudget(value, budget) {
  if (!finite(value) || !budget) return null;
  if (value <= budget.max_ms) return 2;
  if (budget.needs_improvement_max_ms != null) return value <= budget.needs_improvement_max_ms ? 1 : 0;
  return 0;
}

function budgetedCriterion({ id, label, value, samples, budget, summary }) {
  const base = { id, label, value, source: "local_browser", samples, budget: budget || null, threshold_source: budget ? budget.kind : "none" };
  if (!finite(value)) {
    return budget
      ? { ...base, points: null, status: "required_not_measured", evidence: `لم يُقَس: a budget of ${budget.max_ms} ${budget.unit} is declared (${budget.source}) but the measurement was not taken` }
      : { ...base, points: null, status: "not_measured", evidence: "لم يُقَس: browser/tool did not expose it, or there was no such interaction" };
  }
  if (!budget) {
    return {
      ...base, points: null, status: "measured_no_budget",
      evidence: `baseline: ${summary} of ${samples} run(s) = ${value} ms. No documented or user-given budget, so this is reported outside the score.`,
    };
  }
  const points = pointsAgainstBudget(value, budget);
  const band = budget.needs_improvement_max_ms != null ? `, needs improvement ≤ ${budget.needs_improvement_max_ms} ${budget.unit}` : " (single maximum: met or exceeded)";
  return {
    ...base, points, status: "scored_against_budget",
    evidence: `${summary} of ${samples} run(s) = ${value} ms vs budget ${budget.max_ms} ${budget.unit}${band}. Budget source: ${budget.source}. Measured ${budget.measure_start || "start not stated"} → ${budget.measure_end || "end not stated"}.`,
  };
}

/**
 * Field Core Web Vitals: p75 of field data for the device class, and all three metrics must
 * meet their target. Lab runs never produce this verdict.
 */
export function assessFieldCoreWebVitals(field) {
  if (!field || typeof field !== "object") {
    return { assessed: false, pass: null, reason: "no field data supplied — browser runs are lab data and cannot stand in for it", available: [], percentile: 75 };
  }
  const metrics = field.metrics || {};
  const deviceClass = field.device_class || field.form_factor || "all";
  const read = (key) => {
    const entry = metrics[key];
    if (entry == null) return null;
    if (finite(entry)) return entry;
    const p75 = entry.p75 ?? entry.p75_ms ?? entry.percentiles?.p75 ?? null;
    return finite(p75) ? p75 : null;
  };
  const results = Object.entries(CORE_WEB_VITALS).map(([key, t]) => {
    const p75 = read(key);
    return { id: key, label: t.label, p75, target: t.good, meets_target: finite(p75) ? p75 <= t.good : null };
  });
  const available = results.filter((r) => r.p75 != null).map((r) => r.id);
  const missing = results.filter((r) => r.p75 == null).map((r) => r.id);
  if (missing.length) {
    return {
      assessed: false, pass: null, source: field.source || null, device_class: deviceClass, percentile: 75,
      metrics: results, available, missing,
      reason: `field data incomplete: no p75 for ${missing.join(", ")} — report what is available, do not declare a field pass`,
    };
  }
  return {
    assessed: true, pass: results.every((r) => r.meets_target), source: field.source || null,
    device_class: deviceClass, percentile: 75, metrics: results, available, missing: [],
    reason: null,
  };
}

export function scorePerf(runs, {
  action_ms = null,
  action_budget_ms = undefined,
  budgets = null,
  field = null,
  conditions = null,
} = {}) {
  const per = runs.map(metricsOf);
  const med = {};
  for (const k of METRIC_KEYS) med[k] = median(per.map((p) => p[k]));
  const samplesOf = (k) => per.filter((p) => p[k] != null).length;

  const criteria = Object.entries(SCORED_THRESHOLDS).map(([k, t]) => {
    const v = med[k];
    const source = CORE_WEB_VITALS[k] ? "core_web_vitals" : "engineering_ops_default";
    if (v == null) {
      return { id: k, label: t.label, value: null, points: null, status: "not_measured", source: "local_browser", threshold_source: source, samples: 0, evidence: "لم يُقَس: browser/tool did not expose it, or no interaction/API call" };
    }
    const points = v <= t.good ? 2 : v <= t.poor ? 1 : 0;
    const n = samplesOf(k);
    const note = source === "core_web_vitals" ? " — lab median, not a field Core Web Vitals assessment" : " — engineering-ops default threshold";
    return { id: k, label: t.label, value: v, points, status: "scored", source: "local_browser", threshold_source: source, samples: n, evidence: `median of ${n} measured run(s): ${v}${unitOf(k)} (good ≤ ${t.good}, poor > ${t.poor})${note}` };
  });

  const declared = budgets && typeof budgets === "object" ? budgets : {};
  for (const [k, meta] of Object.entries(BUDGETED_METRICS)) {
    criteria.push(budgetedCriterion({
      id: k, label: meta.label, value: med[k], samples: samplesOf(k), summary: "median",
      budget: normalizeBudget(declared[k], { metric: k }),
    }));
  }

  // Legacy input: {action_ms, action_budget_ms}. Still read; the default 1000 ms is marked
  // as a legacy default so a report never shows it as an approved scenario budget.
  if (action_ms != null) {
    const explicit = declared.action_ms ?? (action_budget_ms !== undefined ? action_budget_ms : null);
    const budget = normalizeBudget(explicit ?? 1000, { metric: "action_ms", kind: declared.action_ms ? "project_budget" : "legacy_default" });
    criteria.push(budgetedCriterion({
      id: "action_ms", label: "Named user action, trigger → visible result",
      value: Number(action_ms), samples: 1, summary: "supplied value", budget,
    }));
  }

  const labCwv = ["lcp_ms", "inp_ms", "cls"].map((k) => criteria.find((c) => c.id === k));
  const fieldCwv = assessFieldCoreWebVitals(field);

  return {
    runs: runs.length,
    conditions,
    median: med,
    criteria,
    scored_criteria: criteria.filter((c) => c.points != null).map((c) => c.id),
    baselines: criteria.filter((c) => c.status === "measured_no_budget").map((c) => ({ id: c.id, value: c.value, samples: c.samples, reason: "no documented budget" })),
    owed_measurements: criteria.filter((c) => c.status === "required_not_measured").map((c) => ({ id: c.id, budget: c.budget, reason: "budget declared, measurement not taken" })),
    unavailable: criteria.filter((c) => c.points == null).map((c) => ({ id: c.id, status: c.status, reason: c.evidence })),
    lab_core_web_vitals: {
      basis: "lab_median",
      runs: runs.length,
      all_good: labCwv.every((c) => c.points === 2) ? true : labCwv.some((c) => c.points === 0) ? false : null,
      metrics: labCwv.map((c) => ({ id: c.id, value: c.value, points: c.points })),
      note: "Lab medians from this machine. Not a Core Web Vitals field assessment: that needs p75 of field data for the device class.",
    },
    core_web_vitals_field: fieldCwv,
    // Field verdict only. Successful browser runs never set this.
    core_web_vitals_pass: fieldCwv.assessed ? fieldCwv.pass : null,
    note: runs.length < 3 ? "Fewer than 3 runs: numbers are noisy." : null,
  };
}
