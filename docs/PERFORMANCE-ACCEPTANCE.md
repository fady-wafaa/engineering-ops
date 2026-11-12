# Performance audit acceptance status

## Browser stage

The SuiteFleet test scenario is **Open status filter → changed table rows visible**. The automated fixture uses three runs before (310/320/330 ms) and after (160/170/180 ms), with the same target, device, viewport, network, throttling, build mode, environment, cache state and role. The scorer reports 320 → 170 ms, a 150 ms reduction. These are **test fixture values, not a live SuiteFleet measurement**. The fixture also verifies that changing the device or cache state suppresses the comparison.

Live SuiteFleet result: **لم يُقَس**. On 2026-11-10, `https://testing.next.suitefleet.com/login` displayed “Your credentials are not correct.” A valid test login (and completion of any login challenge by the user) is required to reach the table. No live filter timing, request evidence, mobile/desktop comparison or cold/warm comparison is claimed.

## Network and server stage

The browser probe emits ordered Resource Timing entries, cache hints, response status when exposed, and `Server-Timing`. The server report importer calculates p50/p95/p99, sample count, error count/rate and database duration distribution from supplied request records; cause attribution requires linked trace or report IDs. Live SuiteFleet server/API/database reports: **لم يُقَس**; provide a report export or read access to traces.

## Field data and load stage

CrUX page/origin records and RUM reports remain separate from local browser runs. Existing k6 JSON summaries are imported without generating traffic. Capacity conclusions need workload, environment, duration and VU context; endurance needs a time series. SuiteFleet field and k6 reports: **لم يُقَس**; provide the exports or access.

## Budgets, lab and field (2026-11-12)

`result_visible_ms`, `spa_navigation_ms` and `action_ms` are scored only against a budget the project documents or the user gives (`docs/SCORING-POLICY.md` §5). The fixture covers: a 1500 ms median scoring 0 against a 1000 ms budget and 2 against a 2000 ms budget; a single maximum producing met-or-exceeded with no middle band; a measurement with no budget reported as a baseline outside the score; a budget with no measurement recorded as owed; and a changed budget suppressing the score comparison.

Lab runs produce `lab_core_web_vitals` only. `core_web_vitals_pass` is a **field** verdict: it stays `null` until field data supplies a p75 for LCP, INP and CLS for the device class, and it passes only when all three meet their targets. No browser run, however fast, sets it. SuiteFleet field data: **لم يُقَس**.

## Verification

Run `node --test tests/performance.test.mjs tests/v03.test.mjs tests/applicability.test.mjs` with Node 18.17 or newer. These cover the SuiteFleet fixture, comparison gating, CrUX/RUM/server/k6 parsing, CLI import, the budget rules and the lab/field separation. The full suite (`npm test`, 160 tests) passed on 2026-11-12.
