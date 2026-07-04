import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import {
  buildCategoryDefinitionRow,
  buildReassignedCategoryRuleRow,
  isSystemCategoryId,
  slugifyCategoryId,
} from "@/lib/categorization/category-catalog";
import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  countCategoryReferences,
  getCategories,
  getTransactionIdsForCategory,
} from "@/lib/queries/catalog";
import { getRules } from "@/lib/queries/rules";
import type { Category } from "@/lib/types/finance";

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

export async function POST(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const payload = upsertSchema.parse(await request.json());
    const categories = await getCategories();

    const isUpdate = Boolean(payload.categoryId);
    const existing = payload.categoryId
      ? categories.find((item) => item.id === payload.categoryId)
      : undefined;

    if (isUpdate && !existing) {
      return NextResponse.json({ error: "Unknown category." }, { status: 404 });
    }

    // Guard against accidental duplicate labels within the same group on create.
    if (!isUpdate) {
      const clash = categories.find(
        (item) =>
          item.label.toLowerCase() === payload.label.toLowerCase() &&
          item.group.toLowerCase() === payload.group.toLowerCase(),
      );
      if (clash) {
        return NextResponse.json(
          { error: `A "${payload.label}" category already exists in ${payload.group}.` },
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
      group: payload.group,
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
    const categories = await getCategories();
    const target = categories.find((item) => item.id === payload.categoryId);

    if (!target) {
      return NextResponse.json({ error: "Unknown category." }, { status: 404 });
    }

    if (target.isSystem || isSystemCategoryId(target.id)) {
      return NextResponse.json(
        { error: "System categories can be renamed but not deleted." },
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
            "This category is still in use. Choose a category to reassign its transactions and rules to before deleting.",
        },
        { status: 409 },
      );
    }

    let reassignTarget: Category | undefined;
    if (payload.reassignTo) {
      reassignTarget = categories.find((item) => item.id === payload.reassignTo);

      if (!reassignTarget) {
        return NextResponse.json(
          { error: "Reassignment target category not found." },
          { status: 400 },
        );
      }
      if (reassignTarget.id === target.id) {
        return NextResponse.json(
          { error: "Reassignment target must differ from the category being deleted." },
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
            buildReassignedCategoryRuleRow({
              rule,
              target: reassignTarget!,
              userId,
              now,
            }),
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
            reason: `Reassigned from archived category "${target.label}".`,
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
      { error: error instanceof Error ? error.message : "Invalid delete payload." },
      { status: 400 },
    );
  }
}
