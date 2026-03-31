"use client";

import type { Route } from "next";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  Account,
  Category,
  TransactionFilters,
  TransactionSearchSuggestion,
} from "@/lib/types/finance";

type TransactionFiltersProps = {
  accounts: Account[];
  categories: Category[];
  initialFilters: TransactionFilters;
  suggestions: TransactionSearchSuggestion[];
};

export function TransactionFilters({
  accounts,
  categories,
  initialFilters,
  suggestions,
}: TransactionFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  type FormState = {
    query: string;
    accountId: string;
    categoryId: string;
    direction: NonNullable<TransactionFilters["direction"]>;
    transactionClass: NonNullable<TransactionFilters["transactionClass"]>;
    pending: NonNullable<TransactionFilters["pending"]>;
    from: string;
    to: string;
    minAmount: string;
    maxAmount: string;
  };

  const [formState, setFormState] = useState<FormState>({
    query: initialFilters.query ?? "",
    accountId: initialFilters.accountIds?.[0] ?? "",
    categoryId: initialFilters.categoryIds?.[0] ?? "",
    direction: initialFilters.direction ?? "all",
    transactionClass: initialFilters.transactionClass ?? "all",
    pending: initialFilters.pending ?? "all",
    from: initialFilters.from ?? "",
    to: initialFilters.to ?? "",
    minAmount:
      typeof initialFilters.minAmount === "number"
        ? String(initialFilters.minAmount)
        : "",
    maxAmount:
      typeof initialFilters.maxAmount === "number"
        ? String(initialFilters.maxAmount)
        : "",
  });

  const updateField = (field: keyof FormState, value: string) => {
    setFormState((current) => ({
      ...current,
      [field]: value as FormState[keyof FormState],
    }));
  };

  const pushState = (nextState: FormState) => {
    const params = new URLSearchParams();

    Object.entries(nextState).forEach(([key, value]) => {
      if (value && value !== "all") {
        if (key === "accountId") {
          params.set("accountIds", value);
          return;
        }

        if (key === "categoryId") {
          params.set("categoryIds", value);
          return;
        }

        params.set(key, value);
      }
    });

    router.push(`${pathname}?${params.toString()}` as Route);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-3 text-sm text-slate-300">
        <SlidersHorizontal className="size-4 text-cyan-300" />
        Search, filter, and save a granular warehouse view
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-500" />
            <Input
              className="pl-10"
              placeholder="Merchant, memo, notes, keywords"
              value={formState.query}
              onChange={(event) => updateField("query", event.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Account
          </label>
          <Select
            value={formState.accountId}
            onChange={(event) => updateField("accountId", event.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Category
          </label>
          <Select
            value={formState.categoryId}
            onChange={(event) => updateField("categoryId", event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Direction
          </label>
          <Select
            value={formState.direction}
            onChange={(event) => updateField("direction", event.target.value)}
          >
            <option value="all">All</option>
            <option value="inflow">Inflow</option>
            <option value="outflow">Outflow</option>
          </Select>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-6">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Class
          </label>
          <Select
            value={formState.transactionClass}
            onChange={(event) =>
              updateField("transactionClass", event.target.value)
            }
          >
            <option value="all">All classes</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
            <option value="credit_payment">Credit payment</option>
            <option value="refund">Refund</option>
            <option value="fee">Fee</option>
            <option value="adjustment">Adjustment</option>
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Status
          </label>
          <Select
            value={formState.pending}
            onChange={(event) => updateField("pending", event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="posted">Posted</option>
            <option value="pending">Pending</option>
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            From
          </label>
          <Input
            type="date"
            value={formState.from}
            onChange={(event) => updateField("from", event.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            To
          </label>
          <Input
            type="date"
            value={formState.to}
            onChange={(event) => updateField("to", event.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Min amount
          </label>
          <Input
            inputMode="decimal"
            placeholder="0"
            value={formState.minAmount}
            onChange={(event) => updateField("minAmount", event.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
            Max amount
          </label>
          <Input
            inputMode="decimal"
            placeholder="1000"
            value={formState.maxAmount}
            onChange={(event) => updateField("maxAmount", event.target.value)}
          />
        </div>
      </div>

      {suggestions.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.type}-${suggestion.label}`}
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-cyan-300/40 hover:text-white"
              onClick={() => {
                const nextState = {
                  ...formState,
                  query: suggestion.label,
                };
                setFormState(nextState);
                pushState(nextState);
              }}
            >
              {suggestion.type}: {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" onClick={() => pushState(formState)}>
          Apply filters
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const resetState: FormState = {
              query: "",
              accountId: "",
              categoryId: "",
              direction: "all",
              transactionClass: "all",
              pending: "all",
              from: "",
              to: "",
              minAmount: "",
              maxAmount: "",
            };

            setFormState(resetState);
            router.push(pathname as Route);
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
