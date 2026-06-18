-- Multi-user migration: add a user_id column to every per-user table.
-- Idempotent (ADD COLUMN IF NOT EXISTS). Run before deploying multi-user ingestion.
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/07_add_user_id_columns.sql
--
-- After running this, backfill existing rows to the owning user with
-- sql/warehouse/08_backfill_user_id.sql, then rerun: npx dataform run dataform

alter table `finance-tracker-cdx.raw_finance.transaction_events`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.raw_finance.import_batches`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.plaid_items`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.account_metadata`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.manual_overrides`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.category_rules`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.category_rule_suggestions`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.credit_card_payment_aliases`
  add column if not exists user_id string;

alter table `finance-tracker-cdx.ops_finance.ai_enrichment_results`
  add column if not exists user_id string;
