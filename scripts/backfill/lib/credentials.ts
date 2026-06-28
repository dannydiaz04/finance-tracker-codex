import type { PortalCredentials, PortalDefinition } from "./types.ts";

export function loadPortalCredentials(
  definition: PortalDefinition,
): PortalCredentials {
  const username = process.env[definition.credentialEnvKeys.user]?.trim();
  const password = process.env[definition.credentialEnvKeys.pass]?.trim();

  if (!username || !password) {
    throw new Error(
      `Missing credentials. Set ${definition.credentialEnvKeys.user} and ${definition.credentialEnvKeys.pass} in .env.local`,
    );
  }

  return { username, password };
}

export function validateChunkDates(startDate: string, endDate: string): void {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
    throw new Error("Dates must use YYYY-MM-DD format.");
  }

  if (startDate > endDate) {
    throw new Error(`start date (${startDate}) must be on or before end date (${endDate}).`);
  }
}
