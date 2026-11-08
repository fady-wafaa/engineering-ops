// Static scan rules. Each hit is a CANDIDATE: the agent must read the code and confirm it
// (reachable, user-controlled input, real impact) before reporting it as a finding.
// Security rules map to OWASP Top 10:2025 (https://owasp.org/Top10/2025/).
// Accessibility rules map to WCAG 2.2 success criteria.

const JS = ["js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte"];
const MARKUP = ["jsx", "tsx", "html", "htm", "vue", "svelte", "astro", "ejs", "hbs", "cshtml", "erb"];
const PY = ["py"];
const CODE = [...JS, ...PY, "java", "cs", "go", "php", "rb", "kt"];
const CONFIG = ["json", "yml", "yaml", "env", "toml", "ini", "properties", "xml", "conf"];
const STYLE = ["css", "scss", "sass", "less"];

const USER_INPUT = String.raw`(req\.(query|body|params|headers)|request\.(args|form|GET|POST|json|query_params|data)|params\[|searchParams\.get|context\.request\.parameters|ctx\.(query|request\.body))`;

function entropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  return Object.values(freq).reduce((h, n) => h - (n / str.length) * Math.log2(n / str.length), 0);
}

// Provider-format tokens are always kept. A generic key = "value" match is kept only when
// the value looks like a real secret (no spaces, not a path/URL/label, letters AND digits,
// high entropy). This removes route constants and i18n labels like FORGOT_PASSWORD: "/forgot-password".
const PROVIDER_TOKEN = /(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_|github_pat_|sk_live_|xox[baprs]-|AIza[0-9A-Za-z_-]{35})/;
export function looksLikeSecret(match) {
  if (PROVIDER_TOKEN.test(match)) return true;
  const value = (match.match(/["']([^"']*)["']\s*$/) || [])[1] || "";
  if (value.length < 8 || /\s/.test(value) || /^(\/|https?:|\.|#)/.test(value)) return false;
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) return false;
  return entropy(value) >= 3.0;
}

// Spread props ({...props}) may carry the label/alt/aria attributes: not provable statically.
const hasSpread = (m) => /\{\s*\.\.\./.test(m);

export const SECURITY_RULES = [
  // A01 Broken Access Control (incl. SSRF in 2025)
  { id: "ssrf-user-url", category: "A01", severity: "High", exts: CODE, re: new RegExp(String.raw`\b(fetch|axios(\.(get|post|request))?|got|request|http\.get|https\.get|requests\.(get|post)|urllib\.request\.urlopen|https\.request)\s*\([^)\n]*` + USER_INPUT, "g"), title: "Outbound request URL built from user input (possible SSRF)", fix: "Allow-list hosts/schemes, resolve and block private/metadata IPs (169.254.169.254, 10/8, 127/8), never forward raw user URLs." },
  { id: "cors-any-origin", category: "A01", severity: "Medium", exts: [...CODE, ...CONFIG], re: /(Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]|origin\s*:\s*(true|['"]\*['"]))/g, title: "CORS allows any origin", fix: "Use an explicit allow-list of origins; never combine a wildcard/reflected origin with credentials." },
  { id: "jwt-decode-without-verify", category: "A01", severity: "High", exts: JS, re: /\bjwt\.decode\s*\(/g, title: "JWT decoded without signature verification", fix: "Use jwt.verify(token, key, { algorithms: ['RS256'|'HS256'] }) and reject on failure." },
  // A02 Security Misconfiguration
  { id: "tls-verification-off", category: "A02", severity: "High", exts: [...CODE, ...CONFIG], re: /(rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED['"]?\s*[=:]\s*['"]?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(false|0))/g, title: "TLS certificate verification disabled", fix: "Keep verification on; install the proper CA instead of disabling checks." },
  { id: "debug-mode-on", category: "A02", severity: "Medium", exts: [...PY, ...CONFIG, ...JS], re: /(^\s*DEBUG\s*=\s*True\b|app\.debug\s*=\s*True|app\.run\([^)]*debug\s*=\s*True|"debug"\s*:\s*true)/gm, title: "Debug mode enabled", fix: "Read debug from an environment variable that is false in production." },
  { id: "cookie-flags-off", category: "A02", severity: "Medium", exts: CODE, re: /(httpOnly\s*:\s*false|secure\s*:\s*false|SESSION_COOKIE_SECURE\s*=\s*False|CSRF_COOKIE_SECURE\s*=\s*False)/g, title: "Session/auth cookie without HttpOnly or Secure", fix: "Set HttpOnly, Secure and SameSite=Lax/Strict on session cookies." },
  // A03 Software Supply Chain Failures (project-level checks add lockfile/version/script checks)
  { id: "remote-script-pipe", category: "A03", severity: "High", exts: [...CONFIG, "sh", "ps1", "dockerfile"], re: /(curl|wget|iwr|Invoke-WebRequest)[^\n|]*\|\s*(ba|z)?sh\b|iex\s*\(\s*(New-Object|iwr|Invoke-WebRequest)/gi, title: "Remote script piped straight into a shell", fix: "Download, verify a checksum/signature, then run; or use a pinned package." },
  // A04 Cryptographic Failures
  { id: "hardcoded-secret", category: "A04", severity: "Critical", exts: [...CODE, ...CONFIG], secret: true, validate: (m) => looksLikeSecret(m), re: /(AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|sk_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'][^"'\s]{8,}["'])/gi, title: "Secret written in source code", fix: "Remove it, ROTATE the secret now (it is in git history), load it from env/secret manager." },
  { id: "weak-hash", category: "A04", severity: "Medium", exts: CODE, re: /(createHash\(\s*['"](md5|sha1)['"]|hashlib\.(md5|sha1)\(|MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"|\bmd5\(|\bsha1\()/gi, title: "Weak hash (MD5/SHA-1)", fix: "Passwords: bcrypt/argon2/scrypt. Integrity: SHA-256+. Tokens: HMAC-SHA-256." },
  { id: "insecure-random", category: "A04", severity: "High", exts: JS, re: /Math\.random\(\)[^\n;]*(token|secret|password|otp|nonce|salt|session|reset|key)|(token|secret|password|otp|nonce|salt|session|reset)[^\n;=]*=\s*[^\n;]*Math\.random\(\)/gi, title: "Math.random() used for a security value", fix: "Use crypto.randomBytes / crypto.getRandomValues / crypto.randomUUID." },
  { id: "plain-http-endpoint", category: "A04", severity: "Low", exts: CODE, re: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|schemas\.|www\.w3\.org|example\.)[a-z0-9.-]+/gi, title: "Plain HTTP URL (no TLS)", fix: "Use https://." },
  // A05 Injection
  { id: "sql-string-build", category: "A05", severity: "High", exts: CODE, re: /(\.(query|execute|raw|queryRaw|\$queryRawUnsafe|\$executeRawUnsafe)|knex\.raw|sequelize\.query|cursor\.execute|runSuiteQL)\s*\(\s*(`[^`]*\$\{|["'][^"'\n]*["']\s*\+|f["']|["'][^"'\n]*["']\s*%\s*[(\w]|["'][^"'\n]*["']\.format\()/g, title: "SQL built by string concatenation/interpolation", fix: "Use parameterized queries / bound parameters (?, $1, :name); for SuiteQL pass params as the second argument." },
  { id: "code-eval", category: "A05", severity: "High", exts: CODE, re: /(\beval\s*\(|new Function\s*\(|vm\.runIn(New|This)?Context\s*\(|setTimeout\s*\(\s*["'`]|\bexec\s*\(\s*(f["']|[^)\n]*\+))/g, title: "Dynamic code evaluation", fix: "Remove eval-style calls; parse data with JSON.parse or a safe parser." },
  { id: "os-command", category: "A05", severity: "High", exts: CODE, re: /(child_process[^\n]*\bexec(Sync)?\s*\(\s*(`[^`]*\$\{|[^)\n]*\+)|\bexec(Sync)?\s*\(\s*`[^`]*\$\{|os\.system\s*\(|subprocess\.[a-z_]+\([^)\n]*shell\s*=\s*True|Runtime\.getRuntime\(\)\.exec\()/g, title: "Shell command built from variables", fix: "Use execFile/spawn with an argument array (no shell) and validate inputs against an allow-list." },
  { id: "xss-raw-html", category: "A05", severity: "Medium", exts: [...JS, ...MARKUP, ...PY], re: /(dangerouslySetInnerHTML|\bv-html\s*=|\.innerHTML\s*=|\.outerHTML\s*=|document\.write\s*\(|insertAdjacentHTML\s*\(|\[innerHTML\]\s*=|bypassSecurityTrust\w*\(|\|\s*safe\b|mark_safe\s*\(|\{@html\s)/g, title: "Raw HTML rendering (possible XSS)", fix: "Render text, or sanitize with DOMPurify (allow-list) right before rendering." },
  { id: "nosql-where", category: "A05", severity: "Medium", exts: JS, re: /\$where\s*:/g, title: "MongoDB $where (server-side JS)", fix: "Use normal query operators; never pass user input to $where." },
  // A06 Insecure Design — mostly manual; one marker
  { id: "security-todo", category: "A06", severity: "Info", exts: CODE, re: /(TODO|FIXME|HACK)[^\n]*(auth|permission|security|csrf|rate.?limit|validate|sanitize)/gi, title: "Open security TODO", fix: "Turn it into a tracked task or resolve it." },
  // A07 Authentication Failures
  { id: "token-in-localstorage", category: "A07", severity: "Medium", exts: JS, re: /(localStorage|sessionStorage)\.setItem\(\s*["'`][^"'`]*(token|jwt|auth|session)[^"'`]*["'`]/gi, title: "Auth token stored in Web Storage (readable by any XSS)", fix: "Prefer an HttpOnly, Secure, SameSite cookie; or keep tokens in memory with short lifetimes." },
  { id: "jwt-alg-none", category: "A07", severity: "Critical", exts: JS, re: /algorithms?\s*:\s*\[?[^\]\n]*["']none["']/gi, title: "JWT 'none' algorithm accepted", fix: "Allow only the expected algorithm(s)." },
  { id: "weak-bcrypt-cost", category: "A07", severity: "Medium", exts: CODE, re: /(bcrypt\.(hash|genSalt)(Sync)?\([^)\n]*,\s*|saltRounds\s*=\s*|rounds\s*[:=]\s*)([1-9])\b/g, title: "Low bcrypt cost (< 10)", fix: "Use cost 12 or more (tune to ~250 ms)." },
  // A08 Software or Data Integrity Failures
  { id: "cdn-script-no-sri", category: "A08", severity: "Medium", exts: MARKUP, re: /<script\b(?![^>]*\bintegrity=)[^>]*\bsrc=["']https?:\/\/(?!localhost)[^"']+["'][^>]*>/gi, title: "Third-party script without Subresource Integrity", fix: "Pin the version and add integrity=\"sha384-…\" crossorigin=\"anonymous\", or self-host." },
  { id: "unsafe-deserialize", category: "A08", severity: "High", exts: CODE, re: /(pickle\.loads?\s*\(|yaml\.load\s*\((?![^)\n]*SafeLoader)|\bunserialize\s*\(|node-serialize|ObjectInputStream\s*\(|BinaryFormatter)/g, title: "Unsafe deserialization", fix: "Use JSON or a safe loader (yaml.safe_load); never deserialize untrusted data into objects." },
  // A09 Security Logging and Alerting Failures
  { id: "secret-in-log", category: "A09", severity: "High", exts: CODE, re: /(console\.(log|info|debug|warn|error)|logger?\.(info|debug|warn|error|audit)|log\.(debug|audit|error|emergency)|print)\s*\([^)\n]*\b(password|passwd|token|secret|authorization|api[_-]?key|card(Number)?|cvv|ssn)\b/gi, title: "Sensitive value written to logs", fix: "Never log secrets/PII; log an ID or a masked value." },
  // A10 Mishandling of Exceptional Conditions
  { id: "empty-catch", category: "A10", severity: "Low", exts: CODE, re: /(catch\s*(\([^)]*\))?\s*\{\s*\}|except(\s+\w+(\s+as\s+\w+)?)?\s*:\s*\n\s*pass\b)/g, title: "Error swallowed silently", fix: "Handle, log (without secrets) and fail closed; never ignore errors on security paths." },
  { id: "error-detail-leak", category: "A10", severity: "Medium", exts: CODE, re: /res\.(send|json|status\(\d+\)\.(send|json))\s*\(\s*(err|error|e)(\.(stack|message))?\s*\)|res\.(send|json)\([^)\n]*\.(stack)\b/g, title: "Internal error details returned to the client", fix: "Return a generic message + correlation ID; log details server-side." },
];

export const A11Y_RULES = [
  { id: "img-missing-alt", wcag: "1.1.1", severity: "High", exts: MARKUP, validate: (m) => !hasSpread(m), re: /<img\b(?![^>]*\balt\s*=)[^>]*>/g, title: "Image without alt text", fix: 'Add alt="description", or alt="" if purely decorative.' },
  { id: "click-on-static-element", wcag: "2.1.1", severity: "High", exts: MARKUP, re: /<(div|span|li|td|p|section|img)\b(?![^>]*\brole\s*=)(?![^>]*\bon(Key(Down|Up|Press)|keydown|keyup))[^>]*\b(onClick|@click|\(click\)|v-on:click)\s*=[^>]*>/g, title: "Clickable non-interactive element (no keyboard access)", fix: "Use <button> (or <a href>); otherwise add role, tabIndex=0 and Enter/Space key handlers." },
  { id: "input-without-label", wcag: "1.3.1 / 4.1.2", severity: "Medium", exts: MARKUP, validate: (m) => !hasSpread(m), re: /<(input|select|textarea)\b(?![^>]*\btype\s*=\s*["'](hidden|submit|button|image|reset)["'])(?![^>]*\baria-label(ledby)?\s*=)(?![^>]*\bid\s*=)(?![^>]*\btitle\s*=)[^>]*>/g, title: "Form field with no label association", fix: "Add <label htmlFor=id>, or aria-label / aria-labelledby." },
  { id: "positive-tabindex", wcag: "2.4.3", severity: "Medium", exts: MARKUP, re: /tab[iI]ndex\s*=\s*(\{\s*)?["']?[1-9]\d*/g, title: "Positive tabindex breaks the natural focus order", fix: "Use tabIndex 0 or -1 and fix the DOM order instead." },
  { id: "html-missing-lang", wcag: "3.1.1", severity: "Medium", exts: MARKUP, re: /<html\b(?![^>]*\blang\s*=)[^>]*>/gi, title: "Page language not set", fix: 'Add lang="en" (or the page language, and dir="rtl" for Arabic).' },
  { id: "anchor-without-href", wcag: "2.1.1", severity: "Medium", exts: MARKUP, re: /<a\b(?![^>]*\bhref\s*=)[^>]*\b(onClick|@click|\(click\))\s*=[^>]*>/g, title: "Link without href used as a button", fix: "Use <button> for actions, <a href> for navigation." },
  { id: "icon-button-no-name", wcag: "4.1.2", severity: "High", exts: MARKUP, validate: (m) => !hasSpread(m), re: /<(button|IconButton)\b(?![^>]*\baria-label(ledby)?\s*=)(?![^>]*\btitle\s*=)[^>]*>\s*<(svg|img|i|span class="icon|[A-Z]\w*Icon)\b/g, title: "Icon-only button without an accessible name", fix: 'Add aria-label="Close" (or visually hidden text).' },
  { id: "zoom-disabled", wcag: "1.4.4", severity: "High", exts: [...MARKUP, ...JS], re: /(user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b)/gi, title: "Pinch-zoom disabled", fix: "Remove user-scalable=no and maximum-scale=1 from the viewport meta." },
  { id: "autofocus", wcag: "3.2.1", severity: "Low", exts: MARKUP, re: /\bauto[fF]ocus\b/g, title: "autofocus moves focus unexpectedly", fix: "Remove it unless the field is the only purpose of the page/dialog." },
  { id: "focus-outline-removed", wcag: "2.4.7", severity: "Medium", exts: [...STYLE, ...MARKUP, ...JS], validate: (m, line) => !/focus(-visible|-within)?:|ring-|box-shadow/.test(line), re: /outline\s*:\s*(none|0)\b|\boutline-none\b/g, title: "Focus outline removed", fix: "Keep a visible focus style (e.g. :focus-visible { outline: 2px solid … })." },
];
