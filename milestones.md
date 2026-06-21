# Production Milestones

Last updated: 2026-06-21

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

---

# Roadmap: Live Connectivity, BigQuery Storage, LLM Categorization & Plaid Analytics

Started 2026-06-21. This is the continually-updated, phased build-out for the
Plaid go-live, the data store guardrail, the LLM transaction categorizer, and the
analytics roadmap. Check items off and update each phase's `Status` as work lands.

## Decision Record: Storage stays on BigQuery (no AlloyDB / Spanner / op DBs)

Status: confirmed 2026-06-21 (grep-verified, querying live data).

- All finance/warehouse data lives in **native BigQuery tables/views** across
  datasets `raw_finance`, `ops_finance`, `stg_finance`, `core_finance`,
  `mart_finance`, `analytics_finance`. Writes go through
  `lib/bigquery/client.ts` (`@google-cloud/bigquery` streaming inserts + DML).
- Postgres/Neon (Drizzle) is **auth-only** (NextAuth `users`/`accounts`/
  `sessions`/`verificationTokens`). No finance data lives there.
- No `alloydb`, `spanner`, `bigtable`, or `cloudsql` references exist anywhere in
  the repo.
- **Guardrail:** new transaction/account/analytics data must land in plain
  BigQuery warehouse tables. Do not introduce AlloyDB/Spanner/operational
  databases for analytics. Cost hygiene: partition large tables on `posted_at`
  and cluster (already done on `analytics_finance.transaction_analytics_base`),
  and dedupe raw events to keep scan bytes down (see Phase B).

## Phase A: Plaid OAuth Connectivity + Capital One Go-Live

Goal: real OAuth banks complete the connect flow and land transactions.

Status: code implemented + validated locally (2026-06-20/21); commit + deploy +
external cutover still pending. Capital One is verified live in the warehouse.

- [x] OAuth-resume in `components/plaid/plaid-link-button.tsx` — persist the
  `link_token` in `sessionStorage`, detect `?oauth_state_id`, re-mount
  `usePlaidLink` with `receivedRedirectUri`, guard `open()`, surface load errors
  + watchdog so the button can't hang.
- [x] `proxy.ts` (Next 16 middleware) apex→www 308 derived from `AUTH_URL`,
  origin-pinned to block a protocol-relative open redirect, skipping
  localhost/`*.vercel.app`.
- [x] Secret-safe `[plaid:*]` logging in exchange/sync/webhook routes (logs the
  extracted message only — never the raw axios error, which carries tokens +
  `PLAID-SECRET`).
- [x] Env to canonical host: `PLAID_REDIRECT_URI`/`PLAID_WEBHOOK_URL` → `www`,
  `AUTH_URL` fixed to origin-only.
- [x] Validated: `typecheck`, `lint`, `build`, `npm test` all pass;
  open-redirect fix verified against `//evil.com` / `/\evil.com`.
- [x] **Capital One verified paired** (`ins_128026`, status `active`, checking
  ••5980 = $2,385.87, 359 distinct transactions; webhook syncs now return 0 new
  rows → cursor advancing).
- [ ] Commit the fix and deploy to production.
- [ ] External cutover (cannot be done from code): register the `www` redirect
  URI + webhook in the Plaid Dashboard; set `www` primary + apex 308 in Vercel;
  confirm the Google OAuth `www` callback; update Vercel prod env + redeploy.
- [ ] Run `npx dataform run dataform` so Capital One propagates into the
  table-type marts and the dashboards.

## Phase B: Ingestion Data-Quality Hardening

Goal: clean, cheap, idempotent ingestion.

Status: not started. Marts already dedupe, so this is cost/cleanliness, not
correctness.

- [ ] Fix the ~3× duplicate raw events (Capital One's initial load wrote 1,058
  `added` events for 359 transactions): make `event_id` deterministic per
  `(source_transaction_id, event_type)` and serialize the exchange-triggered sync
  vs the webhook-triggered sync so they don't both run from a null cursor.
- [ ] Persist `available_balance` where Plaid returns it (null for CapOne
  checking today) and/or enable the Balances product (Phase E, Tier 3).
- [ ] Keep `duplicate_transaction_ids` and the other Dataform assertions green.

## Phase C: LLM Transaction Categorization (harden + extend existing)

Goal: an LLM model-API categorizer that auto-categorizes transactions with
confidence gating and a human-review fallback.

Status: **foundation already exists** — extend it; do not rebuild.

Already built:

- [x] OpenAI Responses-API batch classifier
  (`lib/ai-enrichment/category-classifier.ts`): pulls the low-confidence queue
  (`ops_finance.ai_enrichment_queue`), sends the `core_finance.dim_category`
  taxonomy + the user's `manual_overrides` as few-shot examples, parses JSON
  suggestions, scores confidence (transaction-class / institution-category /
  secondary-margin / signals adjustments), labels accepted / needs_review /
  rejected, and writes to the BigQuery table `ops_finance.ai_enrichment_results`.
- [x] Provenance + "context" knobs on every result row: `prompt_version`,
  `rules_version`, `taxonomy_version`, `input_hash`, `model`, `model_provider`,
  `model_response_id` — these are the version handles to manage prompt/skill
  context as it evolves.
- [x] Runner `npm run etl:ai-enrich` (model / threshold / batch-size / user-id
  flags), `GET|POST /api/enrich/low-confidence`, post-ingest hook, Overview
  AI-fallback card.

To build:

- [ ] **Feed Plaid `personal_finance_category` as a strong prior** — primary +
  detailed + confidence are 100% populated on Capital One; pass them into the
  queue/prompt so the model anchors on Plaid's ML categorization and review
  volume drops.
- [ ] **Close the loop into the marts** — auto-apply accepted (≥ threshold)
  suggestions from `ai_enrichment_results` into `core_finance.fact_classification`
  / the derived category so dashboards reflect AI categories (today results are
  written but not promoted).
- [ ] **Idempotency / cost control** — skip re-enriching rows whose `input_hash`
  is unchanged; add a per-run token/cost budget cap.
- [ ] **Accuracy evaluation harness** — score AI suggestions against
  `manual_overrides`; track precision and auto-accept rate per
  prompt/taxonomy/rules version so model/prompt changes are measurable.
- [ ] **Provider seam** — keep the classifier behind a small model-API interface
  (defaults to the configured `OPENAI_CATEGORIZATION_MODEL`) so the model can be
  swapped without touching the pipeline.
- [ ] **Schedule** enrichment to run after each warehouse refresh (ties to
  Milestone 6).
- [ ] Context/skills note: prompt text lives in
  `buildCategoryClassifierInstructions()` and the `category-guidelines` rules
  version — iterate there and bump the version string so results stay traceable.

## Phase D: Surface Plaid's Rich Signal (already captured, not yet exposed)

Goal: use the full Plaid payload that already sits in `raw_payload_json`.

Status: not started. Today only `personal_finance_category.primary` is surfaced
(as `institution_category`).

- [ ] Map Plaid's snake_case fields into `stg_finance.transactions_clean` /
  `analytics_finance.transaction_analytics_base`:
  `personal_finance_category.detailed`/`confidence_level`, `payment_channel`,
  `merchant_entity_id` + `logo_url` + `website`, `counterparties`, `location.*`.
  (Coverage proven on Capital One: PFC 100%, channel 100%, counterparties 100%,
  merchant entity/logo/site ~13%, geo ~5%.)
- [ ] Branded, deduplicated merchant rollups (logo/website/entity id) in
  `/merchants`.
- [ ] Online vs in-store channel mix; PFC-based category accuracy reporting.

## Phase E: Analytics & Reporting Expansion

Goal: progressively richer reporting on Plaid data.

Status: Tier 1 live (pending the Phase A dataform refresh); Tiers 2–3 planned.

- Tier 1 — works today on Capital One Transactions data: overview snapshot,
  daily/monthly cash flow, category spend, merchant spend (90d), anomaly alerts,
  and the wide `transaction_analytics_base` feature table for ML/forecasting.
- Tier 2 — depends on Phase D: subscription/recurring audit, channel mix,
  branded-merchant rollups, AI-categorization accuracy.
- Tier 3 — new Plaid products (each needs the product on the link token + a fetch
  route + a BigQuery table):
  - [ ] Balances (`/accounts/balance/get`) — real-time balances, net worth.
  - [ ] Recurring Transactions (`/transactions/recurring/get`) — subscriptions,
    bills, paychecks.
  - [ ] Liabilities (`/liabilities/get`) — APR, statement/min payment, due dates.
  - [ ] Investments (`/investments/holdings`, `/investments/transactions`).
  - [ ] Bank Income (`/credit/bank_income/get`) — verified income.
  - [ ] Statements / Identity / Assets / Enrich as needed.

## Phase F: Multi-Institution

Goal: consolidate once more banks connect.

Status: not started.

- [ ] Cross-institution net worth + consolidated cash flow (`dim_account`
  carries `institution`; overview already aggregates per user).
- [ ] Inter-bank transfer reconciliation (`canonical_group_id` +
  `impossible_transfer_pairs` assertion already exist).
- [ ] Cross-account duplicate detection and unified category budgets.

## Verification (2026-06-21)

- Capital One ingestion confirmed via read-only `scripts/verify-plaid.ts`
  (BigQuery only; selects no secret columns).
- Storage guardrail confirmed: finance data in BigQuery; Postgres auth-only; no
  AlloyDB/Spanner/Bigtable/CloudSQL.
- Plaid connectivity fix: `typecheck` / `lint` / `build` / `npm test` pass.
