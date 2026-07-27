import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import {
  getBigQueryProjectId,
  isBigQueryConfigured,
  runBigQueryQuery,
} from "@/lib/bigquery/client";
import {
  allocateCategoryGroupId,
  normalizeCategoryGroupLabel,
} from "@/lib/categorization/category-group-catalog";
import { getCategories, getCategoryGroups } from "@/lib/queries/catalog";
import type { Category, CategoryGroup } from "@/lib/types/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const DEFAULT_COLOR = "#64748b";

const upsertSchema = z.object({
  categoryGroupId: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(40),
  color: z.string().trim().regex(HEX_COLOR, "Color must be a hex value.").optional(),
  sortOrder: z.number().int().optional(),
});

const archiveSchema = z.object({
  categoryGroupId: z.string().min(1),
  reassignTo: z.string().min(1).optional(),
});

function subcategoriesInGroup(subcategories: Category[], groupLabel: string) {
  const normalizedGroup = normalizeCategoryGroupLabel(groupLabel);
  return subcategories.filter(
    (subcategory) =>
      normalizeCategoryGroupLabel(subcategory.group) === normalizedGroup,
  );
}

async function persistCategoryGroupMutation(input: {
  userId: string;
  now: string;
  categoryGroup: CategoryGroup;
  status: "active" | "archived";
  subcategoryIds: string[];
  targetGroupLabel?: string;
}) {
  if (!isBigQueryConfigured()) {
    return false;
  }

  const projectId = getBigQueryProjectId();
  if (!projectId) {
    return false;
  }

  const moveSubcategories =
    input.subcategoryIds.length > 0 && input.targetGroupLabel
      ? `
        INSERT INTO \`${projectId}.ops_finance.category_definitions\` (
          user_id,
          category_id,
          label,
          category_l1,
          category_l2,
          color,
          sort_order,
          status,
          is_system,
          change_source,
          updated_at,
          created_at
        )
        SELECT
          @userId,
          effective.category_id,
          effective.label,
          @targetGroupLabel,
          effective.category_l2,
          effective.color,
          effective.sort_order,
          'active',
          effective.is_system,
          'user',
          TIMESTAMP(@now),
          TIMESTAMP(@now)
        FROM (
          SELECT
            category_id,
            label,
            category_l2,
            color,
            sort_order,
            is_system
          FROM \`${projectId}.core_finance.dim_category_effective\`
          WHERE category_id IN UNNEST(@subcategoryIds)
            AND (user_id = @userId OR user_id IS NULL)
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY category_id
            ORDER BY IF(user_id = @userId, 0, 1)
          ) = 1
        ) AS effective;
      `
      : "";
  const params: Record<string, unknown> = {
    userId: input.userId,
    now: input.now,
    categoryGroupId: input.categoryGroup.id,
    label: input.categoryGroup.label,
    color: input.categoryGroup.color,
    hasSortOrder: typeof input.categoryGroup.sortOrder === "number",
    sortOrder: input.categoryGroup.sortOrder ?? 0,
    status: input.status,
    isSystem: Boolean(input.categoryGroup.isSystem),
  };

  if (moveSubcategories) {
    params.subcategoryIds = input.subcategoryIds;
    params.targetGroupLabel = input.targetGroupLabel;
  }

  await runBigQueryQuery(
    `
      BEGIN TRANSACTION;

      ${moveSubcategories}

      INSERT INTO \`${projectId}.ops_finance.category_group_definitions\` (
        user_id,
        category_group_id,
        label,
        color,
        sort_order,
        status,
        is_system,
        change_source,
        updated_at,
        created_at
      )
      VALUES (
        @userId,
        @categoryGroupId,
        @label,
        @color,
        IF(@hasSortOrder, @sortOrder, NULL),
        @status,
        @isSystem,
        'user',
        TIMESTAMP(@now),
        TIMESTAMP(@now)
      );

      COMMIT TRANSACTION;
    `,
    params,
  );

  return true;
}

async function getCatalogs() {
  const subcategories = await getCategories({ strict: true });
  const categoryGroups = await getCategoryGroups(subcategories, { strict: true });
  return { categoryGroups, subcategories };
}

export async function POST(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const payload = upsertSchema.parse(await request.json());
    const { categoryGroups, subcategories } = await getCatalogs();
    const existing = payload.categoryGroupId
      ? categoryGroups.find((group) => group.id === payload.categoryGroupId)
      : undefined;

    if (payload.categoryGroupId && !existing) {
      return NextResponse.json({ error: "Unknown category." }, { status: 404 });
    }

    const clash = categoryGroups.find(
      (group) =>
        group.id !== payload.categoryGroupId &&
        normalizeCategoryGroupLabel(group.label) ===
          normalizeCategoryGroupLabel(payload.label),
    );
    if (clash) {
      return NextResponse.json(
        { error: `A "${payload.label}" category already exists.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const categoryGroup: CategoryGroup = {
      id:
        existing?.id ??
        allocateCategoryGroupId(payload.label, userId, categoryGroups),
      label: payload.label,
      color: payload.color ?? existing?.color ?? DEFAULT_COLOR,
      sortOrder: payload.sortOrder ?? existing?.sortOrder ?? null,
      isSystem: Boolean(existing?.isSystem),
    };
    const affectedSubcategories =
      existing && existing.label !== categoryGroup.label
        ? subcategoriesInGroup(subcategories, existing.label)
        : [];
    const persisted = await persistCategoryGroupMutation({
      userId,
      now,
      categoryGroup,
      status: "active",
      subcategoryIds: affectedSubcategories.map(
        (subcategory) => subcategory.id,
      ),
      targetGroupLabel: categoryGroup.label,
    });
    const movedSubcategories = persisted ? affectedSubcategories.length : 0;

    return NextResponse.json({
      status: existing ? "updated" : "created",
      persisted,
      movedSubcategories,
      categoryGroup,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid category payload." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const payload = archiveSchema.parse(await request.json());
    const { categoryGroups, subcategories } = await getCatalogs();
    const target = categoryGroups.find(
      (group) => group.id === payload.categoryGroupId,
    );

    if (!target) {
      return NextResponse.json({ error: "Unknown category." }, { status: 404 });
    }

    if (target.isSystem) {
      return NextResponse.json(
        { error: "System categories can be renamed but not deleted." },
        { status: 400 },
      );
    }

    const children = subcategoriesInGroup(subcategories, target.label);
    if (children.length > 0 && !payload.reassignTo) {
      return NextResponse.json(
        {
          status: "reassignment_required",
          references: { subcategories: children.length },
          error:
            "This category still contains subcategories. Choose a replacement category before deleting it.",
        },
        { status: 409 },
      );
    }

    let replacement: CategoryGroup | undefined;
    if (payload.reassignTo) {
      replacement = categoryGroups.find(
        (group) => group.id === payload.reassignTo,
      );
      if (!replacement) {
        return NextResponse.json(
          { error: "Replacement category not found." },
          { status: 400 },
        );
      }
      if (replacement.id === target.id) {
        return NextResponse.json(
          { error: "Replacement category must differ from the category being deleted." },
          { status: 400 },
        );
      }
    }

    if (replacement && children.length > 0) {
      const destinationLabels = new Set(
        subcategoriesInGroup(subcategories, replacement.label).map(
          (subcategory) => subcategory.label.trim().toLowerCase(),
        ),
      );
      const conflicts = children.filter((subcategory) =>
        destinationLabels.has(subcategory.label.trim().toLowerCase()),
      );
      if (conflicts.length > 0) {
        return NextResponse.json(
          {
            status: "subcategory_conflict",
            error: `Move or rename the conflicting subcategory first: ${conflicts
              .map((subcategory) => subcategory.label)
              .join(", ")}.`,
          },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    const persisted = await persistCategoryGroupMutation({
      userId,
      now,
      categoryGroup: target,
      status: "archived",
      subcategoryIds: children.map((subcategory) => subcategory.id),
      targetGroupLabel: replacement?.label,
    });
    const movedSubcategories =
      persisted && replacement ? children.length : 0;

    return NextResponse.json({
      status: "archived",
      persisted,
      reassignedTo: replacement?.id ?? null,
      movedSubcategories,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid delete payload." },
      { status: 400 },
    );
  }
}
