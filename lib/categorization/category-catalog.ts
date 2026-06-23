import type { Category } from "@/lib/types/finance";

/**
 * Pure helpers for the user-maintained category catalog. Kept free of server/db imports
 * so they can be unit-tested and shared between the query layer and the override API.
 */

export type CategoryDefinitionRow = {
  id: string;
  label: string;
  group: string;
  sublabel: string;
  color: string;
  sortOrder: number | null;
  status: "active" | "archived";
  isSystem: boolean;
};

/** Seed category ids whose warehouse semantics must never be archived (only renamed). */
export const SYSTEM_CATEGORY_IDS = new Set<string>([
  "uncategorized",
  "transfers",
  "credit-card-payment",
  "fees",
  "salary",
]);

const FALLBACK_COLOR = "#64748b";

export function isSystemCategoryId(categoryId: string): boolean {
  return SYSTEM_CATEGORY_IDS.has(categoryId);
}

/**
 * Merge the immutable seed catalog with a user's latest definition per category id.
 * Active user rows upsert (override seed or add new); archived rows remove the category
 * from the effective set. Result is sorted by sortOrder (nulls last) then label.
 */
export function mergeCategoryDefinitions(
  seed: Category[],
  userRows: CategoryDefinitionRow[],
): Category[] {
  const byId = new Map<string, Category>();

  for (const category of seed) {
    byId.set(category.id, {
      ...category,
      isSystem: category.isSystem ?? true,
    });
  }

  for (const row of userRows) {
    if (row.status === "archived") {
      byId.delete(row.id);
      continue;
    }

    byId.set(row.id, {
      id: row.id,
      label: row.label,
      group: row.group,
      sublabel: row.sublabel,
      color: row.color || FALLBACK_COLOR,
      isSystem: row.isSystem || isSystemCategoryId(row.id),
      sortOrder: row.sortOrder,
    });
  }

  return [...byId.values()].sort((a, b) => {
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return a.label.localeCompare(b.label);
  });
}

/**
 * Build a stable, collision-resistant category id from a label. The suffix keeps two
 * categories with the same label (e.g. "Travel") from colliding, and keeps user ids out
 * of the seed id namespace.
 */
export function slugifyCategoryId(label: string, seed: string): string {
  const base = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }

  const suffix = Math.abs(hash).toString(36).slice(0, 6);

  return `${base || "category"}-${suffix}`;
}
