import "server-only";

import type { PlaidApi } from "plaid";

import { getBigQueryProjectId, runBigQueryQuery } from "../bigquery/client.ts";
import { extractPlaidErrorMessage } from "./client.ts";
import { deletePlaidItem, type PlaidItemRecord } from "./items.ts";

export type RemovePlaidItemResult = {
  removedAtPlaid: boolean;
  purgedWarehouse: boolean;
  deletedRecord: boolean;
};

type RemovePlaidItemDependencies = {
  getBigQueryProjectId: typeof getBigQueryProjectId;
  runBigQueryQuery: typeof runBigQueryQuery;
  deletePlaidItem: typeof deletePlaidItem;
  removePlaidItemAtPlaid: typeof removePlaidItemAtPlaid;
};

// Every Plaid sync batch writes rows tagged with an import_batch_id of the form
// `plaid-<itemId>-<timestamp>` (see persistSyncBatch) and an import_batches
// file_name of `plaid-sync:<itemId>`. That lets us scope a purge to a single
// Item without an explicit item_id column on the raw tables.
function batchPrefixParam(itemId: string) {
  return { item_id: itemId };
}

async function purgePlaidItemWarehouseData(
  userId: string,
  itemId: string,
  dependencies: RemovePlaidItemDependencies,
) {
  const projectId = dependencies.getBigQueryProjectId() ?? "project";

  // Remove account metadata for the accounts this Item ingested *before*
  // deleting the events the subquery reads. Re-linking mints brand-new Plaid
  // account_ids, so the old rows would otherwise linger as orphaned accounts.
  await dependencies.runBigQueryQuery(
    `
      DELETE FROM \`${projectId}.ops_finance.account_metadata\`
      WHERE user_id = @user_id
        AND account_id IN (
          SELECT DISTINCT source_account_id
          FROM \`${projectId}.raw_finance.transaction_events\`
          WHERE user_id = @user_id
            AND import_batch_id LIKE CONCAT('plaid-', @item_id, '-%')
        )
    `,
    { user_id: userId, ...batchPrefixParam(itemId) },
  );

  // Purge the raw events. fact_transaction_current keys on
  // source_account_id::source_transaction_id and does not dedupe by
  // canonical_group_id, so leaving these behind would double-count the ~90 days
  // that overlap with the re-linked Item's history.
  await dependencies.runBigQueryQuery(
    `
      DELETE FROM \`${projectId}.raw_finance.transaction_events\`
      WHERE user_id = @user_id
        AND import_batch_id LIKE CONCAT('plaid-', @item_id, '-%')
    `,
    { user_id: userId, ...batchPrefixParam(itemId) },
  );

  await dependencies.runBigQueryQuery(
    `
      DELETE FROM \`${projectId}.raw_finance.import_batches\`
      WHERE user_id = @user_id
        AND file_name = CONCAT('plaid-sync:', @item_id)
    `,
    { user_id: userId, ...batchPrefixParam(itemId) },
  );
}

export async function removePlaidItemAtPlaid(
  client: PlaidApi,
  accessToken: string,
) {
  try {
    await client.itemRemove({ access_token: accessToken });
    return true;
  } catch (error) {
    // Tolerate an already-removed/invalid Item — the goal is that the token is
    // gone at Plaid. Log only the safe message; the raw axios error carries the
    // access_token (body) and the PLAID-SECRET header.
    console.error("[plaid:remove] item/remove failed", {
      message: extractPlaidErrorMessage(error),
    });
    return false;
  }
}

function defaultRemovePlaidItemDependencies(): RemovePlaidItemDependencies {
  return {
    getBigQueryProjectId,
    runBigQueryQuery,
    deletePlaidItem,
    removePlaidItemAtPlaid,
  };
}

// Fully decommissions a Plaid Item: removes it at Plaid, purges its warehouse
// footprint, and deletes the stored record. Used by the disconnect flow and by
// the backfill (re-link for full history) flow once the replacement Item is in
// place.
async function removePlaidItemCompletelyWithDependencies(
  params: {
    client: PlaidApi;
    item: PlaidItemRecord;
    purgeWarehouse?: boolean;
  },
  dependencies: RemovePlaidItemDependencies,
): Promise<RemovePlaidItemResult> {
  const { client, item, purgeWarehouse = true } = params;

  const removedAtPlaid = await dependencies.removePlaidItemAtPlaid(
    client,
    item.accessToken,
  );

  let purgedWarehouse = false;
  if (purgeWarehouse && item.userId) {
    await purgePlaidItemWarehouseData(
      item.userId,
      item.itemId,
      dependencies,
    );
    purgedWarehouse = true;
  }

  const deletedRecord = await dependencies.deletePlaidItem(item.itemId);

  return { removedAtPlaid, purgedWarehouse, deletedRecord };
}

export function createPlaidItemRemover(
  dependencyOverrides: Partial<RemovePlaidItemDependencies> = {},
) {
  const dependencies = {
    ...defaultRemovePlaidItemDependencies(),
    ...dependencyOverrides,
  };

  return {
    removePlaidItemCompletely: (params: {
      client: PlaidApi;
      item: PlaidItemRecord;
      purgeWarehouse?: boolean;
    }) => removePlaidItemCompletelyWithDependencies(params, dependencies),
  };
}

export async function removePlaidItemCompletely(params: {
  client: PlaidApi;
  item: PlaidItemRecord;
  purgeWarehouse?: boolean;
}): Promise<RemovePlaidItemResult> {
  return removePlaidItemCompletelyWithDependencies(
    params,
    defaultRemovePlaidItemDependencies(),
  );
}
