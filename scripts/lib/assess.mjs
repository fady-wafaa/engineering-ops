// Deterministic first-pass Card Check (READY / MISSING_INFO).
//
// Rules come from the original watcher's step 7a. The audit found one gap (D1): the
// pipeline knows BUG / FEATURE / MIXED, but the watcher only knew BUG / FEATURE / UNCLEAR.
// Here MIXED (clear bug AND feature labels) must satisfy the union of the existing BUG and
// FEATURE items; no new requirement is invented. UNCLEAR means no reliable type signal.
//
// This is a keyword heuristic. It only ever reports an item as present when matching text
// exists in the card. The skill lets the model make a result STRICTER, or mark an item
// present only by quoting the exact card text. It never fills in content.

const GENERIC_TITLES = new Set(["fix", "bug", "update", "issue", "task", "todo", "change", "feature", "test", "new"]);

const LABEL_BUG = /\b(bug|defect|hotfix|regression|incident|error)\b/i;
const LABEL_FEATURE = /\b(feature|enhancement|story|improvement|user story|epic)\b/i;

const TEXT_BUG = /\b(bug|fix(es|ed)?|broken|error|crash(es|ed)?|fails?|failing|not working|doesn'?t work|wrong|incorrect|regression)\b|مشكلة|مشكله|خطأ|عطل|لا يعمل|مش شغال/i;
const TEXT_FEATURE = /\b(add|feature|implement|support|allow|enable|new|create|build|introduce|ability)\b|إضافة|اضافة|ميزة|ميزه/i;

const AREA = /\b(page|screen|modal|dialog|popup|tab|form|table|grid|list|button|menu|sidebar|navbar|header|footer|dashboard|view|component|endpoint|api|route|report|module|filter|column|field|settings|login|sign[- ]?in|checkout|cart|profile|search|upload|export|import|invoice|order|saved search|suitelet|record|workflow)\b|\/[a-z][\w-]*|صفحة|صفحه|شاشة|شاشه|قائمة/i;

const REPRO = /(steps to reproduce|to reproduce|repro|reproduc|steps:|how to reproduce|خطوات)/i;
const NUMBERED_STEPS = /^(\s*(\d+[.)]|[-*•])\s+\S.*\n){1,}\s*(\d+[.)]|[-*•])\s+\S/m;
const EXPECTED = /(expected|should (show|be|display|return|work|open|save)|المتوقع|المفروض|يجب)/i;
const ACTUAL = /(actual|currently|instead|but it|it shows|now shows|الفعلي|حاليا|حالياً|بدل)/i;

const WANTED = /(as an? \w+|user (should|can|must)|users? (should|can) be able|be able to|able to|want(s)? to|so that|allow(s)? (the )?users?|enable(s)? users?|المستخدم|يقدر|يستطيع|يمكن)/i;
const ACCEPTANCE = /(acceptance criteria|\bac\s*[:\d]|done when|definition of done|\bdod\b|معايير القبول|يعتبر منتهي)/i;

export const ITEM_LABELS = {
  title_clear: "Clear title",
  description_present: "Description",
  type_clear: "Task type (BUG or FEATURE)",
  area_named: "Screen or area of the app",
  repro_steps: "Steps to reproduce",
  expected_result: "Expected result",
  actual_result: "Actual result",
  wanted_behavior: "What the user should be able to do",
  acceptance_criteria: "Acceptance criteria (how we know it is done)",
};

function labelNames(card) {
  return [...(card.labels || [])].map((l) => (typeof l === "string" ? l : l?.name || "")).filter(Boolean);
}

function checklistItems(card) {
  return (card.checklists || []).flatMap((cl) => cl.items || cl.checkItems || []);
}

export function classify(card) {
  const labels = labelNames(card).join(" ");
  const labelBug = LABEL_BUG.test(labels);
  const labelFeature = LABEL_FEATURE.test(labels);
  if (labelBug && labelFeature) return { type: "MIXED", source: "labels" };
  if (labelBug) return { type: "BUG", source: "labels" };
  if (labelFeature) return { type: "FEATURE", source: "labels" };

  const title = String(card.name || "");
  const bug = TEXT_BUG.test(title);
  const feature = TEXT_FEATURE.test(title);
  if (bug && !feature) return { type: "BUG", source: "title" };
  if (feature && !bug) return { type: "FEATURE", source: "title" };
  // Conflicting or no words in the title: an ambiguous task is not guessed.
  return { type: "UNCLEAR", source: bug && feature ? "conflicting title words" : "no type signal" };
}

// First meaningful sentence: skips headings ("Steps to reproduce:"), list items and
// very short fragments, so the summary describes the problem, not the template.
function firstSentence(text, max = 160) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/:\s*$/.test(l) && !/^(\d+[.)]|[-*•#>])\s*/.test(l) && !REPRO.test(l.slice(0, 25)));
  const t = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.{15,}?[.!?؟])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function assessCard(card) {
  const title = String(card.name || "").trim();
  const desc = String(card.desc || "").replace(/\r\n/g, "\n").trim();
  const items = checklistItems(card);
  const checklistText = items.map((i) => i.name || "").join("\n");
  const all = `${title}\n${desc}\n${checklistText}`;
  const { type, source } = classify(card);

  const words = title.split(/\s+/).filter(Boolean);
  const present = {
    title_clear: words.length >= 3 && title.length >= 10 && !(words.length <= 2 && GENERIC_TITLES.has(words[0]?.toLowerCase())),
    description_present: desc.replace(/\s+/g, "").length >= 15,
    type_clear: type !== "UNCLEAR",
    area_named: AREA.test(all),
  };

  const needsBug = type === "BUG" || type === "MIXED";
  const needsFeature = type === "FEATURE" || type === "MIXED";
  if (needsBug) {
    present.repro_steps = REPRO.test(desc) || NUMBERED_STEPS.test(desc + "\n");
    present.expected_result = EXPECTED.test(desc);
    present.actual_result = ACTUAL.test(desc);
  }
  if (needsFeature) {
    present.wanted_behavior = WANTED.test(`${title}\n${desc}`);
    present.acceptance_criteria = ACCEPTANCE.test(all) || items.length > 0;
  }

  const missing = Object.entries(present)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  const readiness = missing.length === 0 ? "READY" : "MISSING_INFO";
  const missingLabels = missing.map((k) => ITEM_LABELS[k]);

  return {
    type,
    type_source: source,
    readiness,
    missing,
    missing_labels: missingLabels,
    checked: Object.keys(present),
    summary: firstSentence(desc) || title,
    next_action:
      readiness === "READY"
        ? "Ready for intake. Choose 'Analyze a card' in /engineering-ops:engineering."
        : `Ask the card owner for: ${missingLabels.join(", ")}.`,
    method: "keyword-heuristic-v1",
  };
}
