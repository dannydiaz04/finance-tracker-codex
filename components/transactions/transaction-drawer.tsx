"use client";

import type { Route } from "next";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Database, GitCompareArrows, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Category, TransactionDetail } from "@/lib/types/finance";
import { formatCurrency } from "@/lib/utils";

type TransactionDrawerProps = {
  transaction: TransactionDetail | null;
  categories: Category[];
};

export function TransactionDrawer({
  transaction,
  categories,
}: TransactionDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const close = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("selectedId");
    router.push(
      (
        params.toString() ? `${pathname}?${params.toString()}` : pathname
      ) as Route,
    );
  };

  return (
    <AnimatePresence>
      {transaction ? (
        <>
          <motion.button
            type="button"
            className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.aside
            initial={{ x: 480, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 480, opacity: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 25 }}
            className="fixed right-0 top-0 z-40 h-screen w-full max-w-xl overflow-y-auto border-l border-white/10 bg-slate-950/96 p-6 shadow-[0_0_120px_rgba(8,15,30,0.65)]"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">
                  Transaction detail
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {transaction.merchantRaw}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {transaction.descriptionRaw}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={close}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>{formatCurrency(transaction.signedAmount)}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm text-slate-300">
                  <div className="flex flex-wrap gap-2">
                    <Badge>{transaction.categoryLabel}</Badge>
                    <Badge>{transaction.transactionClass.replace("_", " ")}</Badge>
                    <Badge>{transaction.accountName}</Badge>
                    <Badge>{transaction.pending ? "Pending" : "Posted"}</Badge>
                  </div>
                  <div className="grid gap-2 text-sm text-slate-400">
                    <p>Posted: {transaction.postedAt}</p>
                    <p>Authorized: {transaction.authorizedAt ?? "N/A"}</p>
                    <p>Confidence: {(transaction.confidenceScore * 100).toFixed(0)}%</p>
                    <p>Rule: {transaction.ruleId ?? "No explicit rule"}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center gap-3">
                  <Sparkles className="size-5 text-cyan-300" />
                  <CardTitle className="text-base">Manual recategorization</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    action="/api/categories/override"
                    method="post"
                    className="grid gap-3"
                  >
                    <input
                      type="hidden"
                      name="transactionId"
                      value={transaction.transactionId}
                    />
                    <select
                      name="categoryId"
                      defaultValue={transaction.derivedCategoryId}
                      className="h-10 rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100"
                    >
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" variant="secondary">
                      Save override
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center gap-3">
                  <GitCompareArrows className="size-5 text-fuchsia-300" />
                  <CardTitle className="text-base">Classification history</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {transaction.classificationHistory.map((entry) => (
                    <div
                      key={`${entry.timestamp}-${entry.source}`}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge>{entry.categoryLabel}</Badge>
                        <Badge>{entry.source.replace("_", " ")}</Badge>
                      </div>
                      <p className="mt-3 text-sm text-slate-300">{entry.note}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {entry.timestamp}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center gap-3">
                  <Database className="size-5 text-emerald-300" />
                  <CardTitle className="text-base">Raw payload and transfer links</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {transaction.relatedTransfers.length > 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                      {transaction.relatedTransfers.map((related) => (
                        <p key={related.transactionId}>
                          {related.accountName}: {formatCurrency(related.signedAmount)} on{" "}
                          {related.postedAt}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-300">
                    {JSON.stringify(transaction.rawPayloadJson, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
