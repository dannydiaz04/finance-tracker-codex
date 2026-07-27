import { NextRequest, NextResponse } from "next/server";

import { normalizeTransactionFilters } from "@/lib/bigquery/params";
import { resolveCategoryGroupFilterRefs } from "@/lib/categorization/category-group-catalog";
import { getCategories, getCategoryGroups } from "@/lib/queries/catalog";
import { getTransactions } from "@/lib/queries/transactions";

export async function GET(request: NextRequest) {
  const urlFilters = normalizeTransactionFilters(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  const categories = await getCategories();
  const categoryGroups = await getCategoryGroups(categories);
  const categoryGroupFilter = resolveCategoryGroupFilterRefs(
    urlFilters.categoryGroupIds,
    categoryGroups,
  );
  const filters = {
    ...urlFilters,
    categoryGroupIds:
      categoryGroupFilter.ids.length > 0 ? categoryGroupFilter.ids : undefined,
    categoryGroupLabels:
      categoryGroupFilter.labels.length > 0
        ? categoryGroupFilter.labels
        : undefined,
  };
  const transactions = await getTransactions(filters);

  return NextResponse.json({
    data: transactions,
    summary: {
      count: transactions.length,
      lowConfidence: transactions.filter((row) => row.confidenceScore < 0.75)
        .length,
    },
  });
}
