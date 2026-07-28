import { createHash } from "node:crypto";

/**
 * Stable identities make retries collide with the same suggestion/rule ids instead
 * of creating duplicate append-only rows.
 */
export function buildOverrideIdentity(input: {
  userId: string;
  transactionId: string;
  categoryId: string;
}) {
  return createHash("sha1")
    .update([input.userId, input.transactionId, input.categoryId].join("|"))
    .digest("hex")
    .slice(0, 24);
}
