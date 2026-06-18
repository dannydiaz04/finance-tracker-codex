-- Backfill existing (pre-multi-user) rows to a single owning user.
-- Replace the placeholder below with the id of the user that should own all
-- existing CSV + Plaid data (the Postgres `user.id`, visible after you register
-- and can be read from the auth database).
--
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/09_backfill_user_id.sql
--
-- After running this, rebuild the marts: npx dataform run dataform

declare target_user_id string default 'REPLACE_WITH_USER_ID';

update `finance-tracker-cdx.raw_finance.transaction_events`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.raw_finance.import_batches`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.plaid_items`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.account_metadata`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.manual_overrides`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.category_rules`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.category_rule_suggestions`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.credit_card_payment_aliases`
  set user_id = target_user_id where user_id is null;

update `finance-tracker-cdx.ops_finance.ai_enrichment_results`
  set user_id = target_user_id where user_id is null;
