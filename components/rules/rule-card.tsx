"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Category, Rule } from "@/lib/types/finance";

type RuleCardProps = {
  rule: Rule;
  categories: Category[];
};

type RuleDraft = {
  name: string;
  description: string;
  priority: string;
  categoryId: string;
  matchStrategy: Rule["matchStrategy"];
  matchValue: string;
};

type RuleUpdateResponse = {
  persisted?: boolean;
  rule?: Rule;
  guardrailNote?: string | null;
  error?: string;
};

function toDraft(rule: Rule): RuleDraft {
  return {
    name: rule.name,
    description: rule.description,
    priority: String(rule.priority),
    categoryId: rule.categoryId,
    matchStrategy: rule.matchStrategy,
    matchValue: rule.matchValue,
  };
}

export function RuleCard({ rule, categories }: RuleCardProps) {
  const router = useRouter();
  const [currentRule, setCurrentRule] = useState(rule);
  const [draft, setDraft] = useState(() => toDraft(rule));
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const currentSubcategory = categories.find(
    (category) => category.id === currentRule.categoryId,
  );

  const openEditor = () => {
    setDraft(toDraft(currentRule));
    setResult(null);
    setEditing(true);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const priority = Number(draft.priority);
    if (!Number.isInteger(priority) || priority < 1) {
      setResult({ tone: "error", message: "Priority must be a positive whole number." });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const response = await fetch("/api/rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ruleId: currentRule.id,
          ...draft,
          priority,
        }),
      });
      const payload = (await response.json().catch(() => null)) as RuleUpdateResponse | null;

      if (!response.ok || !payload?.rule) {
        setResult({
          tone: "error",
          message: payload?.error ?? "Unable to update this rule.",
        });
        return;
      }

      setCurrentRule(payload.rule);
      setDraft(toDraft(payload.rule));
      setEditing(false);
      setResult({
        tone: "success",
        message:
          payload.persisted === false
            ? "Updated locally — connect a warehouse to persist this rule."
            : [
                "Rule updated. Matching transactions are refreshing in the background.",
                payload.guardrailNote,
              ]
                .filter(Boolean)
                .join(" "),
      });
      router.refresh();
    });
  };

  return (
    <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/[0.03] px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <p className="font-medium text-white">{currentRule.name}</p>
            <Badge className="border-emerald-500/40 text-emerald-400">Active</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">{currentRule.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge>priority {currentRule.priority}</Badge>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={openEditor}
            disabled={editing || isPending}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-4 grid gap-3 border-t border-border pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-400">
              Rule name
              <Input
                value={draft.name}
                onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                required
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Priority
              <Input
                type="number"
                min={1}
                step={1}
                value={draft.priority}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, priority: event.target.value }))
                }
                required
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs text-slate-400">
            Description
            <Input
              value={draft.description}
              onChange={(event) =>
                setDraft((value) => ({ ...value, description: event.target.value }))
              }
              required
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-400">
              Subcategory
              <Select
                value={draft.categoryId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, categoryId: event.target.value }))
                }
                required
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.group} — {category.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Match strategy
              <Select
                value={draft.matchStrategy}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    matchStrategy: event.target.value as Rule["matchStrategy"],
                  }))
                }
              >
                <option value="merchant_exact">Merchant exactly matches</option>
                <option value="merchant_contains">Merchant contains</option>
                <option value="description_regex">Description regex</option>
              </Select>
            </label>
          </div>

          <label className="grid gap-1 text-xs text-slate-400">
            Match value
            <Input
              value={draft.matchValue}
              onChange={(event) =>
                setDraft((value) => ({ ...value, matchValue: event.target.value }))
              }
              required
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setDraft(toDraft(currentRule));
                setEditing(false);
                setResult(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 grid gap-2 text-sm text-slate-300 md:grid-cols-3">
          <p>
            Subcategory:{" "}
            {currentSubcategory
              ? `${currentSubcategory.group} — ${currentSubcategory.label}`
              : currentRule.categoryLabel}
          </p>
          <p>Strategy: {currentRule.matchStrategy.replaceAll("_", " ")}</p>
          <p>Hit rate: {(currentRule.hitRate * 100).toFixed(0)}%</p>
          <p className="break-words md:col-span-3">
            Match value: <span className="font-mono text-slate-400">{currentRule.matchValue}</span>
          </p>
        </div>
      )}

      {result ? (
        <p
          className={
            result.tone === "success"
              ? "mt-3 text-xs text-emerald-400"
              : "mt-3 text-xs text-red-400"
          }
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
