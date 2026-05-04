-- Optional cleanup for verification-only import batches that have no matching events.
-- Review the SELECT output before enabling the DELETE statements.
-- Run review query with:
-- bq query --use_legacy_sql=false < sql/warehouse/04_cleanup_orphan_import_batches.sql

select
  b.import_batch_id,
  b.file_name,
  b.imported_at,
  b.row_count,
  count(e.event_id) as event_count
from `finance-tracker-cdx.raw_finance.import_batches` as b
left join `finance-tracker-cdx.raw_finance.transaction_events` as e
  using (import_batch_id)
group by 1, 2, 3, 4
having event_count != b.row_count
order by b.imported_at;

-- To delete only metadata-only verification batches after review, run:
--
-- delete from `finance-tracker-cdx.raw_finance.import_batches`
-- where import_batch_id in (
--   select import_batch_id
--   from (
--     select
--       b.import_batch_id,
--       b.row_count,
--       count(e.event_id) as event_count
--     from `finance-tracker-cdx.raw_finance.import_batches` as b
--     left join `finance-tracker-cdx.raw_finance.transaction_events` as e
--       using (import_batch_id)
--     group by 1, 2
--   )
--   where event_count = 0
--     and row_count > 0
-- );
