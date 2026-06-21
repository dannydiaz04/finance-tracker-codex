// Read-only verification of Plaid ingestion + payload field coverage across all
// connected institutions. Selects NO secret columns (never access_token) and
// hardcodes no account identifiers. Run:
//   node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-plaid.ts
import {
  getBigQueryProjectId,
  runBigQueryQuery,
} from "../lib/bigquery/client.ts";

async function main() {
  const projectId = getBigQueryProjectId();
  if (!projectId) {
    throw new Error("BIGQUERY_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required.");
  }

  const items = await runBigQueryQuery<Record<string, unknown>>(`
    SELECT
      institution_name,
      item_id,
      status,
      error,
      (cursor IS NOT NULL AND cursor != '') AS has_cursor,
      CAST(last_synced_at AS STRING) AS last_synced_at
    FROM \`${projectId}.ops_finance.plaid_items\`
    ORDER BY created_at DESC
  `);

  const accounts = await runBigQueryQuery<Record<string, unknown>>(`
    SELECT
      institution,
      account_type,
      COUNT(*) AS accounts,
      ANY_VALUE(currency) AS currency
    FROM \`${projectId}.ops_finance.account_metadata\`
    GROUP BY institution, account_type
    ORDER BY institution, account_type
  `);

  // Plaid Transaction field coverage (inner object lives under
  // payload.$.rawPayloadJson) over the latest 2000 added events — no amounts or
  // merchant names printed, only field presence + category/channel distributions.
  const coverage = await runBigQueryQuery<Record<string, unknown>>(`
    WITH recent AS (
      SELECT payload
      FROM \`${projectId}.raw_finance.transaction_events\`
      WHERE source_name = 'plaid' AND event_type = 'added'
      ORDER BY event_timestamp DESC
      LIMIT 2000
    )
    SELECT
      COUNT(*) AS sampled,
      COUNTIF(JSON_VALUE(payload, '$.rawPayloadJson.personal_finance_category.primary') IS NOT NULL) AS pfc_primary,
      COUNTIF(JSON_VALUE(payload, '$.rawPayloadJson.personal_finance_category.detailed') IS NOT NULL) AS pfc_detailed,
      COUNTIF(JSON_VALUE(payload, '$.rawPayloadJson.payment_channel') IS NOT NULL) AS payment_channel,
      COUNTIF(JSON_VALUE(payload, '$.rawPayloadJson.merchant_name') IS NOT NULL) AS merchant_name,
      COUNTIF(JSON_VALUE(payload, '$.rawPayloadJson.merchant_entity_id') IS NOT NULL) AS merchant_entity_id,
      COUNTIF(JSON_VALUE(payload, '$.rawPayloadJson.logo_url') IS NOT NULL) AS logo_url,
      COUNTIF(JSON_QUERY(payload, '$.rawPayloadJson.counterparties') IS NOT NULL) AS counterparties
    FROM recent
  `);

  const eventsByType = await runBigQueryQuery<Record<string, unknown>>(`
    SELECT
      event_type,
      COUNT(*) AS events,
      COUNT(DISTINCT source_transaction_id) AS distinct_txns
    FROM \`${projectId}.raw_finance.transaction_events\`
    WHERE source_name = 'plaid'
    GROUP BY event_type
    ORDER BY event_type
  `);

  const martCount = await runBigQueryQuery<Record<string, unknown>>(`
    SELECT COUNT(*) AS rows_in_fact_current
    FROM \`${projectId}.core_finance.fact_transaction_current\`
  `);

  console.log(
    JSON.stringify(
      {
        plaid_items: items ?? [],
        account_metadata_summary: accounts ?? [],
        plaid_events_by_type: eventsByType ?? [],
        plaid_payload_coverage: coverage?.[0] ?? null,
        fact_transaction_current: martCount?.[0] ?? "(mart not built / dataform not run)",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("verify-plaid failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
