import "server-only";

import type { AccountBase, RemovedTransaction, Transaction } from "plaid";

import {
  getBigQueryProjectId,
  insertBigQueryRows,
  isBigQueryConfigured,
  runBigQueryQuery,
} from "../bigquery/client.ts";
import { getPlaidClient } from "./client.ts";
import {
  getPlaidItem,
  listPlaidItems,
  listPlaidItemsByUser,
  updatePlaidItemCursor,
  updatePlaidItemStatus,
  type PlaidItemRecord,
} from "./items.ts";
import { normalizePlaidTransaction } from "./normalize.ts";

export type PlaidSyncResult = {
  itemId: string;
  institutionName: string | null;
  status: "synced" | "skipped" | "error";
  added: number;
  modified: number;
  removed: number;
  accounts: number;
  persisted: boolean;
  cursorUpdated: boolean;
  reason?: string;
};

function mapFriendlyAccountType(account: AccountBase) {
  const type = String(account.type ?? "").toLowerCase();
  const subtype = String(account.subtype ?? "").toLowerCase();

  if (type === "credit") {
    return "credit";
  }

  if (type === "investment" || type === "brokerage") {
    return "brokerage";
  }

  if (type === "depository") {
    return subtype.includes("savings") ? "savings" : "checking";
  }

  return subtype.includes("credit") ? "credit" : "checking";
}

async function upsertPlaidAccounts(
  userId: string,
  accounts: AccountBase[],
  institutionName: string | null,
) {
  const projectId = getBigQueryProjectId() ?? "project";

  for (const account of accounts) {
    await runBigQueryQuery(
      `
        MERGE \`${projectId}.ops_finance.account_metadata\` AS target
        USING (SELECT @account_id AS account_id, @user_id AS user_id) AS source
        ON target.account_id = source.account_id
          AND target.user_id = source.user_id
        WHEN MATCHED THEN UPDATE SET
          account_name = @account_name,
          institution = NULLIF(@institution, ''),
          account_type = @account_type,
          account_subtype = NULLIF(@account_subtype, ''),
          currency = @currency,
          mask = NULLIF(@mask, ''),
          current_balance = CAST(NULLIF(@current_balance, '') AS NUMERIC),
          available_balance = CAST(NULLIF(@available_balance, '') AS NUMERIC),
          is_active = true,
          notes = @notes,
          updated_at = CURRENT_TIMESTAMP()
        WHEN NOT MATCHED THEN INSERT (
          user_id,
          account_id,
          account_name,
          institution,
          account_type,
          account_subtype,
          currency,
          mask,
          current_balance,
          available_balance,
          is_active,
          notes,
          updated_at
        ) VALUES (
          @user_id,
          @account_id,
          @account_name,
          NULLIF(@institution, ''),
          @account_type,
          NULLIF(@account_subtype, ''),
          @currency,
          NULLIF(@mask, ''),
          CAST(NULLIF(@current_balance, '') AS NUMERIC),
          CAST(NULLIF(@available_balance, '') AS NUMERIC),
          true,
          @notes,
          CURRENT_TIMESTAMP()
        )
      `,
      {
        user_id: userId,
        account_id: account.account_id,
        account_name:
          account.name || account.official_name || account.account_id,
        institution: institutionName ?? "",
        account_type: mapFriendlyAccountType(account),
        account_subtype: account.subtype ? String(account.subtype) : "",
        currency: account.balances?.iso_currency_code ?? "USD",
        mask: account.mask ?? "",
        current_balance:
          typeof account.balances?.current === "number"
            ? String(account.balances.current)
            : "",
        available_balance:
          typeof account.balances?.available === "number"
            ? String(account.balances.available)
            : "",
        notes: "Connected via Plaid.",
      },
    );
  }
}

async function persistSyncBatch(params: {
  userId: string;
  itemId: string;
  added: Transaction[];
  modified: Transaction[];
  removed: RemovedTransaction[];
  accountsById: Map<string, AccountBase>;
  institutionName: string | null;
}) {
  const {
    userId,
    itemId,
    added,
    modified,
    removed,
    accountsById,
    institutionName,
  } = params;
  const importBatchId = `plaid-${itemId}-${Date.now()}`;
  const importedAt = new Date().toISOString();
  const eventRows: Record<string, unknown>[] = [];

  const appendEvent = (
    transaction: Transaction,
    eventType: "added" | "modified",
  ) => {
    const normalized = normalizePlaidTransaction(
      transaction,
      accountsById.get(transaction.account_id),
      institutionName,
    );

    eventRows.push({
      user_id: userId,
      event_id: `${importBatchId}-${eventType}-${transaction.transaction_id}`,
      import_batch_id: importBatchId,
      source_name: "plaid",
      source_transaction_id: normalized.sourceTransactionId,
      source_account_id: normalized.sourceAccountId,
      event_type: eventType,
      event_timestamp: importedAt,
      payload: JSON.stringify(normalized),
    });
  };

  added.forEach((transaction) => appendEvent(transaction, "added"));
  modified.forEach((transaction) => appendEvent(transaction, "modified"));

  if (removed.length > 0) {
    removed.forEach((entry) => {
      const sourceAccountId = entry.account_id ?? "";

      eventRows.push({
        user_id: userId,
        event_id: `${importBatchId}-removed-${entry.transaction_id}`,
        import_batch_id: importBatchId,
        source_name: "plaid",
        source_transaction_id: entry.transaction_id,
        source_account_id: sourceAccountId,
        event_type: "removed",
        event_timestamp: importedAt,
        payload: JSON.stringify({
          sourceTransactionId: entry.transaction_id,
          sourceAccountId,
          removed: true,
        }),
      });
    });
  }

  const importBatchRow: Record<string, unknown> = {
    user_id: userId,
    import_batch_id: importBatchId,
    source_name: "plaid",
    imported_at: importedAt,
    row_count: eventRows.length,
    status: "loaded",
    file_name: `plaid-sync:${itemId}`,
    mapping_profile_id: null,
    mapping_resolution_strategy: "plaid_sync",
    mapping_matched_by: ["plaid-transactions-sync"],
    runtime_source_account_id: null,
    runtime_account_name: null,
    runtime_account_mask: null,
  };

  await insertBigQueryRows("raw_finance", "import_batches", [importBatchRow]);

  if (eventRows.length > 0) {
    await insertBigQueryRows("raw_finance", "transaction_events", eventRows);
  }

  await upsertPlaidAccounts(userId, [...accountsById.values()], institutionName);
}

export async function syncPlaidItem(
  item: PlaidItemRecord,
): Promise<PlaidSyncResult> {
  const client = getPlaidClient();
  const base: PlaidSyncResult = {
    itemId: item.itemId,
    institutionName: item.institutionName,
    status: "skipped",
    added: 0,
    modified: 0,
    removed: 0,
    accounts: 0,
    persisted: false,
    cursorUpdated: false,
  };

  if (!client) {
    return { ...base, reason: "Plaid is not configured." };
  }

  if (!isBigQueryConfigured()) {
    return { ...base, reason: "BigQuery is not configured." };
  }

  if (!item.userId) {
    return {
      ...base,
      reason: "This connection predates multi-user; reconnect the bank.",
    };
  }

  const userId = item.userId;
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: RemovedTransaction[] = [];
  const accountsById = new Map<string, AccountBase>();

  let cursor = item.cursor || undefined;
  let hasMore = true;
  let nextCursor = cursor ?? "";

  console.info("[plaid:sync] start", {
    itemId: item.itemId,
    userId,
    incremental: Boolean(item.cursor),
  });

  try {
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: item.accessToken,
        cursor,
        count: 500,
      });

      const data = response.data;
      added.push(...data.added);
      modified.push(...data.modified);
      removed.push(...data.removed);
      data.accounts.forEach((account) =>
        accountsById.set(account.account_id, account),
      );

      hasMore = data.has_more;
      cursor = data.next_cursor;
      nextCursor = data.next_cursor;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Plaid transactions sync failed.";
    // Log only the safe message — never the raw axios/Plaid error, whose
    // `.config` carries the Item access_token (body) and the PLAID-SECRET header.
    console.error("[plaid:sync] transactions/sync failed", {
      itemId: item.itemId,
      userId,
      message,
    });
    await updatePlaidItemStatus(item.itemId, "error", message);
    return { ...base, status: "error", reason: message };
  }

  await persistSyncBatch({
    userId,
    itemId: item.itemId,
    added,
    modified,
    removed,
    accountsById,
    institutionName: item.institutionName,
  });

  const cursorUpdated = await updatePlaidItemCursor(item.itemId, nextCursor);

  console.info("[plaid:sync] complete", {
    itemId: item.itemId,
    userId,
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    accounts: accountsById.size,
    cursorUpdated,
  });

  return {
    ...base,
    status: "synced",
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    accounts: accountsById.size,
    persisted: true,
    cursorUpdated,
  };
}

export async function syncPlaidItemById(itemId: string) {
  const item = await getPlaidItem(itemId);

  if (!item) {
    return null;
  }

  return syncPlaidItem(item);
}

export async function syncAllPlaidItems(): Promise<PlaidSyncResult[]> {
  const items = await listPlaidItems();
  const results: PlaidSyncResult[] = [];

  for (const item of items) {
    results.push(await syncPlaidItem(item));
  }

  return results;
}

export async function syncPlaidItemsForUser(
  userId: string,
): Promise<PlaidSyncResult[]> {
  const items = await listPlaidItemsByUser(userId);
  const results: PlaidSyncResult[] = [];

  for (const item of items) {
    results.push(await syncPlaidItem(item));
  }

  return results;
}
