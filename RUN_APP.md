# Run App Runbook

This is the local runbook for starting the Finance Tracker app, checking the warehouse connection, and running the flat-file ETL runner.

## Current Local Baseline

- Repository path: `/Users/danieldiaz/finance-tracker-codex`
- Main app framework: Next.js `16.2.1`
- React: `19.2.4`
- Node used in this session: `v24.10.0`
- npm used in this session: `11.10.0`
- BigQuery project: `finance-tracker-cdx`
- BigQuery location: `US`
- GCS landing bucket: `gs://finance-tracker-cdx-etl-landing`

## Dependencies

Install Node dependencies from the lockfile:

```bash
cd /Users/danieldiaz/finance-tracker-codex
npm install
```

The important runtime dependencies for local app and ETL work are:

- `next`
- `react`
- `@google-cloud/bigquery`
- `@google-cloud/storage`
- `@dataform/cli`
- `papaparse`
- `zod`

## Local Environment

Use a local `.env.local` file for secrets and local-only settings. Files matching `.env*` are gitignored.

Recommended `.env.local`:

```bash
BIGQUERY_PROJECT_ID=finance-tracker-cdx
BIGQUERY_LOCATION=US
GOOGLE_CLOUD_PROJECT=finance-tracker-cdx
WAREHOUSE_LANDING_BUCKET=finance-tracker-cdx-etl-landing
OPENAI_MODEL=gpt-5.2
OPENAI_API_KEY=
```

Notes:

- `OPENAI_API_KEY` is optional for basic local use. Without it, the assistant uses fallback behavior.
- `BIGQUERY_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` enables BigQuery reads.
- `WAREHOUSE_LANDING_BUCKET` lets the ETL runner default to `gs://finance-tracker-cdx-etl-landing`.

## Google Cloud Auth

Check the active gcloud account and project:

```bash
gcloud auth list
gcloud config get-value project
```

Set the project if needed:

```bash
gcloud config set project finance-tracker-cdx
```

Verify Application Default Credentials:

```bash
gcloud auth application-default print-access-token >/dev/null && echo ADC_OK
```

If ADC is not configured:

```bash
gcloud auth application-default login
```

## Start The App

Run the dev server:

```bash
cd /Users/danieldiaz/finance-tracker-codex
npm run dev
```

Open:

```text
http://localhost:3000
```

The root route redirects to:

```text
http://localhost:3000/overview
```

Useful app routes:

- `http://localhost:3000/overview`
- `http://localhost:3000/transactions`
- `http://localhost:3000/cashflow`
- `http://localhost:3000/categories`
- `http://localhost:3000/merchants`
- `http://localhost:3000/rules`
- `http://localhost:3000/assistant`

## Validation Commands

Run these before pushing app or ETL changes:

```bash
npm run lint
npm run typecheck
npm run test:imports
npm run dataform:compile
```

Known note:

- `npm run test:imports` may print a Node `MODULE_TYPELESS_PACKAGE_JSON` warning. The warning is currently non-blocking when tests pass.

## Run The GCS ETL Runner

Inspect the bucket:

```bash
gcloud storage ls "gs://finance-tracker-cdx-etl-landing/incoming/"
```

Upload a CSV into the landing pattern:

```bash
gcloud storage cp "/path/to/file.csv" "gs://finance-tracker-cdx-etl-landing/incoming/manual/2026/05/03/file.csv"
```

For exports that need runtime account context, upload a sidecar manifest next to the CSV:

```bash
gcloud storage cp "/path/to/file.csv.context.json" "gs://finance-tracker-cdx-etl-landing/incoming/manual/2026/05/03/file.csv.context.json"
```

Context manifest shape:

```json
{
  "sourceAccountId": "discover_card",
  "accountName": "Discover Card",
  "accountMask": "7788"
}
```

Run the GCS-backed runner:

```bash
npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 5
```

JSON output mode:

```bash
npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 5 --json
```

The runner lifecycle is:

```text
incoming/... -> processing/... -> archive/...
incoming/... -> processing/... -> rejected/...
```

Successful and rejected files get a result manifest:

```text
<file>.result.json
```

## Run The Local Filesystem ETL Runner

Local landing root:

```text
landing-zone/
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv.context.json
```

Run:

```bash
npm run etl:runner -- --landing-root ./landing-zone --max-files 5
```

`landing-zone/` is gitignored.

## Build And Production Start

Build:

```bash
npm run build
```

Start the production build:

```bash
npm run start
```

Then open:

```text
http://localhost:3000
```

## Troubleshooting

If BigQuery reads fail:

```bash
gcloud config get-value project
gcloud auth application-default print-access-token >/dev/null && echo ADC_OK
```

If the GCS runner cannot authenticate:

```bash
gcloud auth application-default login
```

If port `3000` is already in use, run Next on another port:

```bash
npm run dev -- -p 3001
```

Then open:

```text
http://localhost:3001
```

If dependencies look stale:

```bash
npm install
```

