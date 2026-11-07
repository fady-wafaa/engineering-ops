# Stack guide — Frontend (React, Next.js, Vue, Angular, Svelte, …)

**Find the journey:** route definition → page/screen component → child components → state (store, context, query cache) → data hooks/services → API client → endpoint.
- Next.js: `app/**/page.tsx` (App Router) or `pages/**` (Pages Router); server actions and `route.ts` handlers are backend code.
- React Router / TanStack Router: route files or a router config (`src/routes`, `src/app/routes`, `router.tsx`).
- Vue / Nuxt: `pages/`, `router/index.ts`, Pinia stores. Angular: `*-routing.module.ts`, services.
- Shared code (`components/`, `hooks/`, `lib/`, `packages/ui`) → always search for real importers before calling a change local.

**Baseline / postcheck:** browser (Playwright MCP). Record URL, role, viewport, language/RTL, data used.
**Typical checks:** unit (Vitest/Jest + Testing Library), lint (ESLint), typecheck (`tsc`), build, e2e (Playwright/Cypress) — only those the project has.
**Watch for:** loading/empty/error states, permissions per role, i18n strings, keyboard and focus, layout at narrow widths, query-cache invalidation, hydration (SSR).
