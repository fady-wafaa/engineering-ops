async () => {
  // Engineering Ops performance probe. Read-only: reads the browser's Performance APIs,
  // changes nothing, sends nothing. Pass this whole file as the `function` of the
  // Playwright browser "evaluate" tool, after the page (or the interaction) finished.
  // Values the browser does not expose are returned as null — never estimated.
  const round = (n) => (n == null ? null : Math.round(n));
  const kb = (n) => (n == null ? null : Math.round(n / 1024));
  const observe = (type) =>
    new Promise((resolve) => {
      const entries = [];
      try {
        const po = new PerformanceObserver((list) => entries.push(...list.getEntries()));
        po.observe({ type, buffered: true });
        setTimeout(() => { po.disconnect(); resolve(entries); }, 150);
      } catch {
        resolve(null); // entry type not supported in this browser
      }
    });

  const [lcpEntries, shiftEntries, longTasks, eventEntries] = await Promise.all([
    observe("largest-contentful-paint"),
    observe("layout-shift"),
    observe("longtask"),
    observe("event"),
  ]);

  const nav = performance.getEntriesByType("navigation")[0] || null;
  const fcp = performance.getEntriesByName("first-contentful-paint")[0] || null;
  const lcp = lcpEntries && lcpEntries.length ? lcpEntries[lcpEntries.length - 1] : null;

  // CLS: largest session window (gap < 1 s, window < 5 s), ignoring shifts after input.
  let cls = null;
  if (shiftEntries) {
    let max = 0, cur = 0, start = 0, last = 0;
    for (const e of shiftEntries) {
      if (e.hadRecentInput) continue;
      if (cur && (e.startTime - last > 1000 || e.startTime - start > 5000)) { cur = 0; start = e.startTime; }
      if (!cur) start = e.startTime;
      cur += e.value;
      last = e.startTime;
      max = Math.max(max, cur);
    }
    cls = Math.round(max * 1000) / 1000;
  }

  // INP-like: the slowest interaction seen so far. Browsers only BUFFER event entries of
  // >= 104 ms, so a fast (good) interaction is invisible to a later read. The first run
  // therefore installs a persistent observer with a 16 ms threshold; later runs read it.
  const firstRun = !window.__engopsEventObserver;
  if (firstRun) {
    window.__engopsEvents = [];
    try {
      window.__engopsEventObserver = new PerformanceObserver((list) => window.__engopsEvents.push(...list.getEntries()));
      window.__engopsEventObserver.observe({ type: "event", durationThreshold: 16, buffered: true });
    } catch {
      window.__engopsEventObserver = "unsupported";
    }
  }
  let inp = null;
  const allEvents = [...(eventEntries || []), ...(window.__engopsEvents || [])];
  const byInteraction = new Map();
  for (const e of allEvents) if (e.interactionId) byInteraction.set(e.interactionId, Math.max(byInteraction.get(e.interactionId) || 0, e.duration));
  if (byInteraction.size) inp = Math.max(...byInteraction.values());
  const inpNote =
    inp != null ? `slowest of ${byInteraction.size} interaction(s) so far (lab value)`
    : window.__engopsEventObserver === "unsupported" ? "Event Timing not supported in this browser"
    : firstRun ? "interaction observer installed now: interact with the page, then run the probe again (no interaction >= 104 ms was buffered before)"
    : "no interaction recorded since the observer was installed";

  const res = performance.getEntriesByType("resource");
  const byType = {};
  for (const r of res) {
    const t = r.initiatorType || "other";
    byType[t] = byType[t] || { count: 0, transfer_kb: 0 };
    byType[t].count++;
    byType[t].transfer_kb += kb(r.transferSize) || 0;
  }
  const counts = new Map();
  for (const r of res) {
    const u = r.name.split("#")[0];
    counts.set(u, (counts.get(u) || 0) + 1);
  }
  const shortUrl = (u) => { try { const x = new URL(u); return (x.origin === location.origin ? "" : x.host) + x.pathname + (x.search ? "?…" : ""); } catch { return u.slice(0, 120); } };
  const api = res.filter((r) => r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest");

  return {
    url: location.href,
    measured_at: new Date().toISOString(),
    viewport: { w: innerWidth, h: innerHeight },
    connection: navigator.connection ? { type: navigator.connection.effectiveType, downlink_mbps: navigator.connection.downlink, save_data: navigator.connection.saveData } : null,
    navigation: nav ? {
      type: nav.type,
      ttfb_ms: round(nav.responseStart - nav.startTime),
      dom_content_loaded_ms: round(nav.domContentLoadedEventEnd - nav.startTime),
      load_ms: round(nav.loadEventEnd ? nav.loadEventEnd - nav.startTime : null),
      document_transfer_kb: kb(nav.transferSize),
    } : null,
    web_vitals: {
      fcp_ms: round(fcp?.startTime),
      lcp_ms: round(lcp?.startTime),
      lcp_element: lcp?.element ? (lcp.element.tagName.toLowerCase() + (lcp.element.id ? "#" + lcp.element.id : "") + (lcp.url ? ` ${shortUrl(lcp.url)}` : "")) : null,
      cls,
      inp_ms: round(inp),
      inp_note: inpNote,
    },
    long_tasks: longTasks ? { count: longTasks.length, total_blocking_ms: round(longTasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0)), longest_ms: round(Math.max(0, ...longTasks.map((t) => t.duration))) } : null,
    resources: {
      count: res.length,
      transfer_kb: res.reduce((s, r) => s + (kb(r.transferSize) || 0), 0),
      by_type: byType,
      slowest: [...res].sort((a, b) => b.duration - a.duration).slice(0, 8).map((r) => ({ url: shortUrl(r.name), type: r.initiatorType, ms: round(r.duration), kb: kb(r.transferSize) })),
      largest: [...res].sort((a, b) => b.transferSize - a.transferSize).slice(0, 8).map((r) => ({ url: shortUrl(r.name), type: r.initiatorType, kb: kb(r.transferSize), ms: round(r.duration) })),
      repeated: [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([u, n]) => ({ url: shortUrl(u), times: n })),
      api_calls: { count: api.length, slowest_ms: round(Math.max(0, ...api.map((r) => r.duration))) },
      cross_origin_without_timing: res.filter((r) => r.transferSize === 0 && r.decodedBodySize === 0 && !r.name.startsWith(location.origin)).length,
    },
    js_heap_mb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    dom_nodes: document.getElementsByTagName("*").length,
  };
}
