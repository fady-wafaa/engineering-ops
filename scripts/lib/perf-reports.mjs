import { median } from "./perf.mjs";

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const percentile = (values, p) => {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
};
const distribution = (values) => ({ samples: values.filter(finite).length, p50_ms: median(values), p95_ms: percentile(values, .95), p99_ms: percentile(values, .99) });

export function parsePerfReport(type, data) {
  if (type === "crux") {
    const record = data.record || data;
    const key = record.key || {};
    const metrics = record.metrics || {};
    if (!Object.keys(metrics).length) throw new Error("CrUX record.metrics is missing");
    return { source: "CrUX", scope: key.url ? "page" : key.origin ? "origin" : "unknown", target: key.url || key.origin || null,
      collection_period: record.collectionPeriod || null,
      metrics: Object.fromEntries(Object.entries(metrics).map(([name, item]) => [name, { p75: item.percentiles?.p75 ?? null, histogram: item.histogram || null }])),
      note: "Field data, independent of local browser runs; p75 is not a local median." };
  }
  if (type === "rum") {
    if (!data.scope || !data.metrics) throw new Error("RUM report needs scope and metrics");
    return { source: "RUM", scope: data.scope, target: data.url || data.origin || null, period: data.period || null,
      metrics: Object.fromEntries(Object.entries(data.metrics).map(([name, values]) => [name, Array.isArray(values) ? distribution(values) : values])),
      note: "Field data, independent of local browser runs." };
  }
  if (type === "k6") {
    const metrics = data.metrics;
    if (!metrics || !metrics.http_req_duration) throw new Error("k6 summary needs metrics.http_req_duration");
    const duration = metrics.http_req_duration.values || {};
    const failed = metrics.http_req_failed?.values || {};
    const requests = metrics.http_reqs?.values || {};
    const durationSeconds = data.duration_seconds ?? null;
    return { source: "k6_import", scope: "load_test", target: data.target || null,
      http_req_duration: { p50_ms: duration["p(50)"] ?? duration.med ?? null, p95_ms: duration["p(95)"] ?? null, p99_ms: duration["p(99)"] ?? null, samples: duration.count ?? requests.count ?? null },
      error_rate: failed.rate ?? null, request_count: requests.count ?? null,
      request_rate_per_second: requests.rate ?? null,
      iterations: metrics.iterations?.values?.count ?? null, vus_max: metrics.vus_max?.values?.max ?? null,
      dropped_iterations: metrics.dropped_iterations?.values?.count ?? null,
      duration_seconds: durationSeconds, thresholds: Object.fromEntries(Object.entries(metrics).filter(([, m]) => m.thresholds).map(([name, m]) => [name, m.thresholds])),
      capacity_status: data.workload && data.environment && durationSeconds != null && metrics.vus_max?.values?.max != null ? "context_available_for_review" : "لم يُقَس: workload, environment, duration and VU context required",
      endurance_status: durationSeconds != null && Array.isArray(data.time_series) ? "time_series_available_for_review" : "لم يُقَس: duration and time-series report required",
      note: "Imported load-test results; this command does not generate traffic. A summary alone cannot prove saturation or endurance." };
  }
  if (type === "server") {
    if (!Array.isArray(data.requests)) throw new Error("server report needs requests array");
    const groups = new Map();
    for (const r of data.requests) {
      const key = r.route || r.endpoint || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return { source: "server_report", scope: "api", period: data.period || null,
      routes: [...groups].map(([route, rows]) => ({ route, ...distribution(rows.map((r) => r.duration_ms)),
        error_count: rows.filter((r) => Number(r.status) >= 500 || r.error === true).length,
        error_rate: rows.filter((r) => Number(r.status) >= 500 || r.error === true).length / rows.length,
        database: distribution(rows.map((r) => r.db_ms)),
        traces: rows.filter((r) => r.trace_id || r.report_url).map((r) => ({ trace_id: r.trace_id || null, report_url: r.report_url || null,
          duration_ms: r.duration_ms ?? null, db_ms: r.db_ms ?? null })).slice(0, 20) })),
      note: "Server and database attribution requires a linked trace or report. Aggregate timing alone does not prove the cause." };
  }
  throw new Error(`Unknown performance report type: ${type}`);
}

const CONDITION_KEYS = ["target", "scenario", "device", "viewport", "network", "throttling", "build", "environment", "cache", "role"];
export function comparePerformance(before, after) {
  const a = before?.conditions || {}, b = after?.conditions || {};
  const mismatches = CONDITION_KEYS.filter((key) => !a[key] || !b[key] || JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  if (mismatches.length) return { comparable: false, reasons: mismatches.map((key) => `${key}: missing or different`) };
  const metrics = {};
  for (const [key, value] of Object.entries(after.median || {})) {
    const old = before.median?.[key];
    if (finite(value) && finite(old)) metrics[key] = { before: old, after: value, delta: value - old };
  }
  return { comparable: true, metrics };
}
