# OWASP Top 10:2025 — what to check and how to fix

Source: https://owasp.org/Top10/2025/ (8th edition). Each category = one criterion (scored 2/1/0/— per `audit-contract.md`). "Scan" = rules in `scripts/lib/scan-rules.mjs` that produce candidates; "Manual" = what the agent must read in code.

---

## A01 Broken Access Control (includes SSRF)
**Manual:** for every route/endpoint/server action/RESTlet touched by user data: is there an authorization check (role/permission) AND an ownership/tenant check (`where owner_id = currentUser` / tenant scoping)? IDs in URLs (IDOR)? Admin routes protected server-side, not only hidden in the UI? CORS policy. Outbound requests built from user URLs (SSRF).
**Scan:** `ssrf-user-url`, `cors-any-origin`, `jwt-decode-without-verify`.
**Fix:** deny by default; central authorization middleware/policy; check ownership on every object access; never trust client-side role checks; allow-list outbound hosts and block private/metadata IP ranges.
```js
// before
app.get("/orders/:id", auth, async (req, res) => res.json(await Order.findById(req.params.id)));
// after
app.get("/orders/:id", auth, async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, tenantId: req.user.tenantId });
  if (!order) return res.sendStatus(404);
  res.json(order);
});
```
**NetSuite:** RESTlet/Suitelet deployments with audience "All roles" or "Available without login"; scripts using `runtime.getCurrentUser()` without checking role; records loaded by an ID from request parameters without checking subsidiary/ownership.

## A02 Security Misconfiguration
**Manual:** debug/verbose errors in production config, default credentials, security headers (CSP, HSTS, X-Content-Type-Options, frame-ancestors), directory listing, permissive cloud/storage settings, TLS verification, cookie flags, framework hardening (helmet, Django `SECURE_*`).
**Scan:** `tls-verification-off`, `debug-mode-on`, `cookie-flags-off`.
**Fix:** environment-driven config with secure defaults; add security headers; HttpOnly + Secure + SameSite cookies; never disable TLS checks.
**NetSuite:** script deployments left at log level DEBUG in production; "Execute as Role: Administrator".

## A03 Software Supply Chain Failures (new in 2025)
**Manual + project checks:** lockfile committed and used in CI (`npm ci`, `--frozen-lockfile`); unpinned/`*`/`latest`/git-URL dependencies; install scripts that download code; known-vulnerable packages (`--deps` audit); unmaintained packages; CI actions pinned to a SHA; build provenance.
**Scan:** `remote-script-pipe`, project checks `no-lockfile`, `unpinned-deps`, `install-script-download`, `python-unpinned`, optional dependency audit.
**Fix:** commit lockfiles, pin versions, update or replace vulnerable packages (the audit says which have a fix), pin GitHub Actions by SHA, enable Dependabot/Renovate.

## A04 Cryptographic Failures
**Manual:** secrets in code or git-tracked env/key files; passwords hashed with a fast hash; tokens from `Math.random`; data sent over plain HTTP; sensitive data stored unencrypted; weak TLS.
**Scan:** `hardcoded-secret` (values redacted), `weak-hash`, `insecure-random`, `plain-http-endpoint`, project checks `env-file-committed`, `key-file-committed`.
**Fix:** move secrets to env/secret manager **and rotate them** (git history keeps them); argon2/bcrypt(≥12)/scrypt for passwords; `crypto.randomBytes`/`randomUUID`; HTTPS everywhere.
**Note:** browser API keys (e.g. Google Maps `AIza…`) are visible to users by design — the risk is an **unrestricted** key: require HTTP-referrer and API restrictions in the provider console. Still keep env files out of git.
**NetSuite:** credentials or tokens in script parameters/files instead of API Secrets (`N/https` secure strings / `N/keyControl`).

## A05 Injection (SQL, NoSQL, OS command, code, XSS)
**Manual:** follow user input to sinks: SQL/SuiteQL, shell, `eval`, HTML rendering, LDAP/XPath, template engines. Confirm the value is user-controlled and not sanitized/parameterized.
**Scan:** `sql-string-build`, `code-eval`, `os-command`, `xss-raw-html`, `nosql-where`.
**Fix:** parameterized queries; `execFile`/`spawn` with argument arrays; no `eval`; output encoding by default; sanitize HTML with DOMPurify when HTML is required.
```js
// before
db.query(`SELECT * FROM users WHERE email = '${req.body.email}'`);
// after
db.query("SELECT * FROM users WHERE email = $1", [req.body.email]);
```
**NetSuite:** `query.runSuiteQL({ query: "… WHERE id = " + id })` → `query.runSuiteQL({ query: "… WHERE id = ?", params: [id] })`; Suitelet HTML built from parameters without `encodeHTML`-style escaping.

## A06 Insecure Design
**Manual (no scan can prove it):** missing rate limits on login/OTP/password reset; no lockout; business rules enforced only on the client; multi-step flows that can be skipped; missing limits (file size, quantity, price from client); no threat model for money/permissions features. Open security TODOs (`security-todo`).
**Fix:** server-side business rules, rate limiting + lockout, idempotency keys, limits, abuse-case tests.

## A07 Authentication Failures
**Manual:** password policy and hashing; MFA for admins; session fixation/rotation on login; logout invalidates sessions; JWT algorithm/expiry/audience checks; token storage; password reset token strength and expiry; enumeration via different error messages.
**Scan:** `token-in-localstorage`, `jwt-alg-none`, `weak-bcrypt-cost`.
**Fix:** proven auth library; short-lived access tokens + rotating refresh tokens in HttpOnly cookies; same error message for "user not found" and "wrong password"; MFA.

## A08 Software or Data Integrity Failures
**Manual:** third-party scripts without SRI; unsafe deserialization of untrusted data; auto-update without signature checks; CI/CD that runs untrusted code with secrets; webhook payloads without signature verification.
**Scan:** `cdn-script-no-sri`, `unsafe-deserialize`.
**Fix:** SRI + pinned versions or self-host; JSON / safe loaders; verify webhook signatures (HMAC) and timestamps.

## A09 Security Logging and Alerting Failures
**Manual:** are login failures, permission denials and admin actions logged with user/tenant/time (without secrets)? Is there alerting? Are secrets/PII written to logs?
**Scan:** `secret-in-log`.
**Fix:** structured security events, masking, retention, alerts on spikes of failures.
**NetSuite:** `log.debug` of request bodies/credentials; no `log.audit` for permission-sensitive actions.

## A10 Mishandling of Exceptional Conditions (new in 2025)
**Manual:** errors swallowed; code that **fails open** (catch → allow/continue); error details/stack traces returned to clients; unchecked return values; resource exhaustion on errors; inconsistent state after partial failure (no transaction/rollback).
**Scan:** `empty-catch`, `error-detail-leak`.
**Fix:** fail closed on security paths; global error handler returning a generic message + correlation ID; transactions for multi-step writes.
```js
// before — fails open
try { allowed = await checkPermission(user, doc); } catch { allowed = true; }
// after — fails closed
try { allowed = await checkPermission(user, doc); } catch (e) { log.error({ err: e.code, user: user.id }); allowed = false; }
```
