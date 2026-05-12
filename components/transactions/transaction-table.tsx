"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ListFilter,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import type { Transaction } from "@/lib/types/finance";

type TransactionTableProps = {
  transactions: Transaction[];
  selectedId?: string;
};

type ColumnId =
  | "merchant"
  | "date"
  | "category"
  | "account"
  | "status"
  | "amount";
type TextColumnId = Exclude<ColumnId, "amount">;
type SortDirection = "asc" | "desc";
type SortState = { column: ColumnId; direction: SortDirection } | null;

type TextFilterState = {
  query: string;
  // null = all values pass the filter (no filter applied)
  selectedValues: string[] | null;
};

type NumberFilterState = {
  min: string;
  max: string;
};

type ColumnFilters = {
  merchant: TextFilterState;
  date: TextFilterState;
  category: TextFilterState;
  account: TextFilterState;
  status: TextFilterState;
  amount: NumberFilterState;
};

const EMPTY_TEXT: TextFilterState = { query: "", selectedValues: null };
const EMPTY_NUMBER: NumberFilterState = { min: "", max: "" };

const INITIAL_FILTERS: ColumnFilters = {
  merchant: EMPTY_TEXT,
  date: EMPTY_TEXT,
  category: EMPTY_TEXT,
  account: EMPTY_TEXT,
  status: EMPTY_TEXT,
  amount: EMPTY_NUMBER,
};

const transactionDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function getStatusLabel(transaction: Transaction) {
  return transaction.pending ? "Pending" : "Posted";
}

function formatTransactionDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return transactionDateFormatter.format(new Date(year, month - 1, day));
}

function getColumnText(column: TextColumnId, transaction: Transaction): string {
  switch (column) {
    case "merchant":
      return transaction.merchantRaw;
    case "date":
      return transaction.postedAt;
    case "category":
      return transaction.categoryLabel;
    case "account":
      return transaction.accountName;
    case "status":
      return getStatusLabel(transaction);
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function TransactionTable({
  transactions,
  selectedId,
}: TransactionTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<ColumnFilters>(INITIAL_FILTERS);

  const distinctMerchants = useMemo(
    () => unique(transactions.map((t) => t.merchantRaw)),
    [transactions],
  );
  const distinctDates = useMemo(
    () => unique(transactions.map((t) => t.postedAt)),
    [transactions],
  );
  const distinctCategories = useMemo(
    () => unique(transactions.map((t) => t.categoryLabel)),
    [transactions],
  );
  const distinctAccounts = useMemo(
    () => unique(transactions.map((t) => t.accountName)),
    [transactions],
  );
  const distinctStatuses = useMemo(
    () => unique(transactions.map(getStatusLabel)),
    [transactions],
  );

  const visibleTransactions = useMemo(() => {
    const passText = (column: TextColumnId, transaction: Transaction) => {
      const filter = filters[column];
      if (filter.selectedValues === null) return true;
      return filter.selectedValues.includes(getColumnText(column, transaction));
    };

    const minRaw = filters.amount.min.trim();
    const maxRaw = filters.amount.max.trim();
    const minValue = minRaw === "" ? null : Number(minRaw);
    const maxValue = maxRaw === "" ? null : Number(maxRaw);
    const minActive = minValue !== null && !Number.isNaN(minValue);
    const maxActive = maxValue !== null && !Number.isNaN(maxValue);

    let rows = transactions.filter((transaction) => {
      if (!passText("merchant", transaction)) return false;
      if (!passText("date", transaction)) return false;
      if (!passText("category", transaction)) return false;
      if (!passText("account", transaction)) return false;
      if (!passText("status", transaction)) return false;
      if (minActive && transaction.signedAmount < (minValue as number)) return false;
      if (maxActive && transaction.signedAmount > (maxValue as number)) return false;
      return true;
    });

    if (sort) {
      const directionMultiplier = sort.direction === "asc" ? 1 : -1;
      const sorted = [...rows];
      sorted.sort((a, b) => {
        if (sort.column === "amount") {
          return (a.signedAmount - b.signedAmount) * directionMultiplier;
        }
        const av = getColumnText(sort.column, a).toLowerCase();
        const bv = getColumnText(sort.column, b).toLowerCase();
        return av.localeCompare(bv) * directionMultiplier;
      });
      rows = sorted;
    }

    return rows;
  }, [transactions, filters, sort]);

  const openTransaction = (transactionId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selectedId", transactionId);
    router.push(`${pathname}?${params.toString()}` as Route);
  };

  const handleSort = useCallback((column: ColumnId, direction: SortDirection) => {
    setSort({ column, direction });
  }, []);

  const handleTextFilter = useCallback(
    (column: TextColumnId, value: TextFilterState) => {
      setFilters((current) => ({ ...current, [column]: value }));
    },
    [],
  );

  const handleNumberFilter = useCallback(
    (column: "amount", value: NumberFilterState) => {
      setFilters((current) => ({ ...current, [column]: value }));
    },
    [],
  );

  const filterCount =
    (filters.merchant.selectedValues !== null ? 1 : 0) +
    (filters.date.selectedValues !== null ? 1 : 0) +
    (filters.category.selectedValues !== null ? 1 : 0) +
    (filters.account.selectedValues !== null ? 1 : 0) +
    (filters.status.selectedValues !== null ? 1 : 0) +
    (filters.amount.min !== "" || filters.amount.max !== "" ? 1 : 0);

  const hasModifications = filterCount > 0 || sort !== null;

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/40">
      <div className="grid grid-cols-[1.2fr_0.72fr_1fr_0.8fr_0.8fr_0.8fr] items-center gap-4 border-b border-white/10 px-5 py-4 text-xs uppercase tracking-[0.24em] text-slate-500">
        <ColumnHeader
          id="merchant"
          label="Merchant"
          type="text"
          distinctValues={distinctMerchants}
          filter={filters.merchant}
          sort={sort}
          onSort={handleSort}
          onTextFilter={handleTextFilter}
        />
        <ColumnHeader
          id="date"
          label="Date"
          type="text"
          distinctValues={distinctDates}
          filter={filters.date}
          sort={sort}
          onSort={handleSort}
          onTextFilter={handleTextFilter}
        />
        <ColumnHeader
          id="category"
          label="Category"
          type="text"
          distinctValues={distinctCategories}
          filter={filters.category}
          sort={sort}
          onSort={handleSort}
          onTextFilter={handleTextFilter}
        />
        <ColumnHeader
          id="account"
          label="Account"
          type="text"
          distinctValues={distinctAccounts}
          filter={filters.account}
          sort={sort}
          onSort={handleSort}
          onTextFilter={handleTextFilter}
        />
        <ColumnHeader
          id="status"
          label="Status"
          type="text"
          popoverAlign="right"
          distinctValues={distinctStatuses}
          filter={filters.status}
          sort={sort}
          onSort={handleSort}
          onTextFilter={handleTextFilter}
        />
        <ColumnHeader
          id="amount"
          label="Amount"
          type="number"
          align="right"
          popoverAlign="right"
          filter={filters.amount}
          sort={sort}
          onSort={handleSort}
          onNumberFilter={handleNumberFilter}
        />
      </div>

      {hasModifications ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.02] px-5 py-2 text-xs text-slate-400">
          <span>
            Showing {visibleTransactions.length} of {transactions.length} rows
            {filterCount > 0
              ? ` · ${filterCount} column ${filterCount === 1 ? "filter" : "filters"}`
              : ""}
            {sort
              ? ` · sorted by ${sort.column} ${sort.direction === "asc" ? "↑" : "↓"}`
              : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setSort(null);
              setFilters(INITIAL_FILTERS);
            }}
            className="rounded-md px-2 py-1 text-cyan-300 transition-colors hover:bg-white/5 hover:text-cyan-100"
          >
            Reset columns
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-b-[calc(1.5rem-1px)]">
        <div className="divide-y divide-white/6">
          {visibleTransactions.map((transaction, index) => (
            <motion.button
              key={transaction.transactionId}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 12) * 0.02, duration: 0.2 }}
              className={cn(
                "grid w-full grid-cols-[1.2fr_0.72fr_1fr_0.8fr_0.8fr_0.8fr] gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]",
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
              <div className="flex items-center text-sm text-slate-300">
                {formatTransactionDate(transaction.postedAt)}
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
          {visibleTransactions.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              No transactions match the current column filters.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ColumnHeaderBaseProps = {
  id: ColumnId;
  label: string;
  align?: "left" | "right";
  popoverAlign?: "left" | "right";
  sort: SortState;
  onSort: (column: ColumnId, direction: SortDirection) => void;
};

type TextColumnHeaderProps = ColumnHeaderBaseProps & {
  type: "text";
  distinctValues: string[];
  filter: TextFilterState;
  onTextFilter: (column: TextColumnId, value: TextFilterState) => void;
};

type NumberColumnHeaderProps = ColumnHeaderBaseProps & {
  type: "number";
  filter: NumberFilterState;
  onNumberFilter: (column: "amount", value: NumberFilterState) => void;
};

type ColumnHeaderProps = TextColumnHeaderProps | NumberColumnHeaderProps;

function ColumnHeader(props: ColumnHeaderProps) {
  const { id, label, type, sort, onSort } = props;
  const align = props.align ?? "left";
  const popoverAlign = props.popoverAlign ?? align;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const isSorted = sort?.column === id;
  const hasFilter =
    type === "text"
      ? props.filter.selectedValues !== null
      : props.filter.min !== "" || props.filter.max !== "";

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative",
        align === "right" ? "justify-self-end" : "justify-self-start",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-white/5 hover:text-slate-300",
          (isSorted || hasFilter) && "text-cyan-200",
        )}
      >
        <span>{label}</span>
        {isSorted ? (
          sort!.direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
        {hasFilter ? <ListFilter className="size-3" /> : null}
      </button>
      {open ? (
        <div
          role="dialog"
          className={cn(
            "absolute top-full z-30 mt-2 w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-3 text-left text-xs normal-case tracking-normal text-slate-200 shadow-2xl backdrop-blur",
            popoverAlign === "right" ? "right-0" : "left-0",
          )}
        >
          {type === "text" ? (
            <TextFilterPanel
              distinctValues={props.distinctValues}
              filter={props.filter}
              currentDirection={isSorted ? sort!.direction : null}
              formatValue={id === "date" ? formatTransactionDate : undefined}
              onSort={(direction) => {
                onSort(id, direction);
                setOpen(false);
              }}
              onApply={(value) => {
                props.onTextFilter(id as TextColumnId, value);
                setOpen(false);
              }}
              onClear={() => {
                props.onTextFilter(id as TextColumnId, EMPTY_TEXT);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          ) : (
            <NumberFilterPanel
              filter={props.filter}
              currentDirection={isSorted ? sort!.direction : null}
              onSort={(direction) => {
                onSort(id, direction);
                setOpen(false);
              }}
              onApply={(value) => {
                props.onNumberFilter("amount", value);
                setOpen(false);
              }}
              onClear={() => {
                props.onNumberFilter("amount", EMPTY_NUMBER);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

type SortRowProps = {
  current: SortDirection | null;
  onSort: (direction: SortDirection) => void;
  ascLabel: string;
  descLabel: string;
};

function SortRow({ current, onSort, ascLabel, descLabel }: SortRowProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onSort("asc")}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-white/10",
          current === "asc" && "border-cyan-300/40 bg-cyan-400/10 text-cyan-100",
        )}
      >
        <ArrowUp className="size-3" />
        {ascLabel}
      </button>
      <button
        type="button"
        onClick={() => onSort("desc")}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-white/10",
          current === "desc" && "border-cyan-300/40 bg-cyan-400/10 text-cyan-100",
        )}
      >
        <ArrowDown className="size-3" />
        {descLabel}
      </button>
    </div>
  );
}

function PanelActions({
  onClear,
  onCancel,
}: {
  onClear: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onClear}
        className="rounded-md px-2 py-1 text-xs text-slate-300 hover:text-white hover:underline"
      >
        Clear filter
      </button>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Apply
        </Button>
      </div>
    </div>
  );
}

type TextFilterPanelProps = {
  distinctValues: string[];
  filter: TextFilterState;
  currentDirection: SortDirection | null;
  formatValue?: (value: string) => string;
  onSort: (direction: SortDirection) => void;
  onApply: (value: TextFilterState) => void;
  onClear: () => void;
  onClose: () => void;
};

function TextFilterPanel({
  distinctValues,
  filter,
  currentDirection,
  formatValue,
  onSort,
  onApply,
  onClear,
  onClose,
}: TextFilterPanelProps) {
  const [draft, setDraft] = useState<TextFilterState>(filter);

  const visibleValues = useMemo(() => {
    const trimmed = draft.query.toLowerCase().trim();
    if (!trimmed) return distinctValues;
    return distinctValues.filter((value) =>
      value.toLowerCase().includes(trimmed),
    );
  }, [distinctValues, draft.query]);

  const allSelected = draft.selectedValues === null;
  const selectedSet = useMemo(
    () =>
      new Set(allSelected ? distinctValues : (draft.selectedValues as string[])),
    [allSelected, draft.selectedValues, distinctValues],
  );

  const toggleAll = () => {
    if (allSelected) {
      setDraft({ ...draft, selectedValues: [] });
    } else {
      setDraft({ ...draft, selectedValues: null });
    }
  };

  const toggleValue = (value: string) => {
    if (allSelected) {
      const next = distinctValues.filter((entry) => entry !== value);
      setDraft({ ...draft, selectedValues: next });
      return;
    }
    const set = new Set(draft.selectedValues as string[]);
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    if (set.size === distinctValues.length) {
      setDraft({ ...draft, selectedValues: null });
    } else {
      setDraft({
        ...draft,
        selectedValues: distinctValues.filter((entry) => set.has(entry)),
      });
    }
  };

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply(draft);
      }}
      className="space-y-3"
    >
      <SortRow
        current={currentDirection}
        onSort={onSort}
        ascLabel="Sort A → Z"
        descLabel="Sort Z → A"
      />
      <Input
        autoFocus
        placeholder="Search values"
        value={draft.query}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setDraft({ ...draft, query: event.target.value })
        }
        className="h-9"
      />
      <label className="flex cursor-pointer items-center gap-2 px-1 text-slate-200">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="size-4 rounded border-white/20 bg-slate-900 accent-cyan-400"
        />
        <span className="font-medium">(Select all)</span>
      </label>
      <div className="max-h-56 overflow-y-auto rounded-xl border border-white/5 bg-white/[0.02]">
        {visibleValues.length === 0 ? (
          <p className="px-3 py-6 text-center text-slate-400">No matches</p>
        ) : (
          visibleValues.map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-white/[0.04]"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(value)}
                onChange={() => toggleValue(value)}
                className="size-4 rounded border-white/20 bg-slate-900 accent-cyan-400"
              />
              <span className="truncate text-slate-100">
                {formatValue ? formatValue(value) : value}
              </span>
            </label>
          ))
        )}
      </div>
      <PanelActions onClear={onClear} onCancel={onClose} />
    </form>
  );
}

type NumberFilterPanelProps = {
  filter: NumberFilterState;
  currentDirection: SortDirection | null;
  onSort: (direction: SortDirection) => void;
  onApply: (value: NumberFilterState) => void;
  onClear: () => void;
  onClose: () => void;
};

function NumberFilterPanel({
  filter,
  currentDirection,
  onSort,
  onApply,
  onClear,
  onClose,
}: NumberFilterPanelProps) {
  const [draft, setDraft] = useState<NumberFilterState>(filter);

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onApply(draft);
      }}
      className="space-y-3"
    >
      <SortRow
        current={currentDirection}
        onSort={onSort}
        ascLabel="Smallest → Largest"
        descLabel="Largest → Smallest"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Min
          </label>
          <Input
            inputMode="decimal"
            placeholder="-1000"
            value={draft.min}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setDraft({ ...draft, min: event.target.value })
            }
            className="h-9"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Max
          </label>
          <Input
            inputMode="decimal"
            placeholder="1000"
            value={draft.max}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setDraft({ ...draft, max: event.target.value })
            }
            className="h-9"
          />
        </div>
      </div>
      <p className="px-1 text-[11px] text-slate-500">
        Range applies to the signed amount; expenses are negative.
      </p>
      <PanelActions onClear={onClear} onCancel={onClose} />
    </form>
  );
}
