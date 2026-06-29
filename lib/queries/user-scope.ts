export function transactionUserScopePredicate(alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  return `(${prefix}user_id = @userId OR (@excludePlaid AND ${prefix}user_id IS NULL AND ${prefix}source_name = 'csv'))`;
}

export function accountUserScopePredicate(alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  return `(${prefix}user_id = @userId OR (${prefix}user_id IS NULL AND ${prefix}institution = 'csv'))`;
}

export function anonymousCsvDedupePredicate(alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  return `(${prefix}user_id IS NOT NULL OR ${prefix}source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY ${prefix}canonical_group_id ORDER BY ${prefix}transaction_id) = 1)`;
}

export function plaidCanonicalDedupePredicate(alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  return `(${prefix}source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY ${prefix}user_id, ${prefix}source_name, ${prefix}canonical_group_id, ${prefix}signed_amount ORDER BY ${prefix}pending, ${prefix}transaction_id) = 1)`;
}
