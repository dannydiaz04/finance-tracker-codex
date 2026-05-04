-- Seed deterministic category rules for the first local CSV fixture set.
-- Idempotent: rules are matched by rule_id.
-- Run with:
-- bq query --use_legacy_sql=false < sql/warehouse/02_seed_initial_category_rules.sql
--
-- After running this script, rerun:
-- npx dataform run dataform

merge `finance-tracker-cdx.ops_finance.category_rules` as target
using (
  select
    "seed_merchant_contains_lunch_shop" as rule_id,
    "Lunch Shop -> Dining" as name,
    "Seed rule for fixture and bank-export lunch merchants." as description,
    100 as priority,
    true as enabled,
    "dining" as category_id,
    "Dining" as category_label,
    "merchant_contains" as match_strategy,
    "lunch shop" as match_value,
    0.25 as confidence_boost,
    cast(null as float64) as hit_rate,
    current_date() as last_matched_at,
    current_timestamp() as created_at
  union all
  select
    "seed_merchant_contains_neighborhood_market",
    "Neighborhood Market -> Groceries",
    "Seed rule for grocery-style market merchants.",
    100,
    true,
    "groceries",
    "Groceries",
    "merchant_contains",
    "neighborhood market",
    0.25,
    cast(null as float64),
    current_date(),
    current_timestamp()
  union all
  select
    "seed_merchant_contains_online_bookstore",
    "Online Bookstore -> Software",
    "Temporary seed rule until a shopping/books category exists.",
    90,
    true,
    "software",
    "Software",
    "merchant_contains",
    "online bookstore",
    0.20,
    cast(null as float64),
    current_date(),
    current_timestamp()
  union all
  select
    "seed_merchant_contains_laptop_stand",
    "Laptop Stand -> Software",
    "Temporary seed rule for Micro Center fixture hardware spend.",
    90,
    true,
    "software",
    "Software",
    "merchant_contains",
    "laptop stand",
    0.20,
    cast(null as float64),
    current_date(),
    current_timestamp()
) as source
on target.rule_id = source.rule_id
when matched then update set
  name = source.name,
  description = source.description,
  priority = source.priority,
  enabled = source.enabled,
  category_id = source.category_id,
  category_label = source.category_label,
  match_strategy = source.match_strategy,
  match_value = source.match_value,
  confidence_boost = source.confidence_boost,
  hit_rate = source.hit_rate,
  last_matched_at = source.last_matched_at
when not matched then insert (
  rule_id,
  name,
  description,
  priority,
  enabled,
  category_id,
  category_label,
  match_strategy,
  match_value,
  confidence_boost,
  hit_rate,
  last_matched_at,
  created_at
) values (
  source.rule_id,
  source.name,
  source.description,
  source.priority,
  source.enabled,
  source.category_id,
  source.category_label,
  source.match_strategy,
  source.match_value,
  source.confidence_boost,
  source.hit_rate,
  source.last_matched_at,
  source.created_at
);
