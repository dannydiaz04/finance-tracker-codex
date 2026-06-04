import type {
  CashflowPoint,
  CategoryInsight,
  MerchantInsight,
  MonthlyFinanceSummary,
  OverviewSnapshot,
  Transaction,
  WeekdaySpendInsight,
} from "@/lib/types/finance";
import { formatMonthLabel, getMonthRange } from "@/lib/time-filter";

function isInternalMovement(transaction: Transaction) {
  return (
    transaction.transactionClass === "transfer" ||
    transaction.transactionClass === "credit_payment"
  );
}

function isSpendTransaction(transaction: Transaction) {
  return transaction.signedAmount < 0 && !isInternalMovement(transaction);
}

function isIncomeTransaction(transaction: Transaction) {
  return transaction.signedAmount > 0 && transaction.transactionClass === "income";
}

export function deriveCashflowFromTransactions(
  transactions: Transaction[],
): CashflowPoint[] {
  const byDate = new Map<string, CashflowPoint>();

  transactions.forEach((transaction) => {
    const current = byDate.get(transaction.postedAt) ?? {
      date: transaction.postedAt,
      inflow: 0,
      outflow: 0,
      net: 0,
    };

    if (isInternalMovement(transaction)) {
      byDate.set(transaction.postedAt, current);
      return;
    }

    if (transaction.signedAmount >= 0) {
      current.inflow += transaction.signedAmount;
    } else {
      current.outflow += Math.abs(transaction.signedAmount);
    }

    current.net += transaction.signedAmount;
    byDate.set(transaction.postedAt, current);
  });

  return Array.from(byDate.values()).sort((left, right) =>
    right.date.localeCompare(left.date),
  );
}

type CategoryBucket = {
  categoryId: string;
  label: string;
  amount: number;
  transactionCount: number;
  byDate: Map<string, number>;
  byMerchant: Map<string, { merchant: string; amount: number; transactionCount: number }>;
};

export function deriveCategoryInsightsFromTransactions(
  transactions: Transaction[],
): CategoryInsight[] {
  const byCategory = new Map<string, CategoryBucket>();

  transactions.filter(isSpendTransaction).forEach((transaction) => {
    const bucket =
      byCategory.get(transaction.derivedCategoryId) ??
      ({
        categoryId: transaction.derivedCategoryId,
        label: transaction.categoryLabel,
        amount: 0,
        transactionCount: 0,
        byDate: new Map<string, number>(),
        byMerchant: new Map(),
      } satisfies CategoryBucket);

    const value = Math.abs(transaction.signedAmount);
    bucket.amount += value;
    bucket.transactionCount += 1;

    bucket.byDate.set(
      transaction.postedAt,
      (bucket.byDate.get(transaction.postedAt) ?? 0) + value,
    );

    const merchantKey =
      transaction.merchantRaw || transaction.merchantNorm || "Unknown";
    const merchantEntry = bucket.byMerchant.get(merchantKey) ?? {
      merchant: merchantKey,
      amount: 0,
      transactionCount: 0,
    };
    merchantEntry.amount += value;
    merchantEntry.transactionCount += 1;
    bucket.byMerchant.set(merchantKey, merchantEntry);

    byCategory.set(transaction.derivedCategoryId, bucket);
  });

  const total = Array.from(byCategory.values()).reduce(
    (sum, bucket) => sum + bucket.amount,
    0,
  );

  return Array.from(byCategory.values())
    .map((bucket) => {
      const sparkline = Array.from(bucket.byDate.entries())
        .map(([date, amount]) => ({ date, amount }))
        .sort((left, right) => left.date.localeCompare(right.date));

      const half = Math.floor(sparkline.length / 2);
      const priorSpend = sparkline
        .slice(0, half)
        .reduce((sum, point) => sum + point.amount, 0);
      const recentSpend = sparkline
        .slice(half)
        .reduce((sum, point) => sum + point.amount, 0);
      const trend =
        sparkline.length > 1 && priorSpend > 0
          ? (recentSpend - priorSpend) / priorSpend
          : 0;

      const topMerchants = Array.from(bucket.byMerchant.values())
        .sort((left, right) => right.amount - left.amount)
        .slice(0, 3);

      return {
        categoryId: bucket.categoryId,
        label: bucket.label,
        amount: bucket.amount,
        transactionCount: bucket.transactionCount,
        share: total > 0 ? bucket.amount / total : 0,
        trend,
        averageTransaction:
          bucket.transactionCount > 0
            ? bucket.amount / bucket.transactionCount
            : 0,
        sparkline,
        topMerchants,
      };
    })
    .sort((left, right) => right.amount - left.amount);
}

export function deriveMerchantInsightsFromTransactions(
  transactions: Transaction[],
): MerchantInsight[] {
  const byMerchant = new Map<
    string,
    { merchant: string; spend: number; transactions: number }
  >();

  transactions.filter(isSpendTransaction).forEach((transaction) => {
    const merchant = transaction.merchantRaw || transaction.merchantNorm || "Unknown";
    const current = byMerchant.get(merchant) ?? {
      merchant,
      spend: 0,
      transactions: 0,
    };

    current.spend += Math.abs(transaction.signedAmount);
    current.transactions += 1;
    byMerchant.set(merchant, current);
  });

  return Array.from(byMerchant.values())
    .map((merchant) => ({
      ...merchant,
      trend: 0,
      likelyRecurring: merchant.transactions > 1,
    }))
    .sort((left, right) => right.spend - left.spend);
}

export function deriveMonthlySummariesFromTransactions(
  transactions: Transaction[],
): MonthlyFinanceSummary[] {
  const byMonth = new Map<
    string,
    { income: number; spend: number; transactionCount: number }
  >();

  transactions.forEach((transaction) => {
    const month = transaction.postedAt.slice(0, 7);
    const current = byMonth.get(month) ?? {
      income: 0,
      spend: 0,
      transactionCount: 0,
    };

    if (isIncomeTransaction(transaction)) {
      current.income += transaction.signedAmount;
    }

    if (isSpendTransaction(transaction)) {
      current.spend += Math.abs(transaction.signedAmount);
    }

    current.transactionCount += 1;
    byMonth.set(month, current);
  });

  return Array.from(byMonth.entries())
    .map(([month, summary]) => {
      const range = getMonthRange(month);

      return {
        month,
        label: formatMonthLabel(month),
        from: range.from!,
        to: range.to!,
        income: summary.income,
        spend: summary.spend,
        net: summary.income - summary.spend,
        transactionCount: summary.transactionCount,
      };
    })
    .sort((left, right) => right.month.localeCompare(left.month));
}

const weekdayLabels = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getWeekdayIndex(date: string) {
  const [yearValue, monthValue, dayValue] = date.split("-").map(Number);

  return new Date(yearValue, monthValue - 1, dayValue).getDay();
}

export function deriveWeekdaySpendFromTransactions(
  transactions: Transaction[],
): WeekdaySpendInsight[] {
  const buckets = weekdayLabels.map((weekday, weekdayIndex) => ({
    weekday,
    weekdayIndex,
    spend: 0,
    transactionCount: 0,
  }));

  transactions.filter(isSpendTransaction).forEach((transaction) => {
    const bucket = buckets[getWeekdayIndex(transaction.postedAt)];

    bucket.spend += Math.abs(transaction.signedAmount);
    bucket.transactionCount += 1;
  });

  const total = buckets.reduce((sum, bucket) => sum + bucket.spend, 0);

  return buckets.map((bucket) => ({
    ...bucket,
    averageTransaction:
      bucket.transactionCount > 0 ? bucket.spend / bucket.transactionCount : 0,
    share: total > 0 ? bucket.spend / total : 0,
  }));
}

export function deriveOverviewFromTransactions(
  transactions: Transaction[],
  base: OverviewSnapshot,
): OverviewSnapshot {
  const spendTransactions = transactions.filter(isSpendTransaction);
  const incomeTransactions = transactions.filter(isIncomeTransaction);
  const spend = spendTransactions.reduce(
    (sum, transaction) => sum + Math.abs(transaction.signedAmount),
    0,
  );
  const income = incomeTransactions.reduce(
    (sum, transaction) => sum + transaction.signedAmount,
    0,
  );
  const largestExpense = spendTransactions.sort(
    (left, right) => Math.abs(right.signedAmount) - Math.abs(left.signedAmount),
  )[0];

  return {
    ...base,
    monthToDateSpend: spend,
    monthToDateIncome: income,
    savingsRate: income > 0 ? (income - spend) / income : 0,
    largestExpense: largestExpense
      ? {
          merchant: largestExpense.merchantRaw,
          amount: largestExpense.signedAmount,
          postedAt: largestExpense.postedAt,
        }
      : {
          merchant: "No expenses in range",
          amount: 0,
          postedAt: "n/a",
    },
    cashflow: deriveCashflowFromTransactions(transactions),
    weekdaySpend: deriveWeekdaySpendFromTransactions(transactions),
    categoryMix: deriveCategoryInsightsFromTransactions(transactions).map(
      (category) => ({
        categoryId: category.categoryId,
        label: category.label,
        amount: category.amount,
        share: category.share,
      }),
    ),
    topMerchants: deriveMerchantInsightsFromTransactions(transactions).map(
      (merchant) => ({
        merchant: merchant.merchant,
        amount: merchant.spend,
        transactions: merchant.transactions,
        changeVsPrior: merchant.trend,
      }),
    ),
  };
}
