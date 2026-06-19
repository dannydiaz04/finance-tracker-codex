# Production Milestones

Last updated: 2026-06-19

This is the living tracker for getting Finance Tracker production-ready. Keep
status current as work lands.

## Current Baseline

Verified locally on 2026-06-19:

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run test:imports`
- [x] `npm run build`
- [x] `npm run dataform:compile`

Known launch blockers:

- [ ] Production secrets, service accounts, and scheduled jobs are not fully
  documented or provisioned.

## Milestone 1: Patch Runtime Dependencies

Goal: ship on a dependency set that is acceptable for a finance/auth app.

Status: complete.

- [x] Upgrade Next.js to a patched version.
  - Updated `next` from `16.2.1` to `16.2.9`.
  - Updated `eslint-config-next` from `16.2.1` to `16.2.9`.
- [x] Resolve or explicitly accept all runtime `npm audit --omit=dev` findings.
  - Added overrides for Next's nested `postcss` (`8.5.10`) and transitive
    `uuid` (`11.1.1`).
  - `npm audit --omit=dev` now reports `found 0 vulnerabilities`.
- [x] Rerun `npm install` and regenerate the updated lockfile.
  - Lockfile has been regenerated. No git commit was created in this step.
- [x] Re-run `typecheck`, `lint`, `test:imports`, `build`, and
  `dataform:compile`.
  - `npm run typecheck`: pass.
  - `npm run lint`: pass.
  - `npm run test:imports`: pass, with existing non-fatal Node module-type
    warnings.
  - `npm run build`: pass on Next.js `16.2.9`.
  - `npm run dataform:compile`: pass with network access for Dataform's
    internal package install.
- [x] Record any remaining accepted dependency risk here.
  - Runtime audit risk: none currently known from `npm audit --omit=dev`.
  - Full `npm audit` still reports dev-only findings in `@dataform/cli`
    (`vm2`, `parse-duration`) and `drizzle-kit` (`esbuild` chain). These are
    not production runtime dependencies, but should be revisited before CI/CD is
    treated as hardened production infrastructure.

## Milestone 2: Choose Production Runtime

Goal: make deployment repeatable.

Status: complete.

- [x] Choose hosting target: Vercel, Node server, or container platform.
  - Chosen target: Vercel standard Next.js server deployment.
  - Rationale: the app uses App Router dynamic routes, Route Handlers, Auth.js,
    Postgres, BigQuery, Plaid, OpenAI, and `proxy.ts`; it is not suitable for a
    static export.
- [x] Pin the production Node.js version.
  - Added `engines.node = "24.x"` to `package.json`.
  - Added `.nvmrc` with `24`.
- [x] Add deployment config as needed, such as `vercel.json`, Dockerfile,
  platform config, or CI deploy workflow.
  - Added `vercel.json` with the `nextjs` framework preset, `npm ci` install
    command, and `npm run build` build command.
- [x] Confirm the app runs as a server deployment, not static export.
  - `npm run build` passes and reports dynamic server-rendered routes plus
    `Proxy (Middleware)`.
- [x] Document deploy and rollback commands.
  - Added `PRODUCTION_RUNTIME.md` with runtime decision, Node pin, Vercel config,
    local production check, deploy commands, rollback path, and open runtime
    decisions.
  - `npm ci --audit=false --fund=false`: pass.
  - `npm audit --omit=dev`: pass.
  - `npm run typecheck`: pass.
  - `npm run build`: pass.

## Milestone 3: Provision Production Services

Goal: production has all required backing services and secrets.

- [ ] Provision production Postgres.
- [ ] Set `DATABASE_URL`.
- [ ] Generate and set `AUTH_SECRET`.
- [ ] Configure production Google OAuth client and callback URLs.
- [ ] Configure BigQuery project, location, datasets, and service account.
- [ ] Configure Plaid production client, secret, redirect URI, and webhook URL.
- [ ] Configure OpenAI key/model variables if assistant or AI enrichment is
  enabled.
- [ ] Configure GCS landing bucket variables for ETL.
- [ ] Store all secrets in the deployment platform or secret manager, not repo
  files.

## Milestone 4: Bring Data Stores Up Cleanly

Goal: auth, warehouse, and marts are ready with production-shaped data.

- [ ] Run `npm run db:migrate` against production Postgres.
- [ ] Run required warehouse SQL migrations/backfills.
- [ ] Run `npx dataform run dataform` or the production Dataform equivalent.
- [ ] Run Dataform assertions successfully.
- [ ] Run `sql/warehouse/01_app_readiness_audit.sql`.
- [ ] Resolve readiness audit issues, especially uncategorized transactions,
  generic account masks, orphan batches, and pending-only fixture-like data.
- [ ] Verify dashboard routes against production warehouse data.

## Milestone 5: Harden Auth and API Security

Goal: public exposure does not rely on demo-era assumptions.

- [ ] Decide whether sign-up is public, invite-only, or disabled for launch.
- [ ] Add abuse controls for registration and credential sign-in.
- [ ] Add rate limiting or equivalent controls for auth, assistant, import, and
  Plaid endpoints.
- [ ] Enforce auth inside user-data API route handlers, not only via `proxy.ts`.
- [ ] Add security headers and review CSP requirements.
- [ ] Review Plaid webhook validation and operational behavior.
- [ ] Review user-data isolation across all BigQuery queries and mutations.

## Milestone 6: Operationalize ETL and Plaid

Goal: data refreshes without manual intervention.

- [ ] Schedule the landed-file runner.
- [ ] Schedule Dataform warehouse refreshes after raw data lands.
- [ ] Schedule Plaid sync or confirm webhook-driven sync is sufficient.
- [ ] Schedule AI categorization enrichment if enabled.
- [ ] Add logging, retries, and alerts for ETL failures.
- [ ] Restrict IAM access to `ops_finance.plaid_items`.
- [ ] Decide whether Plaid access tokens must move from BigQuery to Secret
  Manager or another encrypted store before launch.
- [ ] Add durable landing-file metadata if needed for production observability.

## Milestone 7: Add CI/CD Gates

Goal: production deploys are protected by repeatable checks.

- [ ] Add CI workflow.
- [ ] CI runs `npm ci`.
- [ ] CI runs `npm run lint`.
- [ ] CI runs `npm run typecheck`.
- [ ] CI runs `npm run test:imports`.
- [ ] CI runs `npm run build`.
- [ ] CI runs `npm run dataform:compile`.
- [ ] CI runs `npm audit --omit=dev` or an agreed security scanner.
- [ ] Deployment only proceeds after checks pass.

## Milestone 8: Clean Documentation and Product Text

Goal: docs and in-product assistant guidance match current behavior.

- [ ] Update README wording from `middleware.ts` to `proxy.ts` for Next.js 16.
- [ ] Update assistant knowledge text about Plaid; exchange, sync, and webhook
  paths are more complete than the current guide says.
- [ ] Add production environment variable reference.
- [ ] Add production runbook for deploy, data refresh, incident checks, and
  rollback.
- [ ] Keep this file updated as milestones complete.
