import "server-only";

import {
  Configuration,
  CountryCode,
  type PlaidApi as PlaidApiType,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

let plaidClient: PlaidApi | null | undefined;

export type PlaidEnvName = keyof typeof PlaidEnvironments;

function readEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function resolvePlaidEnv(): PlaidEnvName {
  const configured = readEnvValue("PLAID_ENV")?.toLowerCase();

  if (configured && configured in PlaidEnvironments) {
    return configured as PlaidEnvName;
  }

  // Plaid removed the standalone "development" environment; default to sandbox.
  return "sandbox";
}

export function getPlaidConfig() {
  return {
    clientId: readEnvValue("PLAID_CLIENT_ID"),
    secret: readEnvValue("PLAID_SECRET"),
    env: resolvePlaidEnv(),
    webhookUrl: readEnvValue("PLAID_WEBHOOK_URL"),
    redirectUri: readEnvValue("PLAID_REDIRECT_URI"),
  };
}

export function getPlaidStatus() {
  const { clientId, secret, env, webhookUrl, redirectUri } = getPlaidConfig();
  const configured = Boolean(clientId && secret);

  return {
    configured,
    env,
    hasWebhook: Boolean(webhookUrl),
    hasRedirectUri: Boolean(redirectUri),
    reason: configured
      ? null
      : "PLAID_CLIENT_ID and/or PLAID_SECRET are missing. CSV import remains available.",
  };
}

export function getPlaidClient() {
  if (typeof plaidClient !== "undefined") {
    return plaidClient;
  }

  const { clientId, secret, env } = getPlaidConfig();

  if (!clientId || !secret) {
    plaidClient = null;
    return plaidClient;
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  plaidClient = new PlaidApi(configuration);
  return plaidClient;
}

export function isPlaidConfigured() {
  return Boolean(getPlaidClient());
}

// Country/products configuration for the Link token. Transactions is the only
// product this app consumes today.
export const PLAID_PRODUCTS: Products[] = [Products.Transactions];
export const PLAID_COUNTRY_CODES: CountryCode[] = [CountryCode.Us];

// Plaid only honors `transactions.days_requested` when Transactions is first
// added to an Item (i.e. at `/link/token/create`); it cannot be changed later.
// Request the maximum (730 days) so new connections backfill as much history as
// the institution will provide. Existing Items must be removed and re-linked to
// pick up a larger window — see lib/plaid/remove.ts and the exchange route.
export const PLAID_TRANSACTIONS_DAYS_REQUESTED = 730;

export function extractPlaidErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "response" in error) {
    const data = (
      error as {
        response?: {
          data?: { error_message?: string; error_code?: string };
        };
      }
    ).response?.data;

    if (data?.error_message) {
      return `${data.error_code ?? "PLAID_ERROR"}: ${data.error_message}`;
    }
  }

  return error instanceof Error ? error.message : "Plaid request failed.";
}

export async function resolveInstitutionName(
  client: PlaidApiType,
  institutionId: string | null | undefined,
) {
  if (!institutionId) {
    return null;
  }

  try {
    const response = await client.institutionsGetById({
      institution_id: institutionId,
      country_codes: PLAID_COUNTRY_CODES,
    });

    return response.data.institution.name ?? null;
  } catch {
    return null;
  }
}
