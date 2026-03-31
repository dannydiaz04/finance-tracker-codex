import { DatabaseZap, Filter, SearchCheck } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { TransactionDrawer } from "@/components/transactions/transaction-drawer";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionTable } from "@/components/transactions/transaction-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeTransactionFilters } from "@/lib/bigquery/params";
import { getAccounts, getCategories } from "@/lib/queries/catalog";
import {
  getTransactionById,
  getTransactions,
  getTransactionSearchSuggestions,
} from "@/lib/queries/transactions";
import { formatCurrency } from "@/lib/utils";

type TransactionsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  const filters = normalizeTransactionFilters(await searchParams);
  const [accounts, categories, transactions, suggestions, selectedTransaction] =
    await Promise.all([
      getAccounts(),
      getCategories(),
      getTransactions(filters),
      getTransactionSearchSuggestions(filters.query ?? ""),
      filters.selectedId ? getTransactionById(filters.selectedId) : null,
    ]);

  const net = transactions.reduce(
    (sum, transaction) => sum + transaction.signedAmount,
    0,
  );
  const lowConfidence = transactions.filter(
    (transaction) => transaction.confidenceScore < 0.75,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Transactions explorer"
        title="Search every expense and deposit at warehouse grain."
        description="This explorer is optimized for precise filtering, confidence-aware review, and one-click recategorization. Filters live in the URL so views can be revisited and shared later."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Visible rows</CardTitle>
            <Filter className="size-4 text-cyan-300" />
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-white">
            {transactions.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Net movement</CardTitle>
            <DatabaseZap className="size-4 text-fuchsia-300" />
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-white">
            {formatCurrency(net)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Low confidence</CardTitle>
            <SearchCheck className="size-4 text-amber-300" />
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-white">
            {lowConfidence}
          </CardContent>
        </Card>
      </div>

      <TransactionFilters
        accounts={accounts}
        categories={categories}
        initialFilters={filters}
        suggestions={suggestions}
      />

      <TransactionTable
        transactions={transactions}
        selectedId={filters.selectedId}
      />

      <TransactionDrawer transaction={selectedTransaction} categories={categories} />
    </div>
  );
}
