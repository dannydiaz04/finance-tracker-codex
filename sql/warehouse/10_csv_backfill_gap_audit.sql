-- CSV backfill gap audit: contiguous missing posted-date ranges per account.
-- Run:
--   bq query --use_legacy_sql=false < sql/warehouse/10_csv_backfill_gap_audit.sql
--
-- Adjust target_start to move the 3-year window. Defaults to 2023-06-28.

WITH params AS (
  SELECT DATE "2023-06-28" AS target_start, CURRENT_DATE() AS target_end
),
accounts AS (
  SELECT * FROM UNNEST([
    STRUCT("Apple Card" AS label, "apple_card" AS account_id, "csv" AS channel, "apple_card-" AS file_prefix, "card.apple.com" AS portal),
    STRUCT("Capital One 360 Checking", "capital_one_360_checking_5980", "csv", "capital_one-", "capitalone.com"),
    STRUCT("Capital One 360 Checking", "pZOLYP1Mazi1Y16vxPDycmpaQ8ErQJh33Zepp", "plaid", CAST(NULL AS STRING), "Plaid sync"),
    STRUCT("Chase Card 1325", "Yk8qQ11VeKf0q0paZeOdTBwQq8qwgYIJpXmEV", "plaid", CAST(NULL AS STRING), "Plaid sync (legacy item)"),
    STRUCT("Chase Card 1325", "XAEbzRepoEc3DgXy9yK7sYR7nDyj8PIdM9j4d", "plaid", CAST(NULL AS STRING), "Plaid sync (active item)"),
    STRUCT("Chase Card 1325", "chase_card_1325", "csv", "chase-", "chase.com"),
    STRUCT("Discover Card 7788", "discover_card", "csv", "discover-", "discover.com"),
    STRUCT("Discover it chrome 1107", "oKn8ov999YubbrDXJ4rkfzA4neZ5ELUrVxXdw", "plaid", CAST(NULL AS STRING), "Plaid sync"),
    STRUCT("American Express", "american_express_card", "csv", "american_express-", "americanexpress.com"),
    STRUCT("Micro Center Card", "micro_center_card", "csv", "micro_center-", "issuer portal")
  ])
),
days AS (
  SELECT day
  FROM params, UNNEST(GENERATE_DATE_ARRAY(target_start, target_end)) AS day
),
coverage AS (
  SELECT DISTINCT
    e.source_account_id,
    SAFE.PARSE_DATE("%Y-%m-%d", JSON_VALUE(e.payload, "$.postedAt")) AS posted_date
  FROM `finance-tracker-cdx.raw_finance.transaction_events` e
  WHERE COALESCE(JSON_VALUE(e.payload, "$.pending"), "false") != "true"
),
daily AS (
  SELECT
    a.label,
    a.channel,
    a.file_prefix,
    a.portal,
    d.day,
    IF(c.posted_date IS NOT NULL, 1, 0) AS covered
  FROM accounts a
  CROSS JOIN days d
  LEFT JOIN coverage c
    ON c.source_account_id = a.account_id
   AND c.posted_date = d.day
),
gaps AS (
  SELECT
    label,
    channel,
    file_prefix,
    portal,
    day,
    covered,
    SUM(IF(covered = 1, 1, 0)) OVER (PARTITION BY label, channel ORDER BY day) AS covered_group
  FROM daily
)
SELECT
  label,
  channel,
  file_prefix,
  portal,
  MIN(day) AS gap_start,
  MAX(day) AS gap_end,
  DATE_DIFF(MAX(day), MIN(day), DAY) + 1 AS gap_days
FROM gaps
WHERE covered = 0
GROUP BY label, channel, file_prefix, portal, covered_group
HAVING gap_days >= 7
ORDER BY label, channel, gap_start;
