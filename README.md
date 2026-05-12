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

Plaid routes are scaffolded but not fully wired yet. CSV import remains the
fully functional ingestion path today.

## Warehouse ETL

For the current BigQuery setup, ETL roadmap, analytics table design, and
session-to-session working notes, see `WAREHOUSE_ETL_LIVING_SPEC.md`.

## Deploy

This app can be deployed like a standard Next.js project. Make sure the runtime
environment includes the same BigQuery and OpenAI env vars you expect in local
development.
