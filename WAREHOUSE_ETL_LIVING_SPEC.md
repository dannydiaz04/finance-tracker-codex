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
- The landing-zone design is not provisioned in Google Cloud yet.

## Repository Touchpoints
- `app/api/import/csv/route.ts`
- `lib/import/csv.ts`
- `lib/import/mapping.ts`
- `lib/import/normalize.ts`
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
- `dataform/definitions/analytics/transaction_analytics_base.sqlx`

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

1. Flat files are dropped untouched into a landing bucket such as `gs://finance-tracker-cdx-etl-landing/incoming/...`.
2. A standalone ingestion runner claims one landed file at a time by moving it into `processing/...`, validates the file, and records landing metadata.
3. The runner routes each claimed file to the correct format adapter based on extension and structure.
4. The current implemented adapter is the shared CSV-style parser surfaced at `app/api/import/csv/route.ts`; future adapters should handle JSON, Parquet, Arrow, and related formats while emitting the same canonical row shape.
5. `lib/import/mapping.ts` can infer or map source column and field names into the canonical contract.
6. `lib/import/normalize.ts` standardizes dates, amounts, descriptions, merchant text, transaction direction, and keywords.
7. The ingestion library builds import-batch metadata plus transaction events for BigQuery insertion. Today this lives in `lib/import/csv.ts`.
8. `raw_finance.transaction_events` stores event-level transaction payloads as JSON.
9. `stg_finance.transactions_clean` extracts the latest non-removed version of each transaction.
10. `core_finance.fact_classification` applies overrides, deterministic rules, institution hints, and fallback logic.
11. `core_finance.fact_transaction_current` becomes the main canonical transaction fact for the app.
12. `ops_finance.review_queue` identifies rows needing manual review.
13. `analytics_finance.transaction_analytics_base` widens the modeled data for descriptive and predictive analytics.
14. `ops_finance.ai_enrichment_queue` identifies posted rows that are good candidates for future OpenAI-assisted standardization and categorization.

Important operational note:

- The landing-zone steps are now specified as the intended first-mile pattern, but they have not yet been provisioned or automated.
- The shared CSV parsing and raw-write path already exists and should be reused by the landing-zone runner instead of duplicated.
- Non-CSV adapters are part of the intended landing-zone design, but they are not implemented in the repo yet.
- The Dataform graph now includes `analytics_finance.transaction_analytics_base` and `ops_finance.ai_enrichment_queue`, but only compilation has been validated so far.
- A full `dataform run` against BigQuery has not yet been executed in this repo session.

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

### Adapter Support Matrix
The landing zone may accept multiple file types, but the ingestion runner should bring them online in a deliberate order so the canonical raw-event contract stays stable.

| File type | Land in bucket | Adapter approach | Canonicalization notes | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| `.csv` | yes | Reuse `lib/import/csv.ts` and existing mapping plus normalization flow | Header-based mapping into the canonical transaction-row contract | P0 | implemented in repo for direct upload; not yet wired to landing bucket |
| `.txt` | yes | Treat as delimited text and route through the CSV-style parser with delimiter detection or source config | Same contract as CSV once delimiter and headers are resolved | P1 | planned |
| `.json` | yes | JSON adapter that supports arrays plus configurable transaction array paths | Flatten records into the same canonical row shape before raw writes | P1 | planned |
| `.jsonl` / `.ndjson` | yes | Line-by-line JSON adapter | Each line becomes one canonical transaction row | P1 | planned |
| `.parquet` | yes | Columnar adapter that reads record batches and maps fields into the canonical schema | Best for vendor exports that already preserve types such as timestamps and decimals | P2 | planned |
| `.arrow` / `.feather` | yes | Arrow-family adapter using the same canonical field mapping as Parquet | Best treated as a later optimization once row-oriented formats are stable | P3 | planned |

Implementation rule:

- Every adapter must emit the same canonical row payload before writing to `raw_finance.transaction_events`
- Validation, dedupe, and replay semantics should stay format-independent even when parsing logic differs by adapter
- New formats should be enabled behind explicit allowlists until they pass end-to-end replay tests

### Ingestion Runner Backlog
This is the recommended order for implementing the landing-zone runner.

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
| `analytics_finance.transaction_analytics_base` | table | live | Wide analytics table, 97 fields, partitioned by `posted_at` |

Objects checked into the repo and compiled successfully:

| Object | Type | Status | Notes |
| --- | --- | --- | --- |
| `stg_finance.transactions_clean` | view | compiled | Extracts clean latest-state transactions |
| `stg_finance.accounts_clean` | view | compiled | Distinct account dimension staging |
| `core_finance.fact_classification` | table | compiled | Deterministic classification ladder |
| `core_finance.fact_transaction_current` | table | compiled | Canonical current-state transactions |
| `core_finance.fact_transaction_history` | table | compiled | Event history across imports |
| `ops_finance.review_queue` | view | compiled | Manual-review worklist |
| `ops_finance.ai_enrichment_queue` | view | compiled | Future model-enrichment worklist |
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
- The landing bucket, prefix lifecycle, and ingestion runner are defined in the spec but are not yet provisioned or implemented.
- No checksum-based file claim, archive, or rejection workflow exists yet.
- JSON, JSONL, Parquet, Arrow, and Feather adapters are planned but not yet implemented.
- Delimited TXT support needs explicit delimiter detection or source-specific configuration.
- The CSV importer currently generates `sourceTransactionId` from `postedAt` plus row number. That is weak for dedupe and replay across repeated uploads.
- `authorizedAt` is currently hard-coded to `null` in CSV normalization.
- The current upload contract is still sparse relative to the analytics table design.
- The current app route accepts uploaded content directly; it does not yet poll or claim files from Cloud Storage.
- The app-side importer builds camelCase objects before BigQuery insertion, while the raw BigQuery table schema is snake_case. This must be explicitly verified or mapped before relying on production inserts.
- The assistant already calls OpenAI for chat responses, but the ETL pipeline does not yet write model-generated merchant or category suggestions back into BigQuery.
- `Plaid` routes are scaffolded, but CSV remains the only practical ingestion path today.
- The analytics base Dataform model compiles, but a full warehouse materialization run has not yet been validated end to end.

## Near-Term Plan
- [ ] Provision the landing bucket and standard prefixes `incoming`, `processing`, `archive`, and `rejected`.
- [ ] Extend `raw_finance.import_batches` or add `raw_finance.landing_files` to capture landing metadata such as file URI, checksum, and lifecycle status.
- [ ] Build a standalone ingestion runner that claims landed files and reuses the shared CSV parser and raw-load path.
- [ ] Implement Phase 1 and Phase 2 of the ingestion runner backlog so landed CSV files can move end to end from `incoming/...` to `archive/...`.
- [ ] Add format adapters for JSON, JSONL, Parquet, Arrow, Feather, and structured delimited TXT into the same canonical raw-event contract.
- [ ] Bring adapters online in priority order: CSV, TXT, JSON/JSONL, Parquet, then Arrow/Feather.
- [ ] Define file-type validation rules and rejection reasons such as `UNSUPPORTED_FORMAT`, `SCHEMA_MISMATCH`, and `EMPTY_FILE`.
- [ ] Verify raw BigQuery inserts from the app against the live `raw_finance` tables.
- [ ] Add explicit JS-to-BigQuery field mapping for raw table writes if camelCase does not map cleanly.
- [ ] Expand the CSV import contract to accept richer source fields such as `source_transaction_id`, `authorized_at`, `running_balance`, and `available_balance`.
- [ ] Add file validation plus move-to-archive and move-to-rejected handling for landed files.
- [ ] Run Dataform against the live BigQuery project and confirm materialization of staging, core, ops, mart, and analytics models.
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

# optional future step once credentials and execution path are finalized
npx dataform run .
```

BigQuery objects created in the live project should always be mirrored by checked-in Dataform or SQL definitions when possible.

## How To Update This Document
Whenever we touch warehouse or ETL work in future sessions:

- Update `Current Status`
- Update `Live BigQuery Objects`
- Add or remove fields under `Analytics Base Table`
- Record any new datasets, tables, views, or scripts
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

### Template for future updates
- What changed:
- What was created or altered in BigQuery:
- What was added or changed in the repo:
- Validation performed:
- Remaining risks or blockers:
