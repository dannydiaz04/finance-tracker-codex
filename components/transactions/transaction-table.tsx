"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import type { Transaction } from "@/lib/types/finance";

type TransactionTableProps = {
  transactions: Transaction[];
  selectedId?: string;
};

export function TransactionTable({
  transactions,
  selectedId,
}: TransactionTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const openTransaction = (transactionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selectedId", transactionId);
    router.push(`${pathname}?${params.toString()}` as Route);
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/40">
      <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr] gap-4 border-b border-white/10 px-5 py-4 text-xs uppercase tracking-[0.24em] text-slate-500">
        <span>Merchant</span>
        <span>Category</span>
        <span>Account</span>
        <span>Status</span>
        <span className="text-right">Amount</span>
      </div>

      <div className="divide-y divide-white/6">
        {transactions.map((transaction, index) => (
          <motion.button
            key={transaction.transactionId}
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.02, duration: 0.2 }}
            className={cn(
              "grid w-full grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr] gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]",
              selectedId === transaction.transactionId && "bg-cyan-400/6",
            )}
            onClick={() => openTransaction(transaction.transactionId)}
          >
            <div>
              <p className="font-medium text-white">{transaction.merchantRaw}</p>
              <p className="mt-1 text-sm text-slate-400">
                {transaction.descriptionRaw}
              </p>
            </div>
            <div className="flex items-center">
              <Badge>{transaction.categoryLabel}</Badge>
            </div>
            <div className="flex items-center text-sm text-slate-300">
              {transaction.accountName}
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  transaction.pending
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
                )}
              >
                {transaction.pending ? "Pending" : "Posted"}
              </Badge>
              <Badge>{transaction.classificationSource.replace("_", " ")}</Badge>
            </div>
            <div
              className={cn(
                "flex items-center justify-end text-right font-medium",
                transaction.signedAmount < 0 ? "text-white" : "text-emerald-300",
              )}
            >
              {formatCurrency(transaction.signedAmount)}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
