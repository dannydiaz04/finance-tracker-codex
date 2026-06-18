import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "../bigquery/client.ts";
import { coerceDateString } from "../queries/coerce.ts";

const DATASET = "ops_finance";
const TABLE = "plaid_items";

export type PlaidItemRecord = {
  userId: string | null;
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  cursor: string | null;
  status: string | null;
  error: string | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type RawPlaidItemRow = {
  userId: string | null;
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
  cursor: string | null;
  status: string | null;
  error: string | null;
  lastSyncedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

function tableRef() {
  const projectId = getBigQueryProjectId() ?? "project";
  return `\`${projectId}.${DATASET}.${TABLE}\``;
}

const SELECT_COLUMNS = `
  user_id AS userId,
  item_id AS itemId,
  access_token AS accessToken,
  institution_id AS institutionId,
  institution_name AS institutionName,
  cursor,
  status,
  error,
  last_synced_at AS lastSyncedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

function mapRow(row: RawPlaidItemRow): PlaidItemRecord {
  return {
    userId: row.userId ?? null,
    itemId: row.itemId,
    accessToken: row.accessToken,
    institutionId: row.institutionId ?? null,
    institutionName: row.institutionName ?? null,
    cursor: row.cursor ?? null,
    status: row.status ?? null,
    error: row.error ?? null,
    lastSyncedAt: row.lastSyncedAt ? coerceDateString(row.lastSyncedAt) : null,
    createdAt: row.createdAt ? coerceDateString(row.createdAt) : null,
    updatedAt: row.updatedAt ? coerceDateString(row.updatedAt) : null,
  };
}

export async function listPlaidItems(): Promise<PlaidItemRecord[]> {
  const rows = await runBigQueryQuery<RawPlaidItemRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${tableRef()} ORDER BY created_at DESC`,
  );

  return rows ? rows.map(mapRow) : [];
}

export async function listPlaidItemsByUser(
  userId: string,
): Promise<PlaidItemRecord[]> {
  const rows = await runBigQueryQuery<RawPlaidItemRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${tableRef()} WHERE user_id = @user_id ORDER BY created_at DESC`,
    { user_id: userId },
  );

  return rows ? rows.map(mapRow) : [];
}

export async function getPlaidItem(
  itemId: string,
): Promise<PlaidItemRecord | null> {
  const rows = await runBigQueryQuery<RawPlaidItemRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${tableRef()} WHERE item_id = @item_id LIMIT 1`,
    { item_id: itemId },
  );

  return rows && rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function upsertPlaidItem(input: {
  userId: string;
  itemId: string;
  accessToken: string;
  institutionId?: string | null;
  institutionName?: string | null;
}) {
  const result = await runBigQueryQuery(
    `
      MERGE ${tableRef()} AS target
      USING (SELECT @item_id AS item_id) AS source
      ON target.item_id = source.item_id
      WHEN MATCHED THEN UPDATE SET
        user_id = COALESCE(target.user_id, @user_id),
        access_token = @access_token,
        institution_id = NULLIF(@institution_id, ''),
        institution_name = NULLIF(@institution_name, ''),
        status = 'active',
        error = NULL,
        updated_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT (
        user_id,
        item_id,
        access_token,
        institution_id,
        institution_name,
        cursor,
        status,
        error,
        last_synced_at,
        created_at,
        updated_at
      ) VALUES (
        @user_id,
        @item_id,
        @access_token,
        NULLIF(@institution_id, ''),
        NULLIF(@institution_name, ''),
        NULL,
        'active',
        NULL,
        NULL,
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      )
    `,
    {
      user_id: input.userId,
      item_id: input.itemId,
      access_token: input.accessToken,
      institution_id: input.institutionId ?? "",
      institution_name: input.institutionName ?? "",
    },
  );

  return result !== null;
}

export async function updatePlaidItemCursor(itemId: string, cursor: string) {
  const result = await runBigQueryQuery(
    `
      UPDATE ${tableRef()}
      SET cursor = @cursor,
          status = 'active',
          error = NULL,
          last_synced_at = CURRENT_TIMESTAMP(),
          updated_at = CURRENT_TIMESTAMP()
      WHERE item_id = @item_id
    `,
    { cursor, item_id: itemId },
  );

  return result !== null;
}

export async function updatePlaidItemStatus(
  itemId: string,
  status: string,
  error?: string | null,
) {
  const result = await runBigQueryQuery(
    `
      UPDATE ${tableRef()}
      SET status = @status,
          error = NULLIF(@error, ''),
          updated_at = CURRENT_TIMESTAMP()
      WHERE item_id = @item_id
    `,
    { status, error: error ?? "", item_id: itemId },
  );

  return result !== null;
}

export async function deletePlaidItem(itemId: string) {
  const result = await runBigQueryQuery(
    `DELETE FROM ${tableRef()} WHERE item_id = @item_id`,
    { item_id: itemId },
  );

  return result !== null;
}
