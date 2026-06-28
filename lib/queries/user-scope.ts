export function transactionUserScopePredicate(alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  return `(${prefix}user_id = @userId OR (${prefix}user_id IS NULL AND ${prefix}source_name = 'csv'))`;
}

export function accountUserScopePredicate(alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  return `(${prefix}user_id = @userId OR (${prefix}user_id IS NULL AND ${prefix}institution = 'csv'))`;
}
