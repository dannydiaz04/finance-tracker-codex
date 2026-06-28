import type { PortalAdapter } from "../lib/types.ts";

import { exportNotImplemented, openLoginPage } from "./common.ts";

const ADAPTER_PATH = "scripts/backfill/portals/chase.ts";

export const chaseAdapter: PortalAdapter = {
  definition: {
    id: "chase",
    label: "Chase Card 1325",
    filePrefix: "chase-",
    loginUrl: "https://www.chase.com/",
    allowedHostPatterns: [/(^|\.)chase\.com$/i],
    credentialEnvKeys: {
      user: "BACKFILL_CHASE_USER",
      pass: "BACKFILL_CHASE_PASS",
    },
  },

  async runExport(ctx) {
    await openLoginPage(ctx, this.definition.loginUrl);

    // TODO: Sign in → Credit Card (...1325) → Activity → Download (.csv)
    // await submitCredentials(ctx, { username: "...", password: "...", submit: "..." });
    // await ctx.waitForMfa();

    await exportNotImplemented(ctx, this.definition.label, ADAPTER_PATH);
  },
};
