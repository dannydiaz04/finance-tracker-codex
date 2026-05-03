import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { sampleOverview } from "@/lib/sample-data";
import type { Account, CashflowPoint, OverviewSnapshot } from "@/lib/types/finance";

type RawOverviewAccount = {
  id: string;
  name: string;
  institution: string;
  type: Account["type"];
  subtype: string;
  currency: string;
  mask: string;
  current_balance: string | number | null;
  available_balance: string | number | null;
};

type RawOverviewSnapshot = {
  total_balance: string | number | null;
  available_cash: string | number | null;
  month_to_date_spend: string | number | null;
  month_to_date_income: string | number | null;
  savings_rate: string | number | null;
  largest_expense?: {
    merchant?: string | null;
    amount?: string | number | null;
    posted_at?: string | null;
  } | null;
  accounts?: RawOverviewAccount[] | null;
  cashflow?: Array<{
    date: string;
    inflow: string | number | null;
    outflow: string | number | null;
    net: string | number | null;
  }> | null;
  category_mix?: Array<{
    category_id: string;
    label: string;
    amount: string | number | null;
    share: string | number | null;
  }> | null;
  top_merchants?: Array<{
    merchant: string;
    amount: string | number | null;
    transactions: string | number | null;
    change_vs_prior: string | number | null;
  }> | null;
  review_queue_count: string | number | null;
};

function mapOverviewSnapshot(row: RawOverviewSnapshot): OverviewSnapshot {
  return {
    totalBalance: coerceNumber(row.total_balance),
    availableCash: coerceNumber(row.available_cash),
    monthToDateSpend: coerceNumber(row.month_to_date_spend),
    monthToDateIncome: coerceNumber(row.month_to_date_income),
    savingsRate: coerceNumber(row.savings_rate),
    largestExpense: {
      merchant: row.largest_expense?.merchant ?? "No expenses yet",
      amount: coerceNumber(row.largest_expense?.amount),
      postedAt: coerceDateString(row.largest_expense?.posted_at),
    },
    accounts: (row.accounts ?? []).map((account) => ({
      id: account.id,
      name: account.name,
      institution: account.institution,
      type: account.type,
      subtype: account.subtype,
      currency: account.currency,
      mask: account.mask,
      currentBalance: coerceNumber(account.current_balance),
      availableBalance: coerceNumber(account.available_balance),
    })),
    cashflow: (row.cashflow ?? []).map(
      (point): CashflowPoint => ({
        date: coerceDateString(point.date),
        inflow: coerceNumber(point.inflow),
        outflow: coerceNumber(point.outflow),
        net: coerceNumber(point.net),
      }),
    ),
    categoryMix: (row.category_mix ?? []).map((category) => ({
      categoryId: category.category_id,
      label: category.label,
      amount: coerceNumber(category.amount),
      share: coerceNumber(category.share),
    })),
    topMerchants: (row.top_merchants ?? []).map((merchant) => ({
      merchant: merchant.merchant,
      amount: coerceNumber(merchant.amount),
      transactions: coerceNumber(merchant.transactions),
      changeVsPrior: coerceNumber(merchant.change_vs_prior),
    })),
    reviewQueueCount: coerceNumber(row.review_queue_count),
  };
}

export async function getOverviewSnapshot() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawOverviewSnapshot>(
    `
      SELECT *
      FROM \`${projectId}.mart_finance.overview_snapshot\`
      LIMIT 1
    `,
  );

  return rows?.[0] ? mapOverviewSnapshot(rows[0]) : sampleOverview;
}
