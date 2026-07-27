import type { Category, CategoryGroup } from "@/lib/types/finance";

export type CategoryGroupDefinitionRow = {
  id: string;
  label: string;
  color: string;
  sortOrder: number | null;
  status: "active" | "archived";
  isSystem: boolean;
};

const FALLBACK_COLOR = "#64748b";

export function normalizeCategoryGroupLabel(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Allocate a deterministic per-user id for a new parent category. Repeating the
 * same create against the same catalog returns the same id, so concurrent
 * requests collapse onto one append-only entity. If that id is still occupied by
 * a category that was renamed, advance deterministically to the next free slot.
 */
export function allocateCategoryGroupId(
  label: string,
  userId: string,
  existingGroups: ReadonlyArray<Pick<CategoryGroup, "id" | "label">>,
) {
  const normalizedLabel = normalizeCategoryGroupLabel(label);

  for (let attempt = 0; attempt < 1_024; attempt += 1) {
    const id = slugifyCategoryGroupId(label, `${userId}|${attempt}`);
    const occupant = existingGroups.find((group) => group.id === id);

    if (
      !occupant ||
      normalizeCategoryGroupLabel(occupant.label) === normalizedLabel
    ) {
      return id;
    }
  }

  throw new Error("Unable to allocate a unique category id.");
}

/**
 * Resolve stable URL ids to the current warehouse labels. Display-label refs are
 * still accepted for old bookmarks; unknown refs are preserved as labels so an
 * invalid filter returns zero rows instead of silently broadening the query.
 */
export function resolveCategoryGroupFilterRefs(
  refs: ReadonlyArray<string> | undefined,
  categoryGroups: ReadonlyArray<Pick<CategoryGroup, "id" | "label">>,
) {
  const ids: string[] = [];
  const labels: string[] = [];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();

  for (const ref of refs ?? []) {
    const value = ref.trim();
    if (!value) {
      continue;
    }

    const categoryGroup =
      categoryGroups.find((group) => group.id === value) ??
      categoryGroups.find(
        (group) =>
          normalizeCategoryGroupLabel(group.label) ===
          normalizeCategoryGroupLabel(value),
      );
    const label = categoryGroup?.label ?? value;
    const normalizedLabel = normalizeCategoryGroupLabel(label);

    if (categoryGroup && !seenIds.has(categoryGroup.id)) {
      seenIds.add(categoryGroup.id);
      ids.push(categoryGroup.id);
    }
    if (!seenLabels.has(normalizedLabel)) {
      seenLabels.add(normalizedLabel);
      labels.push(label);
    }
  }

  return { ids, labels };
}

/**
 * Build the parent-category catalog implied by assignable subcategories. This keeps
 * legacy custom groups visible while the dedicated parent catalog is introduced.
 */
export function deriveCategoryGroups(
  subcategories: ReadonlyArray<
    Pick<Category, "group" | "color" | "isSystem" | "sortOrder">
  >,
): CategoryGroup[] {
  const byLabel = new Map<string, CategoryGroup>();

  for (const subcategory of subcategories) {
    const label = subcategory.group.trim();
    if (!label) {
      continue;
    }

    const key = normalizeCategoryGroupLabel(label);
    const existing = byLabel.get(key);
    if (existing) {
      existing.isSystem = Boolean(existing.isSystem || subcategory.isSystem);
      continue;
    }

    byLabel.set(key, {
      id: slugifyCategoryGroupId(label),
      label,
      color: subcategory.color || FALLBACK_COLOR,
      isSystem: Boolean(subcategory.isSystem),
      sortOrder: subcategory.sortOrder ?? null,
    });
  }

  return [...byLabel.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

/**
 * Overlay append-only user definitions on immutable seed groups and inferred legacy
 * groups. An active definition wins over an inferred group with the same display name.
 */
export function mergeCategoryGroupDefinitions(
  seed: CategoryGroup[],
  inferred: CategoryGroup[],
  userRows: CategoryGroupDefinitionRow[],
): CategoryGroup[] {
  const activeDefinitionLabels = new Set(
    userRows
      .filter((row) => row.status === "active")
      .map((row) => normalizeCategoryGroupLabel(row.label)),
  );
  const byId = new Map<string, CategoryGroup>();

  for (const group of seed) {
    byId.set(group.id, {
      ...group,
      color: group.color || FALLBACK_COLOR,
      isSystem: group.isSystem ?? true,
    });
  }

  for (const group of inferred) {
    const duplicatesSeed = [...byId.values()].some(
      (candidate) =>
        normalizeCategoryGroupLabel(candidate.label) ===
        normalizeCategoryGroupLabel(group.label),
    );
    if (
      duplicatesSeed ||
      activeDefinitionLabels.has(normalizeCategoryGroupLabel(group.label))
    ) {
      continue;
    }

    byId.set(group.id, {
      ...group,
      color: group.color || FALLBACK_COLOR,
      isSystem: Boolean(group.isSystem),
    });
  }

  for (const row of userRows) {
    if (row.status === "archived") {
      byId.delete(row.id);
      continue;
    }

    const existing = byId.get(row.id);
    byId.set(row.id, {
      id: row.id,
      label: row.label.trim(),
      color: row.color || FALLBACK_COLOR,
      sortOrder: row.sortOrder,
      isSystem: row.isSystem || Boolean(existing?.isSystem),
    });
  }

  const definitionIds = new Set(
    userRows.filter((row) => row.status === "active").map((row) => row.id),
  );
  const byDisplayLabel = new Map<string, CategoryGroup>();

  for (const group of byId.values()) {
    const key = normalizeCategoryGroupLabel(group.label);
    const current = byDisplayLabel.get(key);
    if (
      !current ||
      (definitionIds.has(group.id) && !definitionIds.has(current.id)) ||
      (Boolean(group.isSystem) && !definitionIds.has(current.id) && !current.isSystem)
    ) {
      byDisplayLabel.set(key, group);
    }
  }

  return [...byDisplayLabel.values()].sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.label.localeCompare(right.label);
  });
}

export function buildCategoryGroupDefinitionRow(input: {
  userId: string;
  categoryGroup: CategoryGroup;
  status: "active" | "archived";
  isSystem: boolean;
  now: string;
}) {
  return {
    user_id: input.userId,
    category_group_id: input.categoryGroup.id,
    label: input.categoryGroup.label,
    color: input.categoryGroup.color,
    sort_order: input.categoryGroup.sortOrder ?? null,
    status: input.status,
    is_system: input.isSystem,
    change_source: "user",
    updated_at: input.now,
    created_at: input.now,
  };
}

/** Build a stable id without collapsing distinct labels onto the same sanitized slug. */
export function slugifyCategoryGroupId(label: string, seed?: string): string {
  const normalized = label.trim().toLowerCase().normalize("NFKD");
  const base =
    normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "category";
  const hashInput = seed ? `${normalized}|${seed}` : normalized;

  let hash = 0;
  for (let index = 0; index < hashInput.length; index += 1) {
    hash = (hash * 31 + hashInput.charCodeAt(index)) | 0;
  }

  return `${base}-${Math.abs(hash).toString(36).slice(0, 6)}`;
}
