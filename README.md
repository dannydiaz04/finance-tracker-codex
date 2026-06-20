## Finance Tracker

Warehouse-first personal finance explorer built with Next.js, BigQuery, and a
dashboard-native assistant.

## Getting Started

Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000). The app redirects to the
dashboard overview.

## Dashboard Assistant

The dashboard now includes an `/assistant` route that can:

- Explain what each dashboard page does and how to use it.
- Summarize the current finance snapshot using the same server-side queries as the
  rest of the app.
- Explain internal workflows like CSV import, normalization, deterministic rules,
  overrides, review queues, warehouse reads, and Plaid scaffolding.

If `OPENAI_API_KEY` is not set, the assistant still works in a local fallback mode
using the live or sample dashboard context.

To enable model-backed responses, set:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.2
OPENAI_CATEGORIZATION_MODEL=gpt-5.2
```

`OPENAI_MODEL` is optional. If omitted, the assistant defaults to `gpt-5.2`.
`OPENAI_CATEGORIZATION_MODEL` is optional for the ETL categorization runner.

## AI Categorization ETL

The flat-file ETL path can enrich low-confidence transactions in batch:

```bash
npm run etl:ai-enrich -- --limit 50
```

This reads `ops_finance.ai_enrichment_queue`, calls OpenAI with `OPENAI_API_KEY`,
writes suggestions to `ops_finance.ai_enrichment_results`, and lets the warehouse
classification model consume only accepted high-confidence results.

## Authentication and multi-user

The app is multi-user: every visitor signs in (email/password or Google), and all
data is isolated per user via a `user_id` that flows from ingestion through every
BigQuery table, Dataform model, and query.

Identity lives in Postgres via Auth.js v5 (`next-auth`) + Drizzle; the Postgres
`user.id` is the `user_id` stamped on all warehouse rows.

Required environment variables:

```bash
DATABASE_URL=postgres://user:pass@host:5432/dbname
AUTH_SECRET=generate_with_npx_auth_secret
AUTH_URL=https://www.financetracker.dev
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
```

Setup:

1. Provision Postgres and set `DATABASE_URL`; create a Google OAuth client
   (redirect URI `http://localhost:3000/api/auth/callback/google`).
2. Generate `AUTH_SECRET` with `npx auth secret`.
3. Create the auth tables: `npm run db:migrate` (or `npm run db:push`).
4. Apply the warehouse multi-user migrations (idempotent):

```bash
bq query --use_legacy_sql=false < sql/warehouse/07_add_user_id_columns.sql
bq query --use_legacy_sql=false < sql/warehouse/08_add_account_balances.sql
```

5. Sign up at `/sign-up`, then (optional) backfill any pre-existing warehouse data
   to your new account: edit `sql/warehouse/09_backfill_user_id.sql` with your
   user id, run it, and rerun `npx dataform run dataform`.

Routes outside the sign-in/sign-up pages, the Auth.js endpoints, and the Plaid
webhook are gated by `proxy.ts`. The Plaid webhook resolves the owning user from
the stored Item, so it needs no session.

For production, set `AUTH_GOOGLE_ID` to the raw Google OAuth Web client ID ending
in `.apps.googleusercontent.com`; do not include quotes, brackets, or the
`AUTH_GOOGLE_ID=` prefix in the Vercel value. Set `AUTH_URL` to the canonical
origin, currently `https://www.financetracker.dev`. The Google OAuth client used
by `AUTH_GOOGLE_ID` must authorize this exact redirect URI:

```text
https://www.financetracker.dev/api/auth/callback/google
```

Vercel needs a fresh production deployment after auth env changes.

## Data Sources

- If BigQuery is configured, dashboard queries read from the warehouse marts and
  ops tables.
- If BigQuery is not configured, the app falls back to curated sample finance
  data so the UI and assistant remain usable.

Relevant environment variables:

```bash
BIGQUERY_PROJECT_ID=your_project
BIGQUERY_LOCATION=US
GOOGLE_CLOUD_PROJECT=your_project
```

## Plaid account linking

You can connect bank and credit card accounts with Plaid in addition to (or
instead of) CSV import. Plaid transactions flow into the **same**
`raw_finance.transaction_events` model as CSV (`source_name = "plaid"`), so every
downstream mart, rule, and dashboard works unchanged.

Set up:

```bash
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox            # sandbox or production
PLAID_WEBHOOK_URL=https://your-public-tunnel/api/plaid/webhook   # optional
PLAID_REDIRECT_URI=https://your-app/connections                  # optional (OAuth banks)
```

Create the item store table once (or run `npx dataform run dataform`, which now
includes it):

```bash
bq query --use_legacy_sql=false < sql/warehouse/06_create_plaid_items.sql
```

Flow:

1. Open `/connections` and click **Connect a bank** to launch Plaid Link.
2. The public token is exchanged server-side; the durable access token and a
   per-item sync cursor are stored in `ops_finance.plaid_items`.
3. `/api/plaid/sync` (and the Plaid `SYNC_UPDATES_AVAILABLE` webhook) call
   `/transactions/sync`, writing added/modified/removed events and upserting
   account metadata, including current/available balances shown on the Overview.
4. Run `npx dataform run dataform` to refresh the marts.

Set `PLAID_WEBHOOK_URL` (a public HTTPS URL ending in `/api/plaid/webhook`, e.g.
via an ngrok tunnel in dev) to enable webhook-driven auto-sync; the Connections
page shows whether auto-sync is on.

API routes: `POST /api/plaid/link-token`, `POST /api/plaid/exchange`,
`POST /api/plaid/sync`, and `POST /api/plaid/webhook`.

> Security: the Plaid `access_token` is a long-lived credential stored in
> BigQuery. Restrict IAM access to `ops_finance.plaid_items`, and consider moving
> the token to Secret Manager for production.

If Plaid env vars are absent, the Connections page explains the setup and CSV
import remains the fully functional ingestion path.

## Warehouse ETL

For the current BigQuery setup, ETL roadmap, analytics table design, and
session-to-session working notes, see `WAREHOUSE_ETL_LIVING_SPEC.md`.

## Deploy

This app can be deployed like a standard Next.js project. Make sure the runtime
environment includes the same BigQuery and OpenAI env vars you expect in local
development.
