// Fast, free pre-check of a task request (#7). Scores 5 axes, 0-2 each (max 10):
// goal, context, constraints, success criteria, output format.
// If the score is high enough, the prompt-refiner agent is skipped (saves tokens).
// It only detects what is written; it never fills anything in.

const AXES = {
  goal: {
    label: "Clear goal (what to do)",
    strong: /\b(fix|add|implement|create|build|remove|refactor|migrate|update|change|investigate|analy[sz]e|review|audit|explain|write|optimi[sz]e)\b|اصلاح|إصلاح|اضافة|إضافة|اعمل|عايز|حلل|راجع/i,
    hint: "Say the one main thing you want done, starting with a verb.",
  },
  context: {
    label: "Context (where / which part)",
    strong: /(\/[\w.-]+\/|[\w-]+\.(tsx?|jsx?|py|go|java|cs|rb|php|vue|svelte|xml)\b|\b(page|screen|component|endpoint|api|route|module|service|table|function|class|suitelet|restlet|saved search|record)\b|https?:\/\/|صفحة|شاشة)/i,
    hint: "Name the page, file, component, endpoint or card link.",
  },
  constraints: {
    label: "Constraints (limits / rules)",
    strong: /\b(must|must not|don'?t|do not|never|only|without|keep|avoid|limit|no more than|backward compat|read-only|deadline|before)\b|لا تـ?|ممنوع|بدون|فقط|لازم/i,
    hint: "Add limits: what must not change, versions, time, read-only, etc.",
  },
  success: {
    label: "Success criteria (how we know it is done)",
    strong: /(acceptance criteria|expected|should (show|return|be|work)|done when|so that|test(s)? pass|verify|result should|المتوقع|معايير القبول|يعتبر منتهي)/i,
    hint: "Say what the result should look like, or which test proves it.",
  },
  output: {
    label: "Output format (what to give back)",
    strong: /\b(report|table|list|summary|steps|diff|pr|pull request|markdown|json|csv|plan|checklist|bullet|code only|explain)\b|تقرير|جدول|خطة|ملخص/i,
    hint: "Say what you want back: a plan, a diff, a report, a table…",
  },
};

export function scorePrompt(text) {
  const t = String(text || "").trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const axes = {};
  let total = 0;
  for (const [key, a] of Object.entries(AXES)) {
    const matches = (t.match(new RegExp(a.strong.source, "gi")) || []).length;
    // 2 = clearly present (2+ signals, or 1 signal in a long enough request), 1 = weak, 0 = absent
    const points = matches >= 2 || (matches === 1 && words >= 25) ? 2 : matches === 1 ? 1 : 0;
    axes[key] = { label: a.label, points, hint: points < 2 ? a.hint : null };
    total += points;
  }
  if (words < 6) total = Math.min(total, 3); // a few words cannot be a complete request
  const missing = Object.entries(axes).filter(([, a]) => a.points === 0).map(([, a]) => a.label);
  const weak = Object.entries(axes).filter(([, a]) => a.points === 1).map(([, a]) => a.label);
  const verdict = total >= 8 ? "GOOD" : total >= 6 ? "OK_WITH_GAPS" : "NEEDS_IMPROVEMENT";
  return {
    ok: true,
    score: total,
    max: 10,
    words,
    verdict,
    run_refiner: total < 7,
    axes,
    missing,
    weak,
    method: "keyword-heuristic-v1",
  };
}
