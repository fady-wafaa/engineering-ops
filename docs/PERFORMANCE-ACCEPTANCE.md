# Performance audit acceptance status

## Browser stage

The SuiteFleet test scenario is **Open status filter → changed table rows visible**. The automated fixture uses three runs before (310/320/330 ms) and after (160/170/180 ms), with the same target, device, viewport, network, throttling, build mode, environment, cache state and role. The scorer reports 320 → 170 ms, a 150 ms reduction. These are **test fixture values, not a live SuiteFleet measurement**. The fixture also verifies that changing the device or cache state suppresses the comparison.

Live SuiteFleet result: **لم يُقَس**. On 2026-11-10, `https://testing.next.suitefleet.com/login` displayed “Your credentials are not correct.” A valid test login (and completion of any login challenge by the user) is required to reach the table. No live filter timing, request evidence, mobile/desktop comparison or cold/warm comparison is claimed.

## Network and server stage

The browser probe emits ordered Resource Timing entries, cache hints, response status when exposed, and `Server-Timing`. The server report importer calculates p50/p95/p99, sample count, error count/rate and database duration distribution from supplied request records; cause attribution requires linked trace or report IDs. Live SuiteFleet server/API/database reports: **لم يُقَس**; provide a report export or read access to traces.

## Field data and load stage

CrUX page/origin records and RUM reports remain separate from local browser runs. Existing k6 JSON summaries are imported without generating traffic. Capacity conclusions need workload, environment, duration and VU context; endurance needs a time series. SuiteFleet field and k6 reports: **لم يُقَس**; provide the exports or access.

## Verification

Run `node --test tests/performance.test.mjs tests/v03.test.mjs` with Node 18.17 or newer. The performance tests cover the SuiteFleet fixture, comparison gating, CrUX/RUM/server/k6 parsing and CLI import. The full test suite also passed on 2026-11-10.
