# Production Services

This document tracks the production service contract for Finance Tracker. It
does not contain secret values.

## Current Vercel State

Checked on 2026-06-19:

- Vercel CLI account: `dannydiaz04`
- Linked Vercel project: `finance-tracker`
- Production env keys currently present in Vercel: Neon/Postgres variables such
  as `DATABASE_URL`, `POSTGRES_URL`, `PGHOST`, `PGUSER`, and related Neon values.
- Production env keys still to add before first deploy: Auth.js secret and
  Google OAuth, BigQuery/Google Cloud credentials, Plaid production credentials,
  landing bucket, and optional OpenAI keys.

## Required Production Environment

The committed template is `.env.example`. Keep values empty in git.

Validate a fully populated environment with:

```bash
npm run env:check:production
```

When checking Vercel production values locally:

```bash
vercel env pull .env.production.local --environment=production --yes
set -a
source .env.production.local
set +a
npm run env:check:production
```

`.env.production.local` is ignored by git.

## Vercel Environment Variables

Add production variables through the dashboard or CLI. Prefer sensitive variables
for secret-bearing values.

```bash
vercel env add AUTH_SECRET production --sensitive
vercel env add AUTH_GOOGLE_ID production
vercel env add AUTH_GOOGLE_SECRET production --sensitive

vercel env add BIGQUERY_PROJECT_ID production
vercel env add BIGQUERY_LOCATION production
vercel env add GOOGLE_CLOUD_PROJECT production
vercel env add GOOGLE_CLOUD_CREDENTIALS_BASE64 production --sensitive

vercel env add PLAID_CLIENT_ID production --sensitive
vercel env add PLAID_SECRET production --sensitive
vercel env add PLAID_ENV production
vercel env add PLAID_WEBHOOK_URL production
vercel env add PLAID_REDIRECT_URI production

vercel env add WAREHOUSE_LANDING_BUCKET production

vercel env add OPENAI_API_KEY production --sensitive
vercel env add OPENAI_MODEL production
vercel env add OPENAI_CATEGORIZATION_MODEL production
```

Do not push `.env.local` wholesale into Vercel. Confirm each value is intended
for production first.

## Postgres

Production Postgres is expected to be Neon-backed on Vercel.

Required for app runtime:

- `DATABASE_URL`

Useful Neon/Vercel-provisioned companion variables may also exist:

- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`
- `POSTGRES_HOST`

After production `DATABASE_URL` is present, run:

```bash
npm run db:migrate
```

Run migrations only against the intended production database.

## Auth.js and Google OAuth

Required:

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`

Generate `AUTH_SECRET` with:

```bash
npx auth secret
```

Configure Google OAuth callback URLs after the production domain is known:

```text
https://<production-domain>/api/auth/callback/google
```

Use the Vercel production URL as a temporary callback only if no custom domain
exists yet.

## BigQuery and Google Cloud

Required:

- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_LOCATION`
- `GOOGLE_CLOUD_PROJECT`
- One of:
  - `GOOGLE_CLOUD_CREDENTIALS_JSON`
  - `GOOGLE_CLOUD_CREDENTIALS_BASE64`
  - `GOOGLE_APPLICATION_CREDENTIALS_JSON`
  - `GOOGLE_APPLICATION_CREDENTIALS_BASE64`

The app now supports explicit service account credentials from JSON or base64
environment variables. This is required for Vercel because local Application
Default Credentials are not available inside deployed functions.

Recommended production encoding:

```bash
base64 -i service-account.json | tr -d '\n'
```

Store the result in `GOOGLE_CLOUD_CREDENTIALS_BASE64` as a sensitive Vercel env
variable.

Minimum service account access should cover:

- Read dashboard marts and ops tables.
- Insert CSV/Plaid raw rows if those routes are enabled.
- Run required Dataform or BigQuery jobs from the chosen worker environment.
- Read/write the GCS landing bucket if the ETL runner uses GCS from that
  environment.

## Plaid

Required:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV=production`
- `PLAID_WEBHOOK_URL=https://<production-domain>/api/plaid/webhook`
- `PLAID_REDIRECT_URI=https://<production-domain>/connections`

Use Plaid production credentials only after Plaid production access is approved.
Sandbox credentials should stay in local/dev environments.

## GCS Landing Bucket

Required for the landed-file runner:

- `WAREHOUSE_LANDING_BUCKET`

Alternative:

- `WAREHOUSE_LANDING_URI=gs://<bucket-name>`

The bucket should have:

- Uniform bucket-level access.
- Public access prevention.
- Service account permissions scoped to object read/write/delete for the
  `incoming`, `processing`, `archive`, and `rejected` prefixes.

## OpenAI

Optional for basic dashboard operation, required for model-backed assistant and
AI enrichment:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_CATEGORIZATION_MODEL`

If `OPENAI_API_KEY` is absent, the app assistant falls back to local behavior,
but the AI enrichment worker cannot call OpenAI.

## First Production Readiness Check

Before first deploy:

```bash
vercel env pull .env.production.local --environment=production --yes
set -a
source .env.production.local
set +a
npm run env:check:production
npm run build
npm audit --omit=dev
```

After deploy:

- Sign in with Google.
- Confirm `/overview` reads warehouse-backed data.
- Confirm `/connections` sees Plaid configured.
- Confirm Plaid webhook URL is reachable.
- Confirm no secrets appear in client bundles or logs.
