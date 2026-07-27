import { CreditCard, Wallet2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
} from "@/lib/queries/account-balances";
import type { Account } from "@/lib/types/finance";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

type AccountBalanceSummaryProps = {
  accounts: Account[];
  /** When set, totals reflect only these accounts (e.g. active transaction filter). */
  accountIds?: string[];
  /** Short helper under the headline numbers. */
  scopeLabel?: string;
};

export function AccountBalanceSummary({
  accounts,
  accountIds,
  scopeLabel,
}: AccountBalanceSummaryProps) {
  const rawScoped =
    accountIds && accountIds.length > 0
      ? accounts.filter((account) => accountIds.includes(account.id))
      : accounts;
  const scoped = dedupeAccountsByLogicalIdentity(rawScoped);

  const { availableCash, availableCredit, debtTotal, spendingPower } =
    deriveBalanceTotalsFromAccounts(accounts, accountIds);

  const context =
    scopeLabel ??
    (accountIds?.length === 1
      ? scoped[0]?.name ?? "Selected account"
      : accountIds && accountIds.length > 1
        ? `${accountIds.length} selected accounts`
        : "All linked accounts");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card tone="balance">
        <CardHeader className="flex-row items-center gap-3">
          <Wallet2 className="size-5 text-emerald-500" />
          <div>
            <CardTitle>Available to spend</CardTitle>
            <CardDescription>
              Liquid cash plus unused credit ({context}).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="font-mono text-3xl font-semibold text-emerald-400">
            {formatCurrency(spendingPower)}
          </p>
          <p className="font-mono text-sm text-slate-500">
            {formatCompactCurrency(availableCash)} cash +{" "}
            {formatCompactCurrency(availableCredit)} available credit
          </p>
        </CardContent>
      </Card>

      <Card tone="spend">
        <CardHeader className="flex-row items-center gap-3">
          <CreditCard className="size-5 text-red-500" />
          <div>
            <CardTitle>Credit card debt</CardTitle>
            <CardDescription>
              Outstanding balance owed on credit cards ({context}).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-3xl font-semibold text-red-400">
            {formatCurrency(debtTotal)}
          </p>
        </CardContent>
      </Card>

      {scoped.length > 0 ? (
        <div className="md:col-span-2 divide-y divide-border rounded-sm border border-border bg-card">
          {scoped.map((account) => {
            const isCredit = account.type === "credit";

            return (
              <div
                key={account.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{account.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {account.institution}
                    {account.mask && account.mask !== "unknown" ? ` · •••• ${account.mask}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={
                      isCredit
                        ? "font-mono text-sm font-medium text-red-400"
                        : "font-mono text-sm font-medium text-white"
                    }
                  >
                    {isCredit
                      ? `${formatCompactCurrency(account.currentBalance)} owed`
                      : formatCompactCurrency(account.currentBalance)}
                  </p>
                  <p className="font-mono text-xs text-slate-500">
                    {isCredit ? "avail credit " : "avail "}
                    {formatCompactCurrency(account.availableBalance)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
