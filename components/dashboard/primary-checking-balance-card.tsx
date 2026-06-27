import { Landmark } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PrimaryCheckingBalance } from "@/lib/types/finance";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

type PrimaryCheckingBalanceCardProps = {
  balance: PrimaryCheckingBalance | null;
};

export function PrimaryCheckingBalanceCard({ balance }: PrimaryCheckingBalanceCardProps) {
  if (!balance) {
    return (
      <Card tone="balance">
        <CardHeader className="flex-row items-center gap-3">
          <Landmark className="size-5 text-cyan-300" />
          <div>
            <CardTitle className="text-base">Capital One checking</CardTitle>
            <CardDescription>
              Link or sync a Capital One checking account to show its live current balance
              here. This figure is not affected by the time filter.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold text-slate-500">—</p>
        </CardContent>
      </Card>
    );
  }

  const maskLabel =
    balance.mask && balance.mask !== "unknown" ? ` · •••• ${balance.mask}` : "";

  return (
    <Card tone="balance">
      <CardHeader className="flex-row items-center gap-3">
        <Landmark className="size-5 text-cyan-300" />
        <div>
          <CardTitle className="text-base">{balance.accountName}</CardTitle>
          <CardDescription>
            Live current balance from {balance.institution}
            {maskLabel}. Unchanged by the time filter — matches what your checking account
            shows after the last Plaid sync.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
            Current balance
          </p>
          <p className="mt-2 text-4xl font-semibold text-white">
            {formatCurrency(balance.currentBalance)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Available</p>
          <p className="mt-2 text-lg font-medium text-slate-300">
            {formatCompactCurrency(balance.availableBalance)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
