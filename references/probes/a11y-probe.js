() => {
  // Engineering Ops accessibility probe (WCAG 2.2 AA subset). Read-only: inspects the DOM
  // and computed styles, changes nothing, sends nothing. Pass this whole file as the
  // `function` of the Playwright browser "evaluate" tool. Returns a compact JSON summary.
  const MAX = 15;
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const selectorOf = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) {
      let p = n.tagName.toLowerCase();
      const testId = n.getAttribute("data-testid");
      if (testId) { parts.unshift(`[data-testid="${testId}"]`); break; }
      if (n.classList.length) p += "." + [...n.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".");
      parts.unshift(p);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const nameOf = (el) => {
    const byIds = (ids) => ids.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(" ");
    if (el.getAttribute("aria-labelledby")) return byIds(el.getAttribute("aria-labelledby"));
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) return text(lab);
    }
    const wrap = el.closest("label");
    if (wrap) return text(wrap);
    if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
    if (el.tagName === "INPUT" && ["submit", "button", "reset"].includes(el.type)) return el.value || "";
    const t = text(el) || [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join(" ");
    return t || el.getAttribute("title") || el.getAttribute("placeholder") || "";
  };
  const push = (arr, item) => { if (arr.length < MAX) arr.push(item); };

  // Colour contrast (1.4.3): text colour vs first opaque background up the tree.
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage && s.backgroundImage !== "none") return null; const c = parse(s.backgroundColor); if (c && c.a >= 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };

  const result = { url: location.href, title: document.title, lang: document.documentElement.lang || null, dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction, viewport: { w: innerWidth, h: innerHeight },
    method_note: "Computed names, contrast and target sizes are candidates; verify in the accessibility tree and rendered UI. Live-region count does not prove announcement." };

  const imgs = [...document.querySelectorAll("img")].filter(visible);
  result.images = { total: imgs.length, missing_alt: [] };
  for (const i of imgs) if (!i.hasAttribute("alt")) push(result.images.missing_alt, selectorOf(i));

  const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea, [role=combobox], [role=textbox]")].filter(visible);
  result.form_fields = { total: fields.length, no_name: [], placeholder_only: [] };
  for (const f of fields) {
    const n = nameOf(f);
    if (!n) push(result.form_fields.no_name, selectorOf(f));
    else if (!f.getAttribute("aria-label") && !f.getAttribute("aria-labelledby") && !(f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)) && !f.closest("label") && n === f.getAttribute("placeholder")) push(result.form_fields.placeholder_only, selectorOf(f));
  }

  const controls = [...document.querySelectorAll("button, a[href], [role=button], [role=link], [role=tab], [role=menuitem]")].filter(visible);
  result.controls = { total: controls.length, no_name: [], small_targets: [] };
  for (const c of controls) {
    if (!nameOf(c)) push(result.controls.no_name, selectorOf(c));
    const r = c.getBoundingClientRect();
    if ((r.width < 24 || r.height < 24) && getComputedStyle(c).display !== "inline") push(result.controls.small_targets, `${selectorOf(c)} (${Math.round(r.width)}×${Math.round(r.height)})`);
  }

  const clickables = [...document.querySelectorAll("div[onclick], span[onclick], [tabindex]")].filter(visible);
  result.focus = { positive_tabindex: [], non_focusable_clickables_hint: "use keyboard walkthrough to confirm" };
  for (const c of clickables) if (Number(c.getAttribute("tabindex")) > 0) push(result.focus.positive_tabindex, selectorOf(c));

  const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(visible).map((h) => ({ level: Number(h.getAttribute("aria-level") || h.tagName.slice(1)) || 2, text: text(h).slice(0, 60) }));
  result.headings = { count: hs.length, h1: hs.filter((h) => h.level === 1).length, skipped_levels: [] };
  for (let i = 1; i < hs.length; i++) if (hs[i].level > hs[i - 1].level + 1) push(result.headings.skipped_levels, `${hs[i - 1].level}→${hs[i].level} "${hs[i].text}"`);

  result.landmarks = {
    main: document.querySelectorAll("main,[role=main]").length,
    nav: document.querySelectorAll("nav,[role=navigation]").length,
    header: document.querySelectorAll("header,[role=banner]").length,
    footer: document.querySelectorAll("footer,[role=contentinfo]").length,
  };

  const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
  result.duplicate_ids = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))].slice(0, MAX);

  const textEls = [...document.querySelectorAll("p,span,a,button,label,li,td,th,h1,h2,h3,h4,h5,h6,small,strong,em,div")].filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  result.contrast = { checked: 0, failures: [], unknown_background: 0 };
  for (const e of textEls.slice(0, 600)) {
    const s = getComputedStyle(e);
    const fg = parse(s.color);
    const bg = bgOf(e);
    if (!fg) continue;
    if (!bg) { result.contrast.unknown_background++; continue; }
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    result.contrast.checked++;
    if (ratio < need) push(result.contrast.failures, `${selectorOf(e)} "${text(e).slice(0, 30)}" ${ratio.toFixed(2)}:1 (needs ${need}:1)`);
  }

  result.live_regions = document.querySelectorAll("[aria-live],[role=status],[role=alert]").length;
  result.viewport_meta = document.querySelector("meta[name=viewport]")?.getAttribute("content") || null;
  result.horizontal_scroll = document.documentElement.scrollWidth > innerWidth + 1;
  return result;
}
