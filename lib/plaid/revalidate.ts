import "server-only";

import { revalidatePath } from "next/cache";

const PLAID_DEPENDENT_PATHS = [
  "/overview",
  "/transactions",
  "/cashflow",
  "/categories",
  "/merchants",
  "/rules",
  "/connections",
] as const;

export function revalidatePlaidDependentViews() {
  revalidatePath("/(dashboard)", "layout");

  for (const path of PLAID_DEPENDENT_PATHS) {
    revalidatePath(path);
  }
}
