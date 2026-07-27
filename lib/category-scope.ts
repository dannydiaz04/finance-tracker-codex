/**
 * Category scope shares the `categoryIds` query key with the transaction explorer, so a link
 * copied from either surface filters the other the same way.
 */
export const CATEGORY_SCOPE_QUERY_KEY = "categoryIds";

type SearchValue = string | string[] | undefined;

export type CategoryScopeSearchParams = Record<string, SearchValue>;

export function normalizeCategoryScope(
  searchParams: CategoryScopeSearchParams,
): string[] {
  const value = searchParams[CATEGORY_SCOPE_QUERY_KEY];
  const list = Array.isArray(value) ? value : (value ?? "").split(",");

  return Array.from(
    new Set(list.map((item) => item.trim()).filter(Boolean)),
  );
}

export function readCategoryScope(source: Pick<URLSearchParams, "get">) {
  return normalizeCategoryScope({
    [CATEGORY_SCOPE_QUERY_KEY]: source.get(CATEGORY_SCOPE_QUERY_KEY) ?? undefined,
  });
}

export function applyCategoryScope(
  params: URLSearchParams,
  categoryIds: string[],
) {
  if (categoryIds.length > 0) {
    params.set(CATEGORY_SCOPE_QUERY_KEY, categoryIds.join(","));
  } else {
    params.delete(CATEGORY_SCOPE_QUERY_KEY);
  }

  return params;
}

export function toggleCategoryScope(categoryIds: string[], categoryId: string) {
  return categoryIds.includes(categoryId)
    ? categoryIds.filter((item) => item !== categoryId)
    : [...categoryIds, categoryId];
}

/** Narrow to a single category, or clear the scope when it is already the only one selected. */
export function isolateCategoryScope(categoryIds: string[], categoryId: string) {
  return categoryIds.length === 1 && categoryIds[0] === categoryId
    ? []
    : [categoryId];
}
