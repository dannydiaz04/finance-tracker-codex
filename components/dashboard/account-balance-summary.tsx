import { Landmark, Wallet2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deriveBalanceTotalsFromAccounts } from "@/lib/queries/account-balances";
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
  const scoped =
    accountIds && accountIds.length > 0
      ? accounts.filter((account) => accountIds.includes(account.id))
      : accounts;

  const { totalBalance, availableCash } = deriveBalanceTotalsFromAccounts(
    accounts,
    accountIds,
  );

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
          <Wallet2 className="size-5 text-cyan-300" />
          <div>
            <CardTitle className="text-base">Total balance</CardTitle>
            <CardDescription>
              Sum of current balances from linked accounts ({context}).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold text-white">
            {formatCurrency(totalBalance)}
          </p>
        </CardContent>
      </Card>

      <Card tone="balance">
        <CardHeader className="flex-row items-center gap-3">
          <Landmark className="size-5 text-emerald-300" />
          <div>
            <CardTitle className="text-base">Available cash</CardTitle>
            <CardDescription>
              Liquid balances on non-credit accounts ({context}).
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold text-white">
            {formatCurrency(availableCash)}
          </p>
        </CardContent>
      </Card>

      {scoped.length > 0 ? (
        <div className="md:col-span-2 space-y-2">
          {scoped.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{account.name}</p>
                <p className="truncate text-sm text-slate-400">
                  {account.institution}
                  {account.mask && account.mask !== "unknown" ? ` · •••• ${account.mask}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-medium text-white">
                  {formatCompactCurrency(account.currentBalance)}
                </p>
                <p className="text-sm text-slate-400">
                  avail {formatCompactCurrency(account.availableBalance)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
