-- Seed durable account metadata for CSV-only accounts.
-- Idempotent: rows are matched by account_id.
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/03_seed_account_metadata.sql
--
-- After running this script, rerun:
-- npx dataform run dataform

create table if not exists `finance-tracker-cdx.ops_finance.account_metadata` (
  account_id string not null,
  account_name string,
  institution string,
  account_type string,
  account_subtype string,
  currency string,
  mask string,
  is_active bool,
  notes string,
  updated_at timestamp
)
options (
  description = "Operator-maintained account metadata used to enrich CSV-imported accounts."
);

merge `finance-tracker-cdx.ops_finance.account_metadata` as target
using (
  select
    "capital_one_360_checking_5980" as account_id,
    "Capital One 360 Checking" as account_name,
    "Capital One" as institution,
    "checking" as account_type,
    "checking" as account_subtype,
    "USD" as currency,
    "5980" as mask,
    true as is_active,
    "Seeded from first CSV mapping profile." as notes,
    current_timestamp() as updated_at
  union all
  select
    "apple_card",
    "Apple Card",
    "Apple",
    "credit",
    "credit_card",
    "USD",
    null,
    true,
    "Seeded from first CSV mapping profile.",
    current_timestamp()
  union all
  select
    "chase_card_1325",
    "Chase Card 1325",
    "Chase",
    "credit",
    "credit_card",
    "USD",
    "1325",
    true,
    "Seeded from first CSV mapping profile.",
    current_timestamp()
  union all
  select
    "american_express_card",
    "American Express Card",
    "American Express",
    "credit",
    "credit_card",
    "USD",
    "2001",
    true,
    "Seeded from first CSV mapping profile.",
    current_timestamp()
  union all
  select
    "micro_center_card",
    "Micro Center Card",
    "Micro Center",
    "credit",
    "store_card",
    "USD",
    "4242",
    true,
    "Seeded from first CSV mapping profile.",
    current_timestamp()
  union all
  select
    "discover_card",
    "Discover Card",
    "Discover",
    "credit",
    "credit_card",
    "USD",
    "7788",
    true,
    "Seeded from first CSV mapping profile.",
    current_timestamp()
  union all
  select
    "manual_checking",
    "Manual Checking",
    "Manual",
    "checking",
    "checking",
    "USD",
    "1111",
    true,
    "Seeded from generic fallback fixture.",
    current_timestamp()
) as source
on target.account_id = source.account_id
when matched then update set
  account_name = source.account_name,
  institution = source.institution,
  account_type = source.account_type,
  account_subtype = source.account_subtype,
  currency = source.currency,
  mask = source.mask,
  is_active = source.is_active,
  notes = source.notes,
  updated_at = source.updated_at
when not matched then insert (
  account_id,
  account_name,
  institution,
  account_type,
  account_subtype,
  currency,
  mask,
  is_active,
  notes,
  updated_at
) values (
  source.account_id,
  source.account_name,
  source.institution,
  source.account_type,
  source.account_subtype,
  source.currency,
  source.mask,
  source.is_active,
  source.notes,
  source.updated_at
);
