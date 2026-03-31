export type CsvColumnMapping = {
  postedAt: string;
  description: string;
  amount: string;
  merchant?: string;
  accountName?: string;
  accountId?: string;
  institutionCategory?: string;
  pending?: string;
};

const candidateColumns: Record<keyof CsvColumnMapping, string[]> = {
  postedAt: ["date", "posted_at", "posted date", "transaction date"],
  description: ["description", "memo", "details", "narrative"],
  amount: ["amount", "signed_amount", "transaction amount"],
  merchant: ["merchant", "payee", "name"],
  accountName: ["account", "account_name"],
  accountId: ["account_id", "accountid"],
  institutionCategory: ["category", "institution_category"],
  pending: ["pending", "is_pending"],
};

function matchColumn(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers.map((header) => header.toLowerCase().trim());
  const index = normalizedHeaders.findIndex((header) => aliases.includes(header));

  if (index === -1) {
    return undefined;
  }

  return headers[index];
}

export function inferCsvColumnMapping(headers: string[]) {
  const mapping: Partial<CsvColumnMapping> = {};

  for (const [field, aliases] of Object.entries(candidateColumns) as Array<
    [keyof CsvColumnMapping, string[]]
  >) {
    mapping[field] = matchColumn(headers, aliases);
  }

  if (!mapping.postedAt || !mapping.description || !mapping.amount) {
    throw new Error(
      "CSV file must include columns for date, description, and amount.",
    );
  }

  return mapping as CsvColumnMapping;
}
