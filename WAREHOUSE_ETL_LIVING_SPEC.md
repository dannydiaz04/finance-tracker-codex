# Warehouse ETL Living Spec

## Purpose
This document is the working source of truth for the BigQuery warehouse layout, ETL plan, analytics table design, and future AI-assisted enrichment pipeline.

Use this file across future sessions to:

- Record what is already live in Google Cloud.
- Track what is checked into the repo versus only created manually in BigQuery.
- Capture current assumptions, known gaps, and next implementation steps.
- Keep a running log of schema, ETL, and data-injection decisions.

Do not store secrets in this file. Reference environment variable names only.

## Current Status
- BigQuery project: `finance-tracker-cdx`
- BigQuery location: `US`
- Local Google Cloud Application Default Credentials were verified in this repo session.
- `dataform/workflow_settings.yaml` now points Dataform at `finance-tracker-cdx`.
- Live datasets created directly in BigQuery:
  - `raw_finance`
  - `stg_finance`
  - `core_finance`
  - `ops_finance`
  - `mart_finance`
  - `analytics_finance`
- Live tables created directly in BigQuery:
  - `raw_finance.import_batches`
  - `raw_finance.transaction_events`
  - `analytics_finance.transaction_analytics_base`
- Repo models added:
  - `dataform/definitions/analytics/transaction_analytics_base.sqlx`
  - `dataform/definitions/ops/ai_enrichment_queue.sqlx`
- Validation completed successfully:
  - `npm run dataform:compile`
- Flat-file landing-zone workflow is now defined in this spec as the planned first mile for ingestion.
- Planned landing-zone file types now include delimited text, JSON, Parquet, and Arrow-family files.
- Google Cloud Storage landing bucket `gs://finance-tracker-cdx-etl-landing` is now provisioned in `US` with `incoming`, `processing`, `archive`, and `rejected` prefix placeholders.
- The bucket uses Standard storage, uniform bucket-level access, public access prevention, and the default 7-day soft-delete policy.
- A source-mapping registry now exists in `WAREHOUSE_SOURCE_MAPPINGS.md` with versioned YAML profiles under `source-mappings/`.
- Six first-pass source profiles are now documented for:
  - `capital_one_360_checking_5980`
  - `apple_card`
  - `chase_card_1325`
  - `american_express_card`
  - `micro_center_card`
  - `discover_card`
- Account identity is now standardized across these profiles using a stable machine `sourceAccountId` and a human-readable `accountName`.
- Feed-specific sign and pending semantics are now documented for the six current exports:
  - Apple Card: blank `Clearing Date` means `pending = true`
  - Chase: blank `Post Date` means `pending = true`
  - Discover: blank `Post Date` means `pending = true`
  - Capital One 360 Checking and Micro Center exports are confirmed-only and should load with `pending = false`
  - Micro Center uses one headerless date column as both transaction and post date
  - American Express uses a confirmed `Date` header and prefers `Reference` as the transaction identifier when present
- The shared CSV import path now resolves explicit YAML source profiles by filename, header signature, and headerless column shape before falling back to generic header alias inference.
- The shared runtime account context contract is now implemented in the app-side upload path using `sourceAccountId`, `accountName`, and optional `accountMask`.
- CSV normalization now supports source-specific date parsing, pending detection, sign transforms, deterministic `sourceTransactionId` derivation, and extra canonical raw payload fields such as `currencyCode`, `runningBalance`, `memo`, and `referenceNumber`.
- Fixture-based replay coverage now exists for the six documented exports plus one generic fallback CSV.
- The raw CSV persistence path now maps parser output into explicit snake_case BigQuery rows for `raw_finance.import_batches` and `raw_finance.transaction_events`.
- The checked-in `raw_finance.import_batches` definition now includes mapping-resolution metadata columns for `mapping_profile_id`, `mapping_resolution_strategy`, `mapping_matched_by`, and runtime account context fields.
- The live `raw_finance.import_batches` table now includes the six mapping-resolution metadata columns defined in the repo schema.
- The raw `transaction_events.payload` BigQuery JSON insert contract is now implemented by serializing payloads to JSON text before streaming insert.
- A first standalone landing runner now exists in the repo at `lib/import/runner.ts` with a CLI entrypoint at `scripts/run-landed-imports.ts`.
- The current runner supports both local filesystem landing roots and GCS landing roots such as `gs://finance-tracker-cdx-etl-landing`.
- The current runner can scan `incoming/...`, claim files into `processing/...`, and move processed files into `archive/...` or `rejected/...` for either storage backend.
- The current runner supports `.csv` files only, persists them through the shared `parseCsvImport()` and `persistCsvImport()` path, and archives or rejects the original landed files.
- Files that require runtime account identity injection can now supply it through a sidecar manifest named `<file>.context.json`.
- The runner now writes a per-file result manifest named `<file>.result.json` into `archive/...` or `rejected/...` so checksum, status, mapping resolution, and error details remain attached to the original landed file.
- The runner CLI now accepts `--gcs-bucket finance-tracker-cdx-etl-landing`; `WAREHOUSE_LANDING_URI` or `WAREHOUSE_LANDING_BUCKET` can also select GCS without a CLI flag.
- A fixture-backed live verification import using the American Express activity export succeeded against BigQuery and confirmed both batch metadata and event payload persistence.
- Two earlier verification attempts left metadata-only `import_batches` rows with zero matching `transaction_events` before the JSON payload fix was applied.
- Validation completed successfully:
  - `npm run test:imports`
  - `npm run typecheck`
  - `npm run dataform:compile`
- A local landed-file run loaded seven fixture CSV files into live raw BigQuery tables, one row per file, with zero rejections.
- A live Dataform run completed successfully after replacing BigQuery-conflicting `current` aliases in two SQLX files.
- The app was verified locally against the materialized warehouse marts at `/overview` and `/transactions`.
- App-readiness SQL scripts now exist under `sql/warehouse/` for auditing, deterministic category-rule seeding, account metadata seeding, and optional orphan import-batch cleanup review.
- `ops_finance.category_rules` is seeded with first-pass merchant rules for the current fixture data, reducing current uncategorized transactions to `0`.
- `ops_finance.account_metadata` now provides account display names, institutions, account types, subtypes, currencies, and masks for observed fixture accounts.
- `stg_finance.accounts_clean` and `mart_finance.overview_snapshot` now consume account metadata so the app sees cleaned account labels consistently.
- Current app-readiness audit result after seeding and Dataform materialization:
  - `core_finance.fact_transaction_current`: `7`
  - `analytics_finance.transaction_analytics_base`: `7`
  - `mart_finance.overview_snapshot`: `1`
  - `uncategorized_current_transactions`: `0`
  - `generic_card_masks`: `0`
  - `category_mix_rows`: `3`
  - `review_queue_count`: `3`
  - `import_batches_without_matching_events`: `2`
- The current fixture dataset is app-usable for category/account display, but it is not yet production-like because it has only outflows, no income or starting balances, three source-pending rows, and two older metadata-only verification batches.

## Repository Touchpoints
- `WAREHOUSE_SOURCE_MAPPINGS.md`
- `source-mappings/`
- `app/api/import/csv/route.ts`
- `lib/import/csv.ts`
- `lib/import/mapping.ts`
- `lib/import/normalize.ts`
- `lib/import/persistence.ts`
- `lib/import/runner.ts`
- `lib/assistant/knowledge.ts`
- `scripts/run-landed-imports.ts`
- `tests/import/parse-csv-import.test.mjs`
- `tests/import/persistence.test.mjs`
- `tests/import/runner.test.mjs`
- `tests/fixtures/imports/`
- `js-yaml.d.ts`
- `package.json`
- `tsconfig.json`
- `lib/bigquery/client.ts`
- `lib/categorization/normalize.ts`
- `lib/categorization/rules.ts`
- `lib/assistant/openai.ts`
- `dataform/workflow_settings.yaml`
- `dataform/definitions/raw/import_batches.sqlx`
- `dataform/definitions/raw/transaction_events.sqlx`
- `dataform/definitions/staging/transactions_clean.sqlx`
- `dataform/definitions/staging/accounts_clean.sqlx`
- `dataform/definitions/core/fact_transaction_current.sqlx`
- `dataform/definitions/core/fact_transaction_history.sqlx`
- `dataform/definitions/core/fact_classification.sqlx`
- `dataform/definitions/ops/review_queue.sqlx`
- `dataform/definitions/ops/ai_enrichment_queue.sqlx`
- `dataform/definitions/ops/account_metadata.sqlx`
- `dataform/definitions/analytics/transaction_analytics_base.sqlx`
- `dataform/definitions/marts/overview_snapshot.sqlx`
- `sql/warehouse/01_app_readiness_audit.sql`
- `sql/warehouse/02_seed_initial_category_rules.sql`
- `sql/warehouse/03_seed_account_metadata.sql`
- `sql/warehouse/04_cleanup_orphan_import_batches.sql`

## Environment And Auth
Expected environment variables:

```bash
BIGQUERY_PROJECT_ID=finance-tracker-cdx
BIGQUERY_LOCATION=US
GOOGLE_CLOUD_PROJECT=finance-tracker-cdx
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2
```

Notes:

- `OPENAI_API_KEY` should remain local or in a secure secret store. Never commit the literal value.
- `OPENAI_MODEL` is optional today. The app defaults to `gpt-5.2`.
- BigQuery access in this repo is currently working through local Google Cloud auth plus Application Default Credentials.

Useful verification commands:

```bash
gcloud auth list
gcloud config get-value project
gcloud auth application-default print-access-token >/dev/null && echo ADC_OK
npm run dataform:compile
```

## Warehouse Topology
The intended warehouse shape is:

```text
Flat Files / Bank Exports
  -> Cloud Storage landing zone
  -> ingestion runner
  -> raw_finance
  -> stg_finance
  -> core_finance
  -> ops_finance and mart_finance
  -> analytics_finance
  -> future AI enrichment outputs
```

Dataset purposes:

- `raw_finance`: append-only ingestion metadata and source transaction events.
- `stg_finance`: cleaned, latest-state transaction and account views.
- `core_finance`: reusable facts and dimensions for application and analytics.
- `ops_finance`: review queues, overrides, and operational worklists.
- `mart_finance`: dashboard-facing rollups and search helpers.
- `analytics_finance`: wide, analytics-ready tables for BI, forecasting, modeling, and feature engineering.

## Current ETL Flow
The current and intended near-term flow is:

1. Flat files are dropped untouched into a landing root such as local `landing-zone/incoming/...` today and future `gs://finance-tracker-cdx-etl-landing/incoming/...` in production.
2. A standalone ingestion runner claims one landed file at a time by moving it into `processing/...`, validates the file, and records landing metadata.
3. The runner routes each claimed file to the correct format adapter based on extension and structure.
4. The current implemented adapter is the shared CSV-style parser surfaced at `app/api/import/csv/route.ts`; future adapters should handle JSON, Parquet, Arrow, and related formats while emitting the same canonical row shape.
5. The shared CSV parser now resolves a versioned source-mapping profile from `source-mappings/` using filename, header signature, or headerless column shape, then injects runtime account context such as `sourceAccountId`, `accountName`, and optional `accountMask` when the file does not identify the account directly.
6. `lib/import/mapping.ts` now prefers explicit source-profile resolution with fallback alias-based header inference only when no source-specific profile exists.
7. `lib/import/normalize.ts` standardizes dates, amounts, descriptions, merchant text, transaction direction, and keywords.
8. The ingestion library builds import-batch metadata plus transaction events for BigQuery insertion. Today this lives in `lib/import/csv.ts`.
9. `raw_finance.transaction_events` stores event-level transaction payloads as JSON.
10. `stg_finance.transactions_clean` extracts the latest non-removed version of each transaction.
11. `core_finance.fact_classification` applies overrides, deterministic rules, institution hints, and fallback logic.
12. `core_finance.fact_transaction_current` becomes the main canonical transaction fact for the app.
13. `ops_finance.review_queue` identifies rows needing manual review.
14. `analytics_finance.transaction_analytics_base` widens the modeled data for descriptive and predictive analytics.
15. `ops_finance.ai_enrichment_queue` identifies posted rows that are good candidates for future OpenAI-assisted standardization and categorization.

Important operational note:

- A standalone runner now exists and can move landed `.csv` files from `incoming/...` to `archive/...` or `rejected/...` while loading `raw_finance.import_batches` and `raw_finance.transaction_events`.
- The runner now supports the same lifecycle against either a local landing root or the GCS landing bucket.
- The shared CSV parsing and raw-write path already exists and should be reused by the landing-zone runner instead of duplicated.
- The source mapping registry and six first-pass YAML mapping profiles are now checked into the repo, and the shared CSV parser already loads them. The standalone landing runner reuses that shared path instead of re-implementing mapping logic.
- Runtime account context injection for `sourceAccountId`, `accountName`, and optional `accountMask` is now implemented in the app-side upload route, shared CSV parser, and standalone runner.
- Fixture-based replay coverage now exists for the six documented source profiles plus one generic fallback CSV.
- GCS-backed runner scanning, claiming, archiving, rejection, and result-manifest writes are implemented. BigQuery-backed landing lifecycle metadata is still pending.
- Non-CSV adapters are part of the intended landing-zone design, but they are not implemented in the repo yet.
- The Dataform graph now includes `analytics_finance.transaction_analytics_base` and `ops_finance.ai_enrichment_queue`, but only compilation has been validated so far.
- A full `dataform run` against BigQuery has now materialized staging, core, mart, ops, analytics, and assertion objects.

## Flat-File Landing Zone Plan
The first explicit ETL step should be a Google Cloud Storage landing zone that receives untouched source files before any parsing or transformation. This creates a durable replay point, gives us a simple place to manually drop bank exports, and cleanly separates file handling from downstream warehouse transforms.

### Recommended Landing Spot
- Primary bucket pattern: `gs://finance-tracker-cdx-etl-landing`
- If separate environments are introduced later, suffix the bucket by environment such as `gs://finance-tracker-cdx-etl-landing-dev` and `gs://finance-tracker-cdx-etl-landing-prod`
- Keep landed files immutable after upload
- Treat one physical file as one ingestion unit and one `import_batch_id`

### Prefix Contract
- `incoming/<source_system>/<YYYY>/<MM>/<DD>/` for files newly dropped and awaiting claim
- `processing/<source_system>/<YYYY>/<MM>/<DD>/` for files currently owned by one ingestion run
- `archive/<source_system>/<YYYY>/<MM>/<DD>/` for successfully loaded originals
- `rejected/<source_system>/<YYYY>/<MM>/<DD>/` for invalid or failed files plus failure notes

### Accepted Landing File Types
- `.csv` for standard comma-delimited exports
- `.txt` for structured delimited text exports such as tab-delimited or pipe-delimited bank downloads
- `.json` for JSON arrays or JSON objects that contain transaction arrays
- `.jsonl` or `.ndjson` for one JSON object per line
- `.parquet` for columnar batch exports
- `.arrow` or `.feather` for Apache Arrow table exports

Recommendation:

- Accept files in their original bank or vendor export format whenever possible
- Avoid manual conversion before upload because conversion breaks replay and can hide lineage issues
- Require every format adapter to produce the same canonical transaction-row contract before raw BigQuery writes

### File Naming Convention
Use a deterministic file name:

```text
<institution>__<account_or_feed>__<export_date>__<sequence>.<extension>
```

Example:

```text
chase__checking__2026-04-04__01.csv
amex__card_activity__2026-04-04__01.parquet
```

### Format Handling Rules
- Route `.csv` and delimited `.txt` files through the current CSV-style parser and header-mapping flow
- Route `.json`, `.jsonl`, and `.ndjson` files through a JSON adapter that emits one canonical row per transaction
- Route `.parquet`, `.arrow`, and `.feather` files through a columnar adapter that maps fields into the recommended canonical source schema
- Reject files whose extension and actual structure do not match
- Reject files with unsupported formats as `UNSUPPORTED_FORMAT` instead of manually converting them outside the pipeline

### Minimal Landing Metadata
For each landed file, capture at least:

- `source_file_name`
- `landing_uri`
- `source_system`
- `file_format`
- `file_size_bytes`
- `file_checksum`
- `dropped_at`
- `claimed_at`
- `processed_at`
- `landing_status`
- `error_reason`

This metadata can either extend `raw_finance.import_batches` or live in a separate table such as `raw_finance.landing_files` if we want file-lifecycle tracking to remain distinct from parsed batch metadata.

### Very Easy Repeatable Operating Procedure
1. Export the source file and leave it unchanged after download.
2. Upload the file to `incoming/...` using the naming convention, correct extension, and date path.
3. Run a standalone ingestion job that lists `incoming/...`, claims one file by moving it to `processing/...`, and computes checksum plus metadata.
4. Validate that the file is non-empty, that its structure matches its extension, and that its format is enabled in the runner.
5. Route the file to the correct parser or adapter. CSV and delimited TXT should use the shared CSV logic already used by the app.
6. Write batch metadata and raw transaction events into `raw_finance.import_batches` and `raw_finance.transaction_events`.
7. If the load succeeds, move the original file to `archive/...`.
8. If the load fails or the format is not yet supported, move the original file to `rejected/...` and record the reason for correction or later replay.
9. For reprocessing, replay the archived original file instead of reusing edited local copies.

### Recommended First Implementation Choice
For this landing phase, the first production runner should be a small standalone Node job or Cloud Run job that calls the shared import library. Dataform should remain responsible for downstream SQL transforms after raw data lands in BigQuery.

Why this is the simplest first version:

- Manual file drops can start immediately without building more UI
- The runner can reuse `parseCsvImport()` and `persistCsvImport()` instead of duplicating logic
- File claiming and archiving are easier outside the Next.js request lifecycle
- Replays become deterministic because the original file remains stored and addressable by URI plus checksum

Current repo implementation note:

- The first checked-in runner is a standalone Node job that can use either a local landing root or a GCS landing root with the same `incoming`, `processing`, `archive`, and `rejected` prefixes described in this spec.
- The current local CLI entrypoint is `npm run etl:runner -- --landing-root ./landing-zone --max-files 1`.
- The current GCS CLI entrypoint is `npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 1`.
- The current runner only accepts `.csv` files and rejects all other formats as `UNSUPPORTED_FORMAT`.
- Account identity injection is supplied through an adjacent `<file>.context.json` manifest when needed.

### Adapter Support Matrix
The landing zone may accept multiple file types, but the ingestion runner should bring them online in a deliberate order so the canonical raw-event contract stays stable.

| File type | Land in bucket | Adapter approach | Canonicalization notes | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| `.csv` | yes | Reuse `lib/import/csv.ts` and existing mapping plus normalization flow | Header-based mapping into the canonical transaction-row contract | P0 | implemented in repo for direct upload, local landing runner, and GCS landing runner |
| `.txt` | yes | Treat as delimited text and route through the CSV-style parser with delimiter detection or source config | Same contract as CSV once delimiter and headers are resolved | P1 | planned |
| `.json` | yes | JSON adapter that supports arrays plus configurable transaction array paths | Flatten records into the same canonical row shape before raw writes | P1 | planned |
| `.jsonl` / `.ndjson` | yes | Line-by-line JSON adapter | Each line becomes one canonical transaction row | P1 | planned |
| `.parquet` | yes | Columnar adapter that reads record batches and maps fields into the canonical schema | Best for vendor exports that already preserve types such as timestamps and decimals | P2 | planned |
| `.arrow` / `.feather` | yes | Arrow-family adapter using the same canonical field mapping as Parquet | Best treated as a later optimization once row-oriented formats are stable | P3 | planned |

Implementation rule:

- Every adapter must emit the same canonical row payload before writing to `raw_finance.transaction_events`
- Validation, dedupe, and replay semantics should stay format-independent even when parsing logic differs by adapter
- New formats should be enabled behind explicit allowlists until they pass end-to-end replay tests

### Source Mapping Registry And Account Identity
The source mapping registry now lives in:

- `WAREHOUSE_SOURCE_MAPPINGS.md` for the narrative registry and implementation notes
- `source-mappings/*.yaml` for versioned machine-readable mapping profiles

Account identity convention:

- `sourceAccountId` is the stable machine identifier written into raw events
- `sourceAccountId` should be lowercase snake_case following `<institution>_<product_or_account>[_<mask>]`
- `accountName` is the human-readable display label for downstream models and the app
- `accountName` should be Title Case following `<Institution> <Product> [mask]`
- If an export does not identify the underlying account directly, the runner should inject `sourceAccountId`, `accountName`, and optional `accountMask` at runtime using the same convention

Current first-pass registry:

| Feed | Mapping profile | `sourceAccountId` | `accountName` | Current notes |
| --- | --- | --- | --- | --- |
| Capital One 360 Checking (...5980) | `source-mappings/capital_one.360_checking_5980.csv.v1.yaml` | `capital_one_360_checking_5980` | `Capital One 360 Checking` | Confirmed-only export; running balance present |
| Apple Card Transactions | `source-mappings/apple_card.transactions.csv.v1.yaml` | `apple_card` | `Apple Card` | Blank `Clearing Date` means pending; purchase amounts invert to negative outflows |
| Chase Card Activity (...1325) | `source-mappings/chase.card_1325.csv.v1.yaml` | `chase_card_1325` | `Chase Card 1325` | Blank `Post Date` means pending; source sign already matches warehouse convention |
| American Express Activity | `source-mappings/american_express.activity.csv.v1.yaml` | `american_express_card` | `American Express Card` | `Date` header confirmed; `Reference` preferred for transaction identity |
| Micro Center Credit Card Export | `source-mappings/micro_center.credit_card_1.csv.v1.yaml` | `micro_center_card` | `Micro Center Card` | Headerless export; single date column is both transaction and post date; confirmed-only |
| Discover All Available Export | `source-mappings/discover.all_available.csv.v1.yaml` | `discover_card` | `Discover Card` | Blank `Post Date` means pending; source amounts invert to warehouse sign convention |

Implication for runner development:

- The runner uses the shared `mappingResolver` that selects profiles by filename, header signature, or headerless column shape
- The runner should pass the same runtime account context keys into every profile
- Headerless feeds such as Micro Center should bypass normal header inference entirely
- Generic filenames such as `activity` require stronger header-signature matching than filename matching alone

### Ingestion Runner Backlog
This is the recommended order for implementing the landing-zone runner.

Current repo status:

- A standalone runner exists for `.csv` files and reuses the shared parser plus raw BigQuery write path.
- The runner supports local filesystem and GCS landing roots with the same lifecycle prefix contract.
- Remaining backlog items cover BigQuery-backed landing metadata, richer rejection tracking, feed configuration, and non-CSV adapters.

#### Phase 1: Landing Foundation
- Create the landing bucket and the `incoming`, `processing`, `archive`, and `rejected` prefixes
- Add landing metadata tracking in `raw_finance.import_batches` or a new `raw_finance.landing_files` table
- Define lifecycle statuses such as `RECEIVED`, `CLAIMED`, `LOADED`, `REJECTED`, and `ARCHIVED`
- Add checksum generation, file-size capture, and deterministic `import_batch_id` assignment
- Define rejection reasons including `UNSUPPORTED_FORMAT`, `EMPTY_FILE`, `SCHEMA_MISMATCH`, `PARSE_ERROR`, and `LOAD_ERROR`

#### Phase 2: Runner Skeleton
- Create a standalone Node or Cloud Run entrypoint that lists `incoming/...` and claims one file at a time
- Implement safe claiming by moving the file to `processing/...` before parsing
- Add format dispatch based on extension plus lightweight content validation
- Reuse the existing CSV parser and raw BigQuery write path for the first runnable version
- Move successful files to `archive/...` and failed files to `rejected/...`

#### Phase 3: CSV And TXT Hardening
- Keep `.csv` as the first fully supported production format
- Add delimiter detection or source-specific configuration for `.txt`
- Add duplicate-file detection using checksum plus source file name
- Add replay support from `archive/...` without requiring local file edits
- Validate JS-to-BigQuery field mapping explicitly for raw table writes

#### Phase 4: JSON Family Adapters
- Build a JSON adapter for array payloads and nested transaction collections
- Build a JSONL or NDJSON adapter for one-record-per-line feeds
- Add source-specific mapping configuration for record paths and field aliases
- Ensure JSON adapters produce the same canonical row contract as CSV
- Add representative fixture files for replay and schema-validation testing

#### Phase 5: Columnar Adapters
- Add a Parquet adapter after row-oriented formats are stable
- Add Arrow or Feather support only if real upstream sources require it
- Define type-mapping rules for decimals, dates, timestamps, booleans, and nullable fields
- Add memory and file-size guardrails so large columnar files do not overwhelm the runner
- Confirm that columnar adapters still write event-level raw payload lineage into BigQuery

#### Phase 6: Operational Hardening
- Add structured logs with `import_batch_id`, `landing_uri`, `file_format`, and row counts
- Add retry policy for transient storage and BigQuery failures
- Add dead-letter handling for files that repeatedly fail parsing or loading
- Add a simple operator runbook for replay, rejection review, and backfill
- Add end-to-end validation that a landed file can be traced through raw, staging, core, and analytics outputs

### Minimum Runner Components
The first runner implementation should include these logical pieces:

- `storageScanner` to list `incoming/...` candidates
- `fileClaimer` to atomically move a file into `processing/...`
- `formatDetector` to validate extension and basic structure
- `adapterRegistry` to route files to CSV, TXT, JSON, JSONL, Parquet, or Arrow handlers
- `canonicalMapper` to emit the shared transaction-row contract
- `rawLoader` to write batch metadata and events into BigQuery
- `archiveManager` to move files into `archive/...` or `rejected/...`
- `runReporter` to emit logs, counts, and failure reasons

These can all live in one small module at first. They only need to be split into separate packages or services if volume or operational complexity grows.

## Live BigQuery Objects
Objects known to be live in Google Cloud:

| Object | Type | Status | Notes |
| --- | --- | --- | --- |
| `raw_finance.import_batches` | table | live | Raw import batch metadata |
| `raw_finance.transaction_events` | table | live | Raw append-only transaction events with JSON payload |
| `ops_finance.category_rules` | table | live | Deterministic merchant and description rules |
| `ops_finance.manual_overrides` | table | live | Manual transaction-level override table |
| `ops_finance.account_metadata` | table | live | Account display metadata used by staging and marts |
| `analytics_finance.transaction_analytics_base` | table | live | Wide analytics table, 97 fields, partitioned by `posted_at` |

Objects checked into the repo and compiled successfully:

| Object | Type | Status | Notes |
| --- | --- | --- | --- |
| `stg_finance.transactions_clean` | view | compiled | Extracts clean latest-state transactions |
| `stg_finance.accounts_clean` | view | compiled | Distinct account dimension staging enriched with account metadata |
| `core_finance.fact_classification` | table | compiled | Deterministic classification ladder |
| `core_finance.fact_transaction_current` | table | compiled | Canonical current-state transactions |
| `core_finance.fact_transaction_history` | table | compiled | Event history across imports |
| `core_finance.dim_account` | table | compiled and live | Clean account dimension for app and marts |
| `core_finance.dim_category` | table | compiled and live | Seeded category dimension |
| `core_finance.dim_merchant` | table | compiled and live | Merchant dimension from current transactions |
| `mart_finance.overview_snapshot` | table | compiled and live | Dashboard snapshot using cleaned account metadata |
| `mart_finance.category_spend_daily` | table | compiled and live | Category spend rollup |
| `mart_finance.daily_cashflow` | table | compiled and live | Daily inflow, outflow, and net rollup |
| `mart_finance.monthly_cashflow` | table | compiled and live | Monthly inflow, outflow, and net rollup |
| `mart_finance.merchant_spend_90d` | table | compiled and live | Merchant spend rollup |
| `mart_finance.search_suggestions` | view | compiled and live | Search suggestions for app lookup |
| `ops_finance.review_queue` | view | compiled | Manual-review worklist |
| `ops_finance.ai_enrichment_queue` | view | compiled | Future model-enrichment worklist |
| `ops_finance.account_metadata` | operation | compiled and live | Creates account metadata table if missing |
| `analytics_finance.transaction_analytics_base` | table | compiled and live | Repo model matches the intended analytics target |

## Analytics Base Table
The live analytics table is `analytics_finance.transaction_analytics_base`.

Design goals:

- Support descriptive analytics without repeated joins back into raw event payloads.
- Support predictive analytics and feature engineering from the same base table.
- Preserve both modeled fields and raw-bank fallback fields.
- Keep lineage to source imports and transaction events.

The table currently contains 97 fields grouped into the following domains.

### Lineage And Ingestion
- `transaction_id`, `source_transaction_id`, `canonical_group_id`
- `import_batch_id`, `source_file_name`, `imported_at`
- `source_system`, `latest_event_timestamp`
- `event_count`, `first_seen_at`, `last_seen_at`

### Account
- `account_id`, `account_name`
- `account_type`, `account_subtype`
- `institution_name`
- `account_currency_code`
- `account_mask`

### Transaction Core
- `posted_at`, `authorized_at`, `authorized_date`
- `auth_to_post_days`
- `is_pending`
- `signed_amount`, `amount_abs`
- `debit_credit_indicator`
- `direction`
- `transaction_class`

### Description And Merchant
- `description_raw`, `description_norm`
- `merchant_raw`, `merchant_norm`, `merchant_key`
- `institution_category`

### Classification
- `derived_category_id`, `category_label`, `subcategory_id`
- `classification_source`, `confidence_score`, `rule_id`
- `is_transfer`, `is_duplicate`
- `keyword_array`

### Bank Detail And Balances
- `transaction_currency_code`
- `running_balance`, `available_balance`
- `original_description`, `memo`
- `reference_number`, `check_number`
- `transaction_type`, `transaction_subtype`
- `payment_channel`, `payment_method`

### Counterparty And Merchant Metadata
- `merchant_id`, `merchant_category`, `merchant_category_code`
- `counterparty_name`, `counterparty_account_id`, `counterparty_type`

### Geography And Device
- `merchant_city`, `merchant_state`, `merchant_postal_code`, `merchant_country`
- `latitude`, `longitude`
- `device_type`, `online_order_id`

### Statement And Recurrence
- `statement_id`, `statement_date`
- `recurring_group_id`, `recurring_confidence`

### Calendar Features
- `posted_year`, `posted_quarter`, `posted_month`
- `posted_iso_week`, `posted_iso_year`
- `posted_day_of_month`, `posted_day_of_week`, `posted_day_name`
- `posted_week_monday`
- `is_month_end`, `is_weekend`, `week_of_month`

### Sequence And Rolling Features
- `account_txn_sequence`
- `merchant_txn_sequence_in_account`
- `days_since_prior_account_txn`
- `days_since_prior_same_merchant_txn`
- `account_age_days_at_txn`
- `prior_signed_amount_same_account`
- `is_round_dollar`
- `txn_count_same_merchant_90d`
- `avg_amount_same_merchant_90d`
- `stddev_amount_same_merchant_90d`
- `outflow_30d`, `inflow_30d`

### Raw Payload
- `raw_payload_json`

## Current Flat-File Contract
The landing zone should allow the following upload types:

- `.csv`
- `.txt`
- `.json`
- `.jsonl` or `.ndjson`
- `.parquet`
- `.arrow` or `.feather`

Today, the only implemented parser in the repo is still CSV-first:

- Required: `date`, `description`, `amount`
- Optional: `merchant`, `account_name`, `account_id`, `institution_category`, `pending`

Notes:

- `.txt` should be treated as supported only when it is a structured delimited text export that fits the same logical contract as CSV
- JSON, Parquet, and Arrow-family files are planned landing formats, but their ingestion adapters still need to be implemented
- The current CSV contract is sufficient for a basic upload preview flow, but not yet strong enough for high-quality replay, dedupe, and predictive feature generation

## Recommended Canonical Source Fields
As we expand the ETL pipeline, upstream flat files or source adapters should standardize toward the following fields whenever the bank source can provide them:

- `source_transaction_id`
- `source_account_id`
- `account_name`
- `account_type`
- `account_subtype`
- `posted_at`
- `authorized_at`
- `pending`
- `signed_amount`
- `currency_code`
- `running_balance`
- `available_balance`
- `merchant_raw`
- `description_raw`
- `original_description`
- `memo`
- `institution_category`
- `transaction_type`
- `transaction_subtype`
- `payment_channel`
- `payment_method`
- `reference_number`
- `check_number`
- `merchant_id`
- `merchant_category`
- `merchant_category_code`
- `counterparty_name`
- `counterparty_account_id`
- `merchant_city`
- `merchant_state`
- `merchant_postal_code`
- `merchant_country`
- `statement_id`
- `statement_date`
- `raw_payload_json`

## Known Gaps And Risks
- The runner can now use the GCS landing bucket directly, but file lifecycle metadata is not yet persisted into BigQuery landing metadata tables.
- GCS file claiming is implemented as copy-then-delete object movement because Cloud Storage does not have an atomic rename primitive.
- JSON, JSONL, Parquet, Arrow, and Feather adapters are planned but not yet implemented.
- Delimited TXT support needs explicit delimiter detection or source-specific configuration.
- The shared CSV parser now resolves source profiles, and the standalone runner calls it directly for local and GCS landed files. The remaining gap is durable feed configuration.
- Several profiles depend on runtime account identity injection because the exported files do not identify the underlying card account directly. The current runner supports adjacent `<file>.context.json` manifests, but feed-config based injection is not implemented yet.
- The current app route accepts uploaded content directly; it does not yet poll or claim files from Cloud Storage.
- Two verification-only `raw_finance.import_batches` rows for `activity.csv` currently have zero matching `transaction_events` because they were inserted before the JSON payload streaming fix. Leave them in place unless you explicitly want cleanup.
- The assistant already calls OpenAI for chat responses, but the ETL pipeline does not yet write model-generated merchant or category suggestions back into BigQuery.
- `Plaid` routes are scaffolded, but CSV remains the only practical ingestion path today.
- The analytics base Dataform model and downstream marts have been materialized successfully against live BigQuery.
- `npm run test:imports` currently emits a non-blocking Node warning about `MODULE_TYPELESS_PACKAGE_JSON` because the repo is not marked as `"type": "module"`. The replay tests still pass.
- Stylelint still tries to parse `WAREHOUSE_ETL_LIVING_SPEC.md` as CSS and reports the same non-blocking Markdown warning noted previously.

## Near-Term Plan
- [x] Provision the landing bucket and standard prefixes `incoming`, `processing`, `archive`, and `rejected`.
- [ ] Extend `raw_finance.import_batches` or add `raw_finance.landing_files` to capture landing metadata such as file URI, checksum, and lifecycle status.
- [x] Build a standalone local-filesystem ingestion runner that claims landed `.csv` files and reuses the shared CSV parser and raw-load path.
- [x] Implement shared `mappingResolver` logic in `lib/import/mapping.ts` and wire it into `lib/import/csv.ts` so YAML profiles can be loaded from `source-mappings/`.
- [x] Standardize the shared runtime account context contract to provide `sourceAccountId`, `accountName`, and optional `accountMask`.
- [x] Support three mapping-resolution modes in the shared parser: filename match, header-signature match, and headerless column-shape match.
- [x] Refactor `lib/import/mapping.ts` and the shared CSV import flow to prefer explicit source profiles and only fall back to alias inference when no profile exists.
- [x] Add fixture-based replay tests for the six documented exports, plus one generic fallback CSV, so sign handling, pending detection, source transaction IDs, and canonical payload shape can be validated end to end.
- [x] Reuse the shared profile-backed parser inside the standalone landing runner instead of duplicating mapping logic.
- [x] Support runtime account context sidecar manifests named `<file>.context.json` for landed files that need injected account identity.
- [x] Add explicit JS-to-BigQuery field mapping so raw import batches and transaction events are inserted as snake_case rows.
- [x] Emit repo-side `import_batches` metadata for mapping profile resolution and runtime account context.
- [x] Apply the matching schema change to the live `raw_finance.import_batches` table so mapping metadata persists end to end in BigQuery.
- [x] Verify live raw BigQuery inserts from the shared persist path against the current `raw_finance` tables after the canonical payload expansion.
- [ ] Decide whether to remove the Node test-runner module warning by adjusting module settings, or leave it as an accepted local-only warning.
- [ ] Fix or explicitly suppress the stylelint Markdown-file warning for `WAREHOUSE_ETL_LIVING_SPEC.md`.
- [ ] Finish the remaining Phase 1 landing-foundation work for BigQuery-backed landing metadata.
- [x] Upgrade the runner so it can scan, claim, archive, reject, and write result manifests in the GCS landing bucket.
- [x] Implement the Phase 2 local runner skeleton so landed CSV files can move end to end from `incoming/...` to `archive/...` or `rejected/...`.
- [ ] Add format adapters for JSON, JSONL, Parquet, Arrow, Feather, and structured delimited TXT into the same canonical raw-event contract.
- [ ] Bring adapters online in priority order: CSV, TXT, JSON/JSONL, Parquet, then Arrow/Feather.
- [ ] Define file-type validation rules and rejection reasons such as `UNSUPPORTED_FORMAT`, `SCHEMA_MISMATCH`, and `EMPTY_FILE`.
- [x] Add file validation plus move-to-archive and move-to-rejected handling for landed files.
- [ ] Expand the CSV import contract to accept richer source fields such as `source_transaction_id`, `authorized_at`, `running_balance`, and `available_balance`.
- [x] Run Dataform against the live BigQuery project and confirm materialization of staging, core, ops, mart, and analytics models.
- [ ] Create a durable table for AI-generated standardization and categorization results.
- [ ] Build an ETL worker that reads from `ops_finance.ai_enrichment_queue`, calls OpenAI in batches, and writes suggestions into BigQuery.
- [ ] Merge AI enrichment outputs into the broader classification and review flow.
- [ ] Add backfill and replay procedures for historical CSV uploads.

## Proposed AI Enrichment Pattern
The current plan is:

1. Use deterministic normalization and rules first.
2. Send only unresolved or low-confidence posted transactions to `ops_finance.ai_enrichment_queue`.
3. Have a future enrichment worker read those rows in batches.
4. Ask OpenAI to standardize merchant names, infer category candidates, and possibly detect recurring patterns or transfer-like behavior.
5. Write those suggestions into a dedicated BigQuery table such as `ops_finance.ai_enrichment_results`.
6. Keep model output separate from the canonical fact until it is accepted by deterministic logic or a human review step.

This keeps the ETL design audit-friendly and prevents model outputs from silently mutating canonical finance records.

## Operational Runbook
Useful commands and checks:

```bash
# verify local Google Cloud auth
gcloud auth list
gcloud auth application-default print-access-token >/dev/null && echo ADC_OK

# once the landing bucket exists, inspect or upload files
gcloud storage ls "gs://finance-tracker-cdx-etl-landing/incoming/"
gcloud storage cp "/path/to/file.csv" "gs://finance-tracker-cdx-etl-landing/incoming/manual/2026/04/04/"

# verify repo compiles
npm run dataform:compile
npm run test:imports
npm run lint
npm run typecheck

# run the current local landing runner
npm run etl:runner -- --landing-root ./landing-zone --max-files 5

# run the GCS-backed landing runner
npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 5

# optional future step once credentials and execution path are finalized
npx dataform run .
```

Current landed-file convention for the local or GCS runner:

```text
landing-zone/
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv.context.json

gs://finance-tracker-cdx-etl-landing/
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv.context.json
```

Current context manifest shape:

```json
{
  "sourceAccountId": "discover_card",
  "accountName": "Discover Card",
  "accountMask": "7788"
}
```

BigQuery objects created in the live project should always be mirrored by checked-in Dataform or SQL definitions when possible.

## Next Session Handoff
Start here in the next chat if the goal is to continue warehouse ETL work:

- `WAREHOUSE_ETL_LIVING_SPEC.md`
- `WAREHOUSE_SOURCE_MAPPINGS.md`
- `source-mappings/`
- `lib/import/mapping.ts`
- `lib/import/csv.ts`
- `lib/import/normalize.ts`
- `lib/import/persistence.ts`
- `lib/import/runner.ts`
- `scripts/run-landed-imports.ts`
- `app/api/import/csv/route.ts`
- `tests/import/parse-csv-import.test.mjs`
- `tests/import/persistence.test.mjs`
- `tests/import/runner.test.mjs`
- `tests/fixtures/imports/`
- `dataform/definitions/raw/import_batches.sqlx`

Specific instructions for the next session:

- Treat the shared parser as the current baseline. Do not reintroduce alias-only header inference ahead of explicit source-profile resolution.
- Keep the runtime account context contract exact: `sourceAccountId`, `accountName`, optional `accountMask`.
- Keep the raw-write contract explicit. Do not revert back to inserting camelCase app objects directly into snake_case BigQuery tables.
- Keep `transaction_events.payload` serialized as JSON text when streaming into the BigQuery `JSON` column.
- If a source profile requires runtime account identity, pass that context into the shared parser rather than encoding it into generic file names.
- Keep the local runner and the app-side upload path aligned on runtime account context keys and mapping-resolution behavior.
- Keep the landed sidecar contract stable as `<file>.context.json` unless there is a deliberate migration plan.
- If a new feed or profile is added, update all three places together:
  - `source-mappings/<profile>.yaml`
  - `WAREHOUSE_SOURCE_MAPPINGS.md`
  - `tests/import/parse-csv-import.test.mjs` with at least one representative fixture under `tests/fixtures/imports/`
- Keep the current `incoming`, `processing`, `archive`, and `rejected` contract equivalent across local and GCS runner flows.
- If import-batch metadata changes, update this spec and the checked-in Dataform definition for `raw_finance.import_batches` or add a new `raw_finance.landing_files` definition in the repo at the same time.
- If verification-only raw rows need cleanup later, do it intentionally and record the affected `import_batch_id` values in this spec or the session notes.

## How To Update This Document
Whenever we touch warehouse or ETL work in future sessions:

- Update `Current Status`
- Update `Live BigQuery Objects`
- Add or remove fields under `Analytics Base Table`
- Record any new datasets, tables, views, or scripts
- Update source-mapping notes and account identity conventions when feed mappings change
- Update `Known Gaps And Risks`
- Check off or add items under `Near-Term Plan`
- Append a short note to `Session Notes`

## Session Notes
### Baseline warehouse and ETL setup
- Connected the repo to live BigQuery project `finance-tracker-cdx`.
- Verified local Google Cloud auth and Application Default Credentials.
- Created `raw_finance`, `stg_finance`, `core_finance`, `ops_finance`, `mart_finance`, and `analytics_finance`.
- Created live tables `raw_finance.import_batches`, `raw_finance.transaction_events`, and `analytics_finance.transaction_analytics_base`.
- Updated `dataform/workflow_settings.yaml` to use `finance-tracker-cdx`.
- Added `dataform/definitions/analytics/transaction_analytics_base.sqlx`.
- Added `dataform/definitions/ops/ai_enrichment_queue.sqlx`.
- Compiled the Dataform project successfully.

### Flat-file landing phase planning
- Added a planned Google Cloud Storage landing-zone pattern as the first ETL step before raw warehouse ingestion.
- Documented the `incoming`, `processing`, `archive`, and `rejected` file lifecycle.
- Expanded the landing-zone contract to include `.csv`, `.txt`, `.json`, `.jsonl`, `.parquet`, `.arrow`, and `.feather` files.
- Added a concrete adapter support matrix and phased ingestion-runner backlog for implementation planning.
- Recommended a standalone ingestion runner that reuses the current shared CSV parsing and raw-load path.

### Source mapping registry and account identity standardization
- Added `WAREHOUSE_SOURCE_MAPPINGS.md` as the narrative registry for feed-level source mappings.
- Added versioned mapping profiles under `source-mappings/` for six current feeds:
  - Capital One 360 Checking (`capital_one_360_checking_5980`)
  - Apple Card (`apple_card`)
  - Chase card ending in `1325` (`chase_card_1325`)
  - American Express activity (`american_express_card`)
  - Micro Center card export (`micro_center_card`)
  - Discover all-available export (`discover_card`)
- Standardized account identity across those profiles using stable `sourceAccountId` plus human-readable `accountName`.
- Confirmed current feed-specific date, sign, and pending semantics:
  - Apple Card: blank `Clearing Date` means pending
  - Chase: blank `Post Date` means pending
  - Discover: blank `Post Date` means pending
  - Capital One 360 Checking and Micro Center: confirmed-only exports
  - Micro Center: one headerless date column is both transaction and post date
  - American Express: `Date` header confirmed and `Reference` should be preferred for transaction identity
- Identified the next development steps as building `mappingResolver`, formalizing runtime account context injection, and adding fixture-based replay tests for the six documented exports.

### Shared source-profile resolver and replay coverage
- Implemented shared YAML profile loading and resolution in `lib/import/mapping.ts` using `source-mappings/` plus `js-yaml`.
- Wired the shared CSV import path in `lib/import/csv.ts` to parse files as a matrix first, support headered and headerless feeds, prefer explicit source profiles, and fall back to generic header inference only when no source profile matches.
- Implemented the shared runtime account context contract in `app/api/import/csv/route.ts` and `lib/import/normalize.ts` using `sourceAccountId`, `accountName`, and optional `accountMask`.
- Expanded normalization so profile-driven imports can parse source-specific dates, apply sign transforms, derive deterministic `sourceTransactionId` values, detect pending rows, and preserve additional canonical payload fields such as `currencyCode`, `runningBalance`, `transactionType`, `memo`, and `referenceNumber`.
- Added fixture-based replay coverage in `tests/import/parse-csv-import.test.mjs` with representative fixtures under `tests/fixtures/imports/` for:
  - Capital One 360 Checking
  - Apple Card
  - Chase card ending in `1325`
  - American Express activity
  - Micro Center card export
  - Discover all-available export
  - Generic fallback CSV header inference
- Added `npm run test:imports` to `package.json` and enabled `allowImportingTsExtensions` in `tsconfig.json` so the replay tests can execute against the current source files.
- Validated the repo changes with:
  - `npm run test:imports`
  - `npm run lint`
  - `npm run typecheck`
- No BigQuery or Dataform objects were changed in this session.
- Remaining non-blocking diagnostics after this session:
  - `npm run test:imports` prints a Node `MODULE_TYPELESS_PACKAGE_JSON` warning, but the tests pass.
  - Stylelint still tries to parse `WAREHOUSE_ETL_LIVING_SPEC.md` as CSS and reports the same Markdown warning as before.

### Raw-write contract and import batch metadata
- Added `lib/import/persistence.ts` to translate parser output into explicit snake_case BigQuery insert rows for `raw_finance.import_batches` and `raw_finance.transaction_events`.
- Updated `persistCsvImport()` to use the explicit raw-row mappers.
- Extended the checked-in `dataform/definitions/raw/import_batches.sqlx` schema to include:
  - `mapping_profile_id`
  - `mapping_resolution_strategy`
  - `mapping_matched_by`
  - `runtime_source_account_id`
  - `runtime_account_name`
  - `runtime_account_mask`
- Added `tests/import/persistence.test.mjs` to verify the persisted row shape stays snake_case and that both profile-backed imports and fallback header inference emit the expected batch metadata.
- Updated `lib/assistant/knowledge.ts` so the internal CSV import summary reflects explicit profile resolution with fallback header inference.
- Validated the repo changes with:
  - `npm run test:imports`
  - `npm run typecheck`
  - `npm run dataform:compile`

### Live schema migration and persisted-import verification
- Altered the live `finance-tracker-cdx.raw_finance.import_batches` table to add:
  - `mapping_profile_id`
  - `mapping_resolution_strategy`
  - `mapping_matched_by`
  - `runtime_source_account_id`
  - `runtime_account_name`
  - `runtime_account_mask`
- Removed the temporary `ignoreUnknownValues` compatibility path from the repo after the live schema matched the checked-in definition.
- Found and fixed a live-write bug in `lib/import/persistence.ts`: `transaction_events.payload` must be streamed into BigQuery as JSON text rather than a nested JavaScript object.
- Re-validated the repo changes with:
  - `npm run test:imports`
  - `npm run typecheck`
- Ran a fixture-backed live verification import using `tests/fixtures/imports/american_express_activity.csv` plus runtime account context and confirmed:
  - `import_batches.mapping_profile_id = american_express.activity.csv.v1`
  - `import_batches.mapping_matched_by = ["filename", "header-signature"]`
  - `runtime_source_account_id = american_express_card`
  - `runtime_account_name = American Express Card`
  - `runtime_account_mask = 2001`
  - one matching `transaction_events` row landed with `source_transaction_id = REF-123`
- Verification artifacts currently left in raw tables:
  - `batch-1775795770452` has `event_count = 0`
  - `batch-1775795741724` has `event_count = 0`
  - `batch-1775796486973` has `event_count = 1`
  - `batch-1775796521110` has `event_count = 1`

### Standalone landed-file runner
- Added `lib/import/runner.ts` to implement a first standalone landed-file workflow around the shared CSV parser and raw BigQuery persistence path.
- Added `scripts/run-landed-imports.ts` plus `npm run etl:runner` as the operator entrypoint for processing landed files.
- The current runner mirrors the landing lifecycle under a local root such as `landing-zone/`:
  - `incoming/...`
  - `processing/...`
  - `archive/...`
  - `rejected/...`
- The current runner behavior is:
  - claims one landed file at a time by moving it into `processing/...`
  - supports `.csv` only
  - rejects unsupported formats as `UNSUPPORTED_FORMAT`
  - reads optional runtime account context from adjacent `<file>.context.json`
  - loads successful files into `raw_finance.import_batches` and `raw_finance.transaction_events`
  - writes a `<file>.result.json` manifest into `archive/...` or `rejected/...`
- Added `tests/import/runner.test.mjs` to verify:
  - a profile-backed landed CSV is archived after successful persistence through the shared path
  - unsupported files are rejected with a persisted result manifest
- Validated the repo changes with:
  - `npm run test:imports`
  - `npm run typecheck`
- Remaining follow-up after this session:
  - persist landing metadata into BigQuery rather than only result manifests
  - add non-CSV adapters and richer rejection diagnostics

### GCS landing bucket provisioning
- Created the Google Cloud Storage bucket `gs://finance-tracker-cdx-etl-landing` in project `finance-tracker-cdx`.
- Bucket settings confirmed after creation:
  - location: `US`
  - storage class: `STANDARD`
  - uniform bucket-level access: enabled
  - public access prevention: enforced
  - soft-delete retention: 7 days
- Added placeholder objects for the expected lifecycle prefixes:
  - `incoming/.keep`
  - `processing/.keep`
  - `archive/.keep`
  - `rejected/.keep`
- Validation performed:
  - `gcloud storage buckets describe gs://finance-tracker-cdx-etl-landing --project=finance-tracker-cdx --format=json`
  - `gcloud storage ls --recursive gs://finance-tracker-cdx-etl-landing --project=finance-tracker-cdx`
- Remaining follow-up after this session:
  - persist landing file lifecycle metadata into BigQuery
  - decide whether additional bucket lifecycle rules are needed beyond the default soft-delete policy

### GCS-backed landed-file runner
- Added `@google-cloud/storage` as the Node SDK dependency for bucket operations.
- Updated `lib/import/runner.ts` so `landingRoot` can be either a local path or a `gs://...` URI.
- Added GCS-backed support for:
  - listing non-auxiliary files under `incoming/...`
  - claiming files by moving them to `processing/...`
  - reading adjacent `<file>.context.json` manifests from the bucket
  - computing checksum and file size from bucket object bytes
  - archiving loaded files under `archive/...`
  - rejecting failed or unsupported files under `rejected/...`
  - writing `<file>.result.json` manifests back to the bucket
- Updated `scripts/run-landed-imports.ts` with:
  - `--gcs-bucket <name>`
  - `--gcs-prefix <prefix>`
  - continued support for `--landing-root gs://...`
- Environment-based GCS root selection now supports:
  - `WAREHOUSE_LANDING_URI=gs://finance-tracker-cdx-etl-landing`
  - `WAREHOUSE_LANDING_BUCKET=finance-tracker-cdx-etl-landing`
- Validation performed:
  - `npm run test:imports`
  - `npm run typecheck`
  - `npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 1 --json`
- Live GCS runner verification result:
  - `storageBackend = gcs`
  - `processedCount = 0`
  - `archivedCount = 0`
  - `rejectedCount = 0`
- Remaining follow-up after this session:
  - persist landing file lifecycle metadata into BigQuery rather than only result manifests
  - add feed-level runtime account context configuration so sidecar manifests are not always required
  - decide whether stronger GCS claim coordination is needed if multiple runner instances may run concurrently

### Local fixture import and app verification
- Staged the seven checked-in CSV fixtures under the ignored local `landing-zone/incoming/...` contract:
  - Capital One 360 Checking
  - Apple Card
  - Chase card ending in `1325`
  - American Express activity
  - Micro Center card
  - Discover card
  - Generic fallback CSV
- Added sidecar context manifests for feeds that require runtime account identity injection.
- Ran the local landing runner against `./landing-zone` with live BigQuery environment values.
- Runner result:
  - processed files: `7`
  - archived files: `7`
  - rejected files: `0`
  - raw transaction events inserted: `7`
- Verified the seven new `raw_finance.import_batches` rows each have one matching `raw_finance.transaction_events` row.
- Created a temporary Dataform ADC credentials file for the run, removed it after materialization, and added `dataform/.df-credentials.json` to `.gitignore`.
- Fixed two BigQuery SQL alias issues by replacing `current` aliases with `current_txn` in:
  - `dataform/definitions/analytics/transaction_analytics_base.sqlx`
  - `dataform/definitions/assertions/orphaned_category_ids.sqlx`
- Ran `npx dataform run dataform` successfully against live BigQuery.
- Confirmed live row counts:
  - `mart_finance.overview_snapshot`: `1`
  - `analytics_finance.transaction_analytics_base`: `7`
- Normalized BigQuery NUMERIC and DATE wrapper values before passing query results into client components.
- Updated transaction filtering so blank filters do not send untyped `NULL` or empty array params to BigQuery.
- Verified local app routes:
  - `GET /overview` returned `200`
  - `HEAD /transactions` returned `200`
  - `HEAD /cashflow` returned `200`
- Validation performed:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:imports`
  - `npm run dataform:compile`
- Remaining follow-up after this session:
  - add richer selected-transaction detail rows for related transfers and raw event history
  - decide whether to create a Dataform credential setup script

### App-readiness audit and first cleanup scripts
- Added `sql/warehouse/01_app_readiness_audit.sql` to check core row counts, orphan raw batches, uncategorized current rows, review-queue size, generic account masks, and category mix breadth.
- Added `sql/warehouse/02_seed_initial_category_rules.sql` and ran it against live BigQuery. It upserts first-pass deterministic rules for `Lunch Shop`, `Neighborhood Market`, `Online Bookstore`, and `Laptop Stand`.
- Added `sql/warehouse/03_seed_account_metadata.sql` and ran it against live BigQuery. It creates and seeds `ops_finance.account_metadata` for the seven fixture accounts.
- Added `sql/warehouse/04_cleanup_orphan_import_batches.sql` as a review-first cleanup script for metadata-only verification batches. The destructive delete remains commented out and was not executed.
- Added `dataform/definitions/ops/account_metadata.sqlx` so Dataform owns creation of the account metadata table.
- Updated `dataform/definitions/staging/accounts_clean.sqlx` to enrich observed accounts from `ops_finance.account_metadata` and to use `unknown` rather than a misleading account-id suffix when no numeric mask exists.
- Updated `dataform/definitions/marts/overview_snapshot.sqlx` so nested dashboard account data comes from `core_finance.dim_account` instead of rebuilding generic account labels from transaction rows.
- Ran `npx dataform run dataform` successfully against live BigQuery after the script/model changes. All five Dataform assertions passed.
- Final audit results:
  - `raw_finance.import_batches`: `11`
  - `raw_finance.transaction_events`: `9`
  - `stg_finance.transactions_clean`: `7`
  - `core_finance.fact_transaction_current`: `7`
  - `analytics_finance.transaction_analytics_base`: `7`
  - `mart_finance.overview_snapshot`: `1`
  - `uncategorized_current_transactions`: `0`
  - `generic_card_masks`: `0`
  - `category_mix_rows`: `3`
  - `review_queue_count`: `3`
  - `import_batches_without_matching_events`: `2`
- Category spread after rules:
  - `Software`: `2` transactions, `$148.74`
  - `Dining`: `4` transactions, `$45.63`
  - `Groceries`: `1` transaction, `$25.50`
- The remaining review queue rows are all high-confidence classified transactions with `pending = true` from source data, not uncategorized rows.
- Verified app routes against the running local Next.js server at `http://localhost:3000`:
  - `HEAD /overview` returned `200`
  - `HEAD /transactions` returned `200`
  - `HEAD /cashflow` returned `200`
  - `HEAD /categories` returned `200`
  - `HEAD /merchants` returned `200`
- Remaining risks or blockers:
  - The fixture data has no income or starting balance rows, so `month_to_date_income = 0`, `available_cash = 0`, and `savings_rate = NULL`.
  - Two old verification `import_batches` rows still have no matching `transaction_events`; keep them as audit artifacts or run the reviewed cleanup script.
  - `Online Bookstore` and `Laptop Stand` are temporarily categorized as `Software` until a shopping/books/equipment category decision is made.
  - Apple Card has no source-provided numeric mask, so it displays as `unknown`.

### Template for future updates
- What changed:
- What was created or altered in BigQuery:
- What was added or changed in the repo:
- Validation performed:
- Remaining risks or blockers:
