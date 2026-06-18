-- Create the table that stores connected Plaid Items and their sync cursors.
-- Idempotent: safe to run repeatedly.
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/06_create_plaid_items.sql
--
-- SECURITY: access_token is a long-lived credential that grants read access to
-- the connected financial accounts. Restrict IAM access to this table and
-- consider moving the token to Secret Manager for production deployments.

create table if not exists `finance-tracker-cdx.ops_finance.plaid_items` (
  user_id string,
  item_id string not null,
  access_token string,
  institution_id string,
  institution_name string,
  cursor string,
  status string,
  error string,
  last_synced_at timestamp,
  created_at timestamp,
  updated_at timestamp
)
options (
  description = "Connected Plaid Items (one per institution login) with sync cursors. access_token is a long-lived credential; restrict access to this table."
);
