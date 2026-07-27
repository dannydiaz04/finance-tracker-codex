import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import {
  buildCategoryDefinitionRow,
  isSystemCategoryId,
  slugifyCategoryId,
} from "@/lib/categorization/category-catalog";
import { normalizeCategoryGroupLabel } from "@/lib/categorization/category-group-catalog";
import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  countCategoryReferences,
  getCategories,
  getCategoryGroups,
  getTransactionIdsForCategory,
} from "@/lib/queries/catalog";
import { getRules } from "@/lib/queries/rules";
import type { Category, Rule } from "@/lib/types/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const upsertSchema = z.object({
  // Omitted → create; present → update an existing category (seed or user).
  categoryId: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(60),
  group: z.string().trim().min(1).max(40),
  sublabel: z.string().trim().max(60).optional().default(""),
  color: z.string().trim().regex(HEX_COLOR, "Color must be a hex value.").optional(),
  sortOrder: z.number().int().optional(),
});

const archiveSchema = z.object({
  categoryId: z.string().min(1),
  // Required when the category is still referenced; reassigns transactions + rules.
  reassignTo: z.string().min(1).optional(),
});

const DEFAULT_COLOR = "#64748b";

// Reassign a deterministic rule to a different category by appending a new version that
// shares rule_id (fact_classification keeps the latest row per rule_id).
function reassignedRuleRow(rule: Rule, target: Category, userId: string, now: string) {
  return {
    user_id: userId,
    rule_id: rule.id,
    name: rule.name,
    description: rule.description,
    priority: rule.priority,
    enabled: rule.enabled,
    category_id: target.id,
    category_label: target.label,
    match_strategy: rule.matchStrategy,
    match_value: rule.matchValue,
    confidence_boost: rule.confidenceBoost,
    hit_rate: rule.hitRate,
    last_matched_at: rule.lastMatchedAt ?? null,
    created_at: now,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const payload = upsertSchema.parse(await request.json());
    const categories = await getCategories({ strict: true });
    const categoryGroups = await getCategoryGroups(categories, { strict: true });
    const parentCategory = categoryGroups.find(
      (group) =>
        normalizeCategoryGroupLabel(group.label) ===
        normalizeCategoryGroupLabel(payload.group),
    );

    if (!parentCategory) {
      return NextResponse.json(
        { error: "Choose an existing category before saving the subcategory." },
        { status: 400 },
      );
    }

    const isUpdate = Boolean(payload.categoryId);
    const existing = payload.categoryId
      ? categories.find((item) => item.id === payload.categoryId)
      : undefined;

    if (isUpdate && !existing) {
      return NextResponse.json({ error: "Unknown subcategory." }, { status: 404 });
    }

    // Guard against accidental duplicate subcategory labels within the same category.
    if (!isUpdate) {
      const clash = categories.find(
        (item) =>
          item.label.trim().toLowerCase() === payload.label.toLowerCase() &&
          normalizeCategoryGroupLabel(item.group) ===
            normalizeCategoryGroupLabel(parentCategory.label),
      );
      if (clash) {
        return NextResponse.json(
          {
            error: `A "${payload.label}" subcategory already exists in ${parentCategory.label}.`,
          },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    const categoryId =
      payload.categoryId ?? slugifyCategoryId(payload.label, `${userId}|${now}`);
    const isSystem = isUpdate
      ? Boolean(existing?.isSystem) || isSystemCategoryId(categoryId)
      : false;

    const category: Category = {
      id: categoryId,
      label: payload.label,
      group: parentCategory.label,
      sublabel: payload.sublabel ?? "",
      color: payload.color ?? existing?.color ?? DEFAULT_COLOR,
      sortOrder: payload.sortOrder ?? existing?.sortOrder ?? null,
    };

    const row = buildCategoryDefinitionRow({
      userId,
      category,
      status: "active",
      isSystem,
      now,
    });

    const persisted = isBigQueryConfigured()
      ? await insertBigQueryRows("ops_finance", "category_definitions", [row])
      : false;

    return NextResponse.json({
      status: isUpdate ? "updated" : "created",
      persisted,
      category: { ...category, isSystem },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid subcategory payload.",
      },
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
    const categories = await getCategories({ strict: true });
    const target = categories.find((item) => item.id === payload.categoryId);

    if (!target) {
      return NextResponse.json({ error: "Unknown subcategory." }, { status: 404 });
    }

    if (target.isSystem || isSystemCategoryId(target.id)) {
      return NextResponse.json(
        { error: "System subcategories can be renamed but not deleted." },
        { status: 400 },
      );
    }

    const references = await countCategoryReferences(userId, target.id);
    const hasReferences = references.transactions > 0 || references.rules > 0;

    // Block the delete until the caller chooses where to move existing usage.
    if (hasReferences && !payload.reassignTo) {
      return NextResponse.json(
        {
          status: "reassignment_required",
          references,
          error:
            "This subcategory is still in use. Choose a subcategory to reassign its transactions and rules to before deleting.",
        },
        { status: 409 },
      );
    }

    let reassignTarget: Category | undefined;
    if (payload.reassignTo) {
      reassignTarget = categories.find((item) => item.id === payload.reassignTo);

      if (!reassignTarget) {
        return NextResponse.json(
          { error: "Reassignment target subcategory not found." },
          { status: 400 },
        );
      }
      if (reassignTarget.id === target.id) {
        return NextResponse.json(
          {
            error:
              "Reassignment target must differ from the subcategory being deleted.",
          },
          { status: 400 },
        );
      }
    }

    const now = new Date().toISOString();
    const bigQueryConfigured = isBigQueryConfigured();
    let reassignedTransactions = 0;
    let reassignedRules = 0;

    if (reassignTarget && hasReferences && bigQueryConfigured) {
      // Reassign active rules that point at the doomed category.
      const rules = await getRules();
      const rulesToMove = rules.filter(
        (rule) => rule.categoryId === target.id && rule.enabled,
      );
      if (rulesToMove.length > 0) {
        await insertBigQueryRows(
          "ops_finance",
          "category_rules",
          rulesToMove.map((rule) =>
            reassignedRuleRow(rule, reassignTarget!, userId, now),
          ),
        );
        reassignedRules = rulesToMove.length;
      }

      // Pin every transaction currently classified to the category onto the new one via
      // manual overrides (highest-precedence classification), so the reassignment survives
      // the next warehouse rebuild and shows immediately in live ops reads.
      const transactionIds = await getTransactionIdsForCategory(userId, target.id);
      if (transactionIds.length > 0) {
        await insertBigQueryRows(
          "ops_finance",
          "manual_overrides",
          transactionIds.map((transactionId) => ({
            user_id: userId,
            transaction_id: transactionId,
            category_id: reassignTarget!.id,
            reason: `Reassigned from archived subcategory "${target.label}".`,
            updated_at: now,
          })),
        );
        reassignedTransactions = transactionIds.length;
      }
    }

    const tombstone = buildCategoryDefinitionRow({
      userId,
      category: target,
      status: "archived",
      isSystem: false,
      now,
    });

    const persisted = bigQueryConfigured
      ? await insertBigQueryRows("ops_finance", "category_definitions", [tombstone])
      : false;

    return NextResponse.json({
      status: "archived",
      persisted,
      reassignedTo: reassignTarget?.id ?? null,
      reassignedTransactions,
      reassignedRules,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid subcategory delete payload.",
      },
      { status: 400 },
    );
  }
}
