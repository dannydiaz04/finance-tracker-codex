import type { PortalAdapter } from "../lib/types.ts";

import { exportNotImplemented, openLoginPage } from "./common.ts";

const ADAPTER_PATH = "scripts/backfill/portals/discover.ts";

export const discoverAdapter: PortalAdapter = {
  definition: {
    id: "discover",
    label: "Discover Card",
    filePrefix: "discover-",
    loginUrl: "https://portal.discover.com/",
    allowedHostPatterns: [/(^|\.)discover\.com$/i],
    credentialEnvKeys: {
      user: "BACKFILL_DISCOVER_USER",
      pass: "BACKFILL_DISCOVER_PASS",
    },
  },

  async runExport(ctx) {
    await openLoginPage(ctx, this.definition.loginUrl);

    // TODO: Activity & Payments → All Available → Download
    // Mask 7788 (CSV) vs 1107 (Plaid) — confirm which card this login serves.

    await exportNotImplemented(ctx, this.definition.label, ADAPTER_PATH);
  },
};
