# Stack guide — Backend (Node, Python, Go, Java, .NET, PHP, Ruby)

**Find the journey:** route/endpoint registration → controller/handler → validation → service/use case → repository/ORM → database or external API → response mapping. Include auth middleware and tenant scoping.
- Express/Fastify/Koa/Hono: router files; NestJS: `*.controller.ts` → `*.service.ts` → modules.
- Django: `urls.py` → views → serializers/forms → models; FastAPI/Flask: decorated route functions.
- Go: `http.Handle*`/router setup; Spring: `@RestController`; ASP.NET: controllers/minimal APIs.

**Baseline / postcheck:** a reproducible request (curl/HTTP client against the configured test or local URL), a failing test, or logs — record exactly which. No requests to production. No data-changing calls unless `allowed_test_data_actions` permits them.
**Typical checks:** unit + integration tests, lint, type check, build, migrations check (dry run only).
**Watch for:** authorization on every path, input validation, transactions and idempotency, N+1 queries, pagination, error handling and logging without secrets, backward compatibility of public APIs, migrations (never run against shared data without approval).
