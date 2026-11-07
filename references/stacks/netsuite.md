# Stack guide — NetSuite (SuiteScript 2.x, SuiteCloud SDF)

**Project layout (SDF):** `suitecloud.config.js`, `src/manifest.xml` (ACCOUNTCUSTOMIZATION or SUITEAPP), `src/deploy.xml`, scripts in `src/FileCabinet/SuiteScripts/`, objects (script records, deployments, custom records/fields, saved searches, workflows) in `src/Objects/*.xml`.

**Find the journey:**
- Script header: `@NApiVersion 2.x/2.1` and `@NScriptType` (UserEventScript, ClientScript, Suitelet, RESTlet, ScheduledScript, MapReduceScript, WorkflowActionScript).
- Entry points: `beforeLoad / beforeSubmit / afterSubmit` (User Event), `pageInit / fieldChanged / saveRecord` (Client), `onRequest` (Suitelet), `get/post/put/delete` (RESTlet), `getInputData / map / reduce / summarize` (Map/Reduce).
- Link script file → script object (`customscript_*`) → deployment (`customdeploy_*`: record type, roles, status, execution context).
- Modules: `N/record`, `N/search`, `N/query` (SuiteQL), `N/runtime`, `N/https`, `N/log`, `N/email`.

**Baseline / postcheck:** in a **sandbox or development account only** — never production. Record account type, role, record type, record internal IDs (synthetic data), and the script execution log. The human logs in; never store account credentials or token-based-auth secrets.
**Typical checks:** `suitecloud project:validate` (needs SuiteCloud CLI + authenticated account), Jest via `@oracle/suitecloud-unit-testing` stubs, lint. **Deploy (`project:deploy`) is a human decision, never automatic.**
**Watch for:** governance units (usage limits) in loops — prefer Map/Reduce for volume; `search` vs `N/query` performance; execution context (UI vs CSV import vs web services); role/permission differences; sublist line handling; time zones and subsidiaries (OneWorld); idempotency of afterSubmit; deployment status and audience.
