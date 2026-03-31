export type PlaidSyncEvent = {
  cursor: string | null;
  added: Array<Record<string, unknown>>;
  modified: Array<Record<string, unknown>>;
  removed: Array<{
    transaction_id: string;
  }>;
};

export type PlaidWebhookPayload = {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: Record<string, unknown>;
};

export type PlaidLinkTokenResponse = {
  link_token: string;
  expiration: string;
};
