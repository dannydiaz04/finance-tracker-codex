import { Landmark, ShieldAlert, Workflow } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlaidDisconnectButton } from "@/components/plaid/plaid-disconnect-button";
import { PlaidLinkButton } from "@/components/plaid/plaid-link-button";
import { PlaidSyncButton } from "@/components/plaid/plaid-sync-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isBigQueryConfigured } from "@/lib/bigquery/client";
import { getCurrentUserId } from "@/lib/auth/session";
import { getAccounts } from "@/lib/queries/catalog";
import { getPlaidStatus } from "@/lib/plaid/client";
import { listPlaidItemsByUser } from "@/lib/plaid/items";

export const dynamic = "force-dynamic";

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Never";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function normalizeInstitution(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export default async function ConnectionsPage() {
  const plaidStatus = getPlaidStatus();
  const bigQueryConfigured = isBigQueryConfigured();
  const userId = await getCurrentUserId();
  const items = bigQueryConfigured && userId
    ? await listPlaidItemsByUser(userId)
    : [];
  const accounts = userId ? await getAccounts() : [];
  const plaidInstitutionNames = new Set(
    items
      .map((item) => normalizeInstitution(item.institutionName))
      .filter(Boolean),
  );
  const plaidAccounts = accounts.filter((account) => {
    const institution = normalizeInstitution(account.institution);

    return institution === "plaid" || plaidInstitutionNames.has(institution);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Connections"
        title="Link bank and credit card accounts with Plaid."
        description="Connect an institution once and the app pulls transactions via Plaid's sync API into the same warehouse event model that powers CSV imports."
        action={plaidStatus.configured ? <PlaidLinkButton /> : undefined}
      />

      {!plaidStatus.configured ? (
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <ShieldAlert className="size-5 text-amber-300" />
            <CardTitle>Plaid is not configured yet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-300">
            <p>
              Add Plaid credentials to your environment to enable account linking.
              CSV import remains fully available in the meantime.
            </p>
            <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs text-slate-200">
              {`PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox
PLAID_WEBHOOK_URL=https://your-tunnel/api/plaid/webhook`}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {plaidStatus.configured && !bigQueryConfigured ? (
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <ShieldAlert className="size-5 text-amber-300" />
            <CardTitle>BigQuery is required to store connections</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            Set <code className="text-cyan-200">BIGQUERY_PROJECT_ID</code> so linked
            Plaid Items and their sync cursors can be persisted.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Landmark className="size-5 text-cyan-300" />
            <CardTitle>Connected institutions</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            <Badge>
              {plaidStatus.env} {plaidStatus.configured ? "ready" : "off"}
            </Badge>
            <Badge
              className={
                plaidStatus.hasWebhook
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-200"
              }
            >
              {plaidStatus.hasWebhook ? "Auto-sync on" : "Auto-sync off"}
            </Badge>
            {items.length > 0 ? <PlaidSyncButton label="Sync all" /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No institutions connected yet. Use “Connect a bank” to link your
              first account.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.itemId}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">
                      {item.institutionName ?? "Connected institution"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Item {item.itemId}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge
                        className={
                          item.status === "error"
                            ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
                            : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                        }
                      >
                        {item.status ?? "active"}
                      </Badge>
                      <Badge>Last sync: {formatTimestamp(item.lastSyncedAt)}</Badge>
                    </div>
                    {item.error ? (
                      <p className="mt-2 text-sm text-rose-300">{item.error}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <PlaidSyncButton itemId={item.itemId} />
                    <PlaidDisconnectButton
                      itemId={item.itemId}
                      institutionName={item.institutionName}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <Landmark className="size-5 text-cyan-300" />
          <CardTitle>Plaid-linked accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {plaidAccounts.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              No Plaid-sourced accounts have been synced into the warehouse yet for
              your connections. Use “Sync now” on a connection above (or wait for the
              webhook), then run <code>npx dataform run dataform</code> to refresh the
              marts so masks, balances, and accounts appear here and on the Overview.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {plaidAccounts.map((account) => (
                <div
                  key={account.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{account.name}</p>
                      <p className="text-xs text-slate-500">
                        {account.institution} · {account.type}
                        {account.subtype ? ` · ${account.subtype}` : ""}
                      </p>
                    </div>
                    {account.mask && account.mask !== "unknown" ? (
                      <Badge className="border-white/20 bg-white/5 font-mono text-xs text-slate-200">
                        •••• {account.mask}
                      </Badge>
                    ) : (
                      <Badge className="border-white/10 bg-white/5 text-xs text-slate-400">
                        no mask
                      </Badge>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-slate-400">Current</span>
                      <div className="font-medium text-white">
                        {account.currentBalance != null
                          ? new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency: account.currency || "USD",
                            }).format(Number(account.currentBalance))
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Available</span>
                      <div className="font-medium text-white">
                        {account.availableBalance != null
                          ? new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency: account.currency || "USD",
                            }).format(Number(account.availableBalance))
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-500">
                    Account ID: {account.id}
                  </p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">
            These accounts (and their masks / account identifiers) come from Plaid’s
            AccountBase responses during <code>/transactions/sync</code>, stored in
            <code className="mx-1">ops_finance.account_metadata</code>, and projected
            through <code>stg_finance.accounts_clean</code> → <code>core_finance.dim_account</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <Workflow className="size-5 text-cyan-300" />
          <CardTitle>How Plaid sync flows through the warehouse</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          <p>
            1. Plaid Link returns a public token, which is exchanged for a durable
            access token stored in{" "}
            <code className="text-cyan-200">ops_finance.plaid_items</code>.
          </p>
          <p>
            2. <code className="text-cyan-200">/transactions/sync</code> pulls
            added, modified, and removed transactions using a per-item cursor.
          </p>
          <p>
            3. Each change is written to{" "}
            <code className="text-cyan-200">raw_finance.transaction_events</code>{" "}
            with <code className="text-cyan-200">source_name = &quot;plaid&quot;</code>,
            reusing the exact normalization the CSV path uses.
          </p>
          <p>
            4. Account balances from Plaid are stored on each account and shown on
            the Overview.
          </p>
          <p>
            5. With <code className="text-cyan-200">PLAID_WEBHOOK_URL</code> set,
            Plaid pushes <code className="text-cyan-200">SYNC_UPDATES_AVAILABLE</code>{" "}
            and the app auto-syncs; otherwise use “Sync now”.
          </p>
          <p>
            6. Run <code className="text-cyan-200">npx dataform run dataform</code>{" "}
            to refresh the marts so the dashboards reflect the new transactions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
