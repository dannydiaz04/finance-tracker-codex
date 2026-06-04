-- Seed aliases for checking-side credit card payment withdrawals.
-- Idempotent: rows are matched by alias_id.
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/05_seed_credit_card_payment_aliases.sql
--
-- After running this script, rerun:
-- npx dataform run dataform

create table if not exists `finance-tracker-cdx.ops_finance.credit_card_payment_aliases` (
  alias_id string,
  target_account_id string,
  target_account_name string,
  alias_pattern string,
  match_strategy string,
  priority int64,
  enabled bool,
  created_at timestamp
)
options (
  description = "Operator-maintained aliases that identify checking-side credit card payment withdrawals."
);

merge `finance-tracker-cdx.ops_finance.credit_card_payment_aliases` as target
using (
  select
    "apple_card_applecard_gsbank" as alias_id,
    "apple_card" as target_account_id,
    "Apple Card" as target_account_name,
    "applecard gsbank" as alias_pattern,
    "description_contains" as match_strategy,
    100 as priority,
    true as enabled,
    current_timestamp() as created_at
  union all
  select
    "apple_card_apple_card",
    "apple_card",
    "Apple Card",
    "apple card",
    "description_contains",
    95,
    true,
    current_timestamp()
  union all
  select
    "american_express_amex",
    "american_express_card",
    "American Express Card",
    "amex",
    "description_contains",
    100,
    true,
    current_timestamp()
  union all
  select
    "discover_e_payment",
    "discover_card",
    "Discover Card",
    "discover e payment",
    "description_contains",
    100,
    true,
    current_timestamp()
  union all
  select
    "chase_credit_crd",
    "chase_card_1325",
    "Chase Card 1325",
    "chase credit crd",
    "description_contains",
    100,
    true,
    current_timestamp()
  union all
  select
    "credit_one_bank_payment",
    "credit_one_bank_card",
    "Credit One Bank Card",
    "credit one bank",
    "description_contains",
    80,
    true,
    current_timestamp()
) as source
on target.alias_id = source.alias_id
when matched then update set
  target_account_id = source.target_account_id,
  target_account_name = source.target_account_name,
  alias_pattern = source.alias_pattern,
  match_strategy = source.match_strategy,
  priority = source.priority,
  enabled = source.enabled
when not matched then insert (
  alias_id,
  target_account_id,
  target_account_name,
  alias_pattern,
  match_strategy,
  priority,
  enabled,
  created_at
) values (
  source.alias_id,
  source.target_account_id,
  source.target_account_name,
  source.alias_pattern,
  source.match_strategy,
  source.priority,
  source.enabled,
  source.created_at
);
