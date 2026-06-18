-- Add Plaid-sourced balance columns to account_metadata.
-- Idempotent (ADD COLUMN IF NOT EXISTS).
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/08_add_account_balances.sql

alter table `finance-tracker-cdx.ops_finance.account_metadata`
  add column if not exists current_balance numeric;

alter table `finance-tracker-cdx.ops_finance.account_metadata`
  add column if not exists available_balance numeric;
