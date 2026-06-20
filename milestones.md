# Production Milestones

Last updated: 2026-06-19

This is the living tracker for getting Finance Tracker production-ready. Keep
status current as work lands.

## Current Baseline

Verified locally on 2026-06-19:

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run test:imports`
- [x] `npm run test:alerts` (cash-flow anomaly detector)
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

Status: in progress. Repo-side service readiness is complete; external
production secret values and cloud-provider setup are still pending.

- [x] Add a production service/env contract.
  - Added `.env.example` with the production service variable names and no
    secret values.
  - Added `PRODUCTION_SERVICES.md` with setup steps for Vercel env vars,
    Postgres, Auth.js/Google OAuth, BigQuery, Plaid, GCS landing, and OpenAI.
  - Added `production-env-status/`, a small static HTML/CSS/JS status app that
    shows which production env vars are ready in Vercel and which values are
    still missing.
- [x] Add production environment validation tooling.
  - Added `npm run env:check:production`.
  - The checker validates required keys, required either/or groups, and Google
    service account JSON shape without printing secret values.
- [x] Add Vercel-compatible Google Cloud credentials support.
  - Added `lib/google-cloud/credentials.ts`.
  - BigQuery and GCS runner clients now support service account credentials from
    `GOOGLE_CLOUD_CREDENTIALS_JSON`, `GOOGLE_CLOUD_CREDENTIALS_BASE64`,
    `GOOGLE_APPLICATION_CREDENTIALS_JSON`, or
    `GOOGLE_APPLICATION_CREDENTIALS_BASE64`.
- [x] Provision production Postgres.
  - Vercel production env already contains Neon/Postgres variables for the
    linked `finance-tracker` project, including `DATABASE_URL`.
  - Running migrations against production belongs to Milestone 4.
- [x] Set `DATABASE_URL`.
  - Verified present in Vercel production env via `vercel env ls production`.
- [ ] Generate and set `AUTH_SECRET`.
  - Not present in Vercel production env yet.
- [ ] Configure production Google OAuth client and callback URLs.
  - `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are not present in Vercel
    production env yet.
  - Callback URL should be
    `https://<production-domain>/api/auth/callback/google` after the production
    domain is selected.
- [ ] Configure BigQuery project, location, datasets, and service account.
  - Repo now supports Vercel-safe service account credentials, but production
    BigQuery env values and service account JSON/base64 are not present in
    Vercel production env yet.
- [ ] Configure Plaid production client, secret, redirect URI, and webhook URL.
  - Plaid production env values are not present in Vercel production env yet.
- [ ] Configure OpenAI key/model variables if assistant or AI enrichment is
  enabled.
  - OpenAI production env values are not present in Vercel production env yet.
- [ ] Configure GCS landing bucket variables for ETL.
  - `WAREHOUSE_LANDING_BUCKET` / `WAREHOUSE_LANDING_URI` is not present in
    Vercel production env yet.
- [ ] Store all secrets in the deployment platform or secret manager, not repo
  files.
  - Postgres/Neon values are in Vercel. Remaining production secrets still need
    to be added as Vercel sensitive env vars or stored in the chosen secret
    manager.
- [x] Verification completed for repo-side Milestone 3 work.
  - `npm run env:check:production`: pass with synthetic non-secret production
    values.
  - `npm run typecheck`: pass.
  - `npm run test:imports`: pass.
  - `npm run lint`: pass.
  - `npm run build`: pass.
  - `npm audit --omit=dev`: pass.

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

## Product Phase: AI Fallback, Cash-Flow Alerting, and Live Ingestion

Goal: ship the in-product "Next phase" roadmap callout — AI fallback for
low-confidence rows and alerting for abnormal cash flow, tied to the existing
live Plaid + CSV ingestion.

Status: complete (code shipped 2026-06-19). All three features degrade
gracefully to sample mode; running them against production data still depends on
OpenAI / BigQuery / Plaid being provisioned per Milestone 3.

### AI fallback for low-confidence rows

- [x] Made the batch AI enrichment runner user-scopable.
  - `runAiCategoryEnrichment` accepts an optional `userId`; the
    `ai_enrichment_queue` and manual-example loaders now filter by user.
  - Added a `--user-id` flag to `npm run etl:ai-enrich`.
- [x] Added an on-demand, per-user enrichment endpoint.
  - `GET /api/enrich/low-confidence` returns the low-confidence queue count plus
    OpenAI/BigQuery config flags; `POST` runs AI fallback for the current user.
  - Both require auth; `POST` returns a `skipped` result (not a 500) when OpenAI
    or BigQuery is unconfigured, and an `error` result if a run fails.
- [x] Surfaced it in the dashboard UI.
  - `components/dashboard/ai-fallback-card.tsx` shows the low-confidence count
    and a "Run AI fallback" button; added to the Overview page.
  - `lib/queries/enrichment.ts` counts the waiting queue (warehouse) or sample
    rows below the 0.85 confidence bar (sample mode).

### Alerting for abnormal cash flow

- [x] Added a pure, dependency-free anomaly detector.
  - `lib/alerts/cashflow-anomalies.ts` flags unusually large single charges,
    daily outflow spikes (deduped against large charges), sustained
    net-negative streaks, and net-negative windows, with tunable thresholds and
    a severity summary.
- [x] Added a server query and route.
  - `lib/queries/alerts.ts` composes cash flow + transactions (sample-safe);
    `GET /api/alerts` returns alerts + summary for the active time scope.
- [x] Surfaced it in the dashboard UI.
  - `components/dashboard/cashflow-alerts.tsx` on the Overview and Cash Flow
    pages.
- [x] Added unit tests.
  - `tests/alerts/cashflow-anomalies.test.mjs` (12 cases) via
    `npm run test:alerts`; `npm test` now runs the import + alert suites.

### Live Plaid + CSV ingestion (closed loop)

- [x] Added a shared post-ingest enrichment helper.
  - `lib/ingestion/post-ingest.ts` runs AI fallback after data lands; it never
    throws and reports `ran` / `skipped` / `error`.
- [x] Wired ingestion endpoints to trigger it on request.
  - `POST /api/import/csv` (when `persist` + `enrich`) and `POST /api/plaid/sync`
    (when `enrich`) return an `enrichment` result alongside their normal output.
  - Note: the AI queue reflects Dataform-modeled rows, so freshly-landed raw
    events become eligible for fallback only after the warehouse models refresh.
- [x] Updated the sidebar roadmap callout from "Next phase" to "Now live" and
  pointed the next phase at scheduling/automation.

### Verification (2026-06-19)

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test` (import + cash-flow alert suites): pass.
- `npm run build`: pass; `/api/alerts` and `/api/enrich/low-confidence` register
  as dynamic route handlers.
- `npm run dataform:compile`: not re-run this phase; no `dataform/` files changed.

### Follow-ups (feed Milestones 6–8)

- Schedule AI fallback and warehouse refresh so enrichment and alerts stay
  current without manual runs (Milestone 6 — "Schedule AI categorization
  enrichment if enabled").
- Consider persisting alerts and adding notification channels for criticals.
- Update assistant knowledge text to mention AI fallback and cash-flow alerts
  (Milestone 8).
