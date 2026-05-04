-- Warehouse app-readiness audit.
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/01_app_readiness_audit.sql

select
  "row_counts" as check_group,
  object_name,
  cast(row_count as string) as value,
  null as detail
from (
  select "raw_import_batches" as object_name, count(*) as row_count
  from `finance-tracker-cdx.raw_finance.import_batches`
  union all
  select "raw_transaction_events", count(*)
  from `finance-tracker-cdx.raw_finance.transaction_events`
  union all
  select "stg_transactions_clean", count(*)
  from `finance-tracker-cdx.stg_finance.transactions_clean`
  union all
  select "core_fact_transaction_current", count(*)
  from `finance-tracker-cdx.core_finance.fact_transaction_current`
  union all
  select "mart_overview_snapshot", count(*)
  from `finance-tracker-cdx.mart_finance.overview_snapshot`
  union all
  select "analytics_transaction_base", count(*)
  from `finance-tracker-cdx.analytics_finance.transaction_analytics_base`
)

union all

select
  "raw_integrity" as check_group,
  "import_batches_without_matching_events" as object_name,
  cast(count(*) as string) as value,
  "Expected 0 for production-like data." as detail
from (
  select b.import_batch_id
  from `finance-tracker-cdx.raw_finance.import_batches` as b
  left join `finance-tracker-cdx.raw_finance.transaction_events` as e
    using (import_batch_id)
  group by b.import_batch_id, b.row_count
  having count(e.event_id) != b.row_count
)

union all

select
  "classification" as check_group,
  "uncategorized_current_transactions" as object_name,
  cast(countif(derived_category_id = "uncategorized") as string) as value,
  "Expected low or 0 once category rules are seeded." as detail
from `finance-tracker-cdx.core_finance.fact_transaction_current`

union all

select
  "classification" as check_group,
  "review_queue_count" as object_name,
  cast(count(*) as string) as value,
  "Expected to fall as deterministic rules and overrides improve." as detail
from `finance-tracker-cdx.ops_finance.review_queue`

union all

select
  "accounts" as check_group,
  "generic_card_masks" as object_name,
  cast(countif(mask = "card") as string) as value,
  "Expected 0 after account metadata is seeded." as detail
from `finance-tracker-cdx.core_finance.dim_account`

union all

select
  "marts" as check_group,
  "category_mix_rows" as object_name,
  cast(count(*) as string) as value,
  "Should be more than 1 once category rules are seeded." as detail
from `finance-tracker-cdx.mart_finance.category_spend_daily`

order by check_group, object_name;
