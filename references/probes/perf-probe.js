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

  // Install before the action. Buffered Event Timing alone can miss fast interactions.
  const firstRun = !window.__engopsEventObserver;
  if (firstRun) {
    window.__engopsMeasure = {
      action: null, spa: null,
      startAction(label) { this.action = { label, started: performance.now(), result_visible_ms: null, selector: null }; },
      finishAction(selector) {
        if (!this.action || !document.querySelector(selector)) return false;
        this.action.result_visible_ms = Math.round(performance.now() - this.action.started);
        this.action.selector = selector;
        return true;
      },
      startNavigation(label) { this.spa = { label, started: performance.now(), result_visible_ms: null, selector: null }; },
      finishNavigation(selector) {
        if (!this.spa || !document.querySelector(selector)) return false;
        this.spa.result_visible_ms = Math.round(performance.now() - this.spa.started);
        this.spa.selector = selector;
        return true;
      },
    };
    window.__engopsScroll = { gaps_ms: [], last: null };
    window.addEventListener("scroll", () => {
      const s = window.__engopsScroll, now = performance.now();
      if (s.last != null && now - s.last < 1000) s.gaps_ms.push(now - s.last);
      s.last = now;
      if (s.gaps_ms.length > 1000) s.gaps_ms.shift();
    }, { passive: true });
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
  const interactions = [...byInteraction.values()].sort((a, b) => b - a);
  const slowestInteraction = interactions.length ? interactions[0] : null;
  // INP uses the worst interaction, discarding one outlier per 50 interactions.
  // The value is provisional until page exit and only includes observed interactions.
  if (interactions.length && !firstRun) inp = interactions[Math.floor(interactions.length / 50)] ?? interactions[0];
  const inpNote =
    inp != null ? `provisional lab INP from ${byInteraction.size} observed interaction(s); observer installed before action`
    : window.__engopsEventObserver === "unsupported" ? "Event Timing not supported in this browser"
    : firstRun ? "interaction observer installed now: interact with the page, then run the probe again"
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
  const request = (r) => ({
    url: shortUrl(r.name), type: r.initiatorType, start_ms: round(r.startTime), duration_ms: round(r.duration),
    response_status: r.responseStatus || null, transfer_kb: kb(r.transferSize),
    cache: r.transferSize > 0 ? "network_or_revalidated" : r.decodedBodySize > 0 ? "local_cache_or_service_worker" : "unknown",
    server_timing: (r.serverTiming || []).map((t) => ({ name: t.name, duration_ms: round(t.duration), description: t.description || null })),
  });

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
      observed_slowest_interaction_ms: round(slowestInteraction),
      interaction_count: byInteraction.size,
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
      timeline: [...res].sort((a, b) => a.startTime - b.startTime).map(request),
    },
    server_timing: (nav?.serverTiming || []).map((t) => ({ name: t.name, duration_ms: round(t.duration), description: t.description || null })),
    action: window.__engopsMeasure?.action ? { label: window.__engopsMeasure.action.label, result_visible_ms: window.__engopsMeasure.action.result_visible_ms, result_selector: window.__engopsMeasure.action.selector } : null,
    spa_navigation: window.__engopsMeasure?.spa ? { label: window.__engopsMeasure.spa.label, result_visible_ms: window.__engopsMeasure.spa.result_visible_ms, result_selector: window.__engopsMeasure.spa.selector } : null,
    scroll: window.__engopsScroll ? { observed_events: window.__engopsScroll.gaps_ms.length, gaps_over_50ms: window.__engopsScroll.gaps_ms.filter((n) => n > 50).length, longest_gap_ms: round(Math.max(0, ...window.__engopsScroll.gaps_ms)), note: "scroll event gaps are diagnostic, not frame timing" } : null,
    js_heap_mb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    dom_nodes: document.getElementsByTagName("*").length,
  };
}
