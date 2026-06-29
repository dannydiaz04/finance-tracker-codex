import type { Account, PrimaryCheckingBalance } from "@/lib/types/finance";

export type AccountBalanceTotals = {
  /** Net worth: liquid cash minus credit-card debt. */
  totalBalance: number;
  /** Liquid current balances on non-credit accounts. */
  availableCash: number;
  /** Unused credit limit across credit-card accounts. */
  availableCredit: number;
  /** Outstanding balance owed across credit-card accounts. */
  debtTotal: number;
  /** Money available to spend: available cash plus available credit. */
  spendingPower: number;
};

function normalizeInstitution(value: string) {
  return value.trim().toLowerCase();
}

function normalizeLogicalAccountPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getLogicalAccountKey(account: Account) {
  return [
    normalizeLogicalAccountPart(account.institution),
    normalizeLogicalAccountPart(account.name),
    account.type,
    normalizeLogicalAccountPart(account.mask || "unknown"),
  ].join("::");
}

function getAccountCompletenessScore(account: Account) {
  return [
    account.institution && account.institution !== "Unknown",
    account.name && account.name !== account.id,
    account.mask && account.mask !== "unknown",
    account.availableBalance !== 0,
    account.currentBalance !== 0,
  ].filter(Boolean).length;
}

function preferAccount(left: Account, right: Account) {
  const leftScore = getAccountCompletenessScore(left);
  const rightScore = getAccountCompletenessScore(right);

  if (leftScore !== rightScore) {
    return rightScore > leftScore ? right : left;
  }

  return right.name.localeCompare(left.name) < 0 ? right : left;
}

export function dedupeAccountsByLogicalIdentity(accounts: Account[]) {
  const byLogicalAccount = new Map<string, Account>();

  for (const account of accounts) {
    const key = getLogicalAccountKey(account);
    const existing = byLogicalAccount.get(key);

    byLogicalAccount.set(
      key,
      existing ? preferAccount(existing, account) : account,
    );
  }

  return [...byLogicalAccount.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/** Capital One checking — the live balance shown in the bank app, not transaction net flow. */
export function resolveCapitalOneCheckingAccount(
  accounts: Account[],
): Account | null {
  const matches = dedupeAccountsByLogicalIdentity(accounts).filter((account) => {
    const institution = normalizeInstitution(account.institution);
    const isCapitalOne =
      institution.includes("capital one") || institution === "capitalone";

    return isCapitalOne && account.type === "checking";
  });

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  return (
    matches.find((account) => account.name.toLowerCase().includes("360")) ??
    matches[0]
  );
}

export function resolvePrimaryCheckingBalance(
  accounts: Account[],
): PrimaryCheckingBalance | null {
  const account = resolveCapitalOneCheckingAccount(accounts);

  if (!account) {
    return null;
  }

  return {
    accountId: account.id,
    accountName: account.name,
    institution: account.institution,
    mask: account.mask,
    currentBalance: account.currentBalance,
    availableBalance: account.availableBalance,
  };
}

/** Sum Plaid/warehouse account balances — not transaction-derived net flow. */
export function deriveBalanceTotalsFromAccounts(
  accounts: Account[],
  accountIds?: string[],
): AccountBalanceTotals {
  const scoped = dedupeAccountsByLogicalIdentity(
    accountIds && accountIds.length > 0
      ? accounts.filter((account) => accountIds.includes(account.id))
      : accounts,
  );

  const cashAccounts = scoped.filter((account) => account.type !== "credit");
  const creditAccounts = scoped.filter((account) => account.type === "credit");

  // Credit-card current balance is money owed, not money available.
  const availableCash = cashAccounts.reduce(
    (sum, account) => sum + (account.availableBalance ?? account.currentBalance),
    0,
  );
  const cashCurrent = cashAccounts.reduce(
    (sum, account) => sum + account.currentBalance,
    0,
  );
  const availableCredit = creditAccounts.reduce(
    (sum, account) => sum + (account.availableBalance ?? 0),
    0,
  );
  const debtTotal = creditAccounts.reduce(
    (sum, account) => sum + account.currentBalance,
    0,
  );

  return {
    totalBalance: cashCurrent - debtTotal,
    availableCash,
    availableCredit,
    debtTotal,
    spendingPower: availableCash + availableCredit,
  };
}
