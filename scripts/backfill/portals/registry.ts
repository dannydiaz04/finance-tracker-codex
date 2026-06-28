import type { PortalAdapter, PortalId } from "../lib/types.ts";

import { amexAdapter } from "./amex.ts";
import { appleCardAdapter } from "./apple-card.ts";
import { capitalOneAdapter } from "./capital-one.ts";
import { chaseAdapter } from "./chase.ts";
import { discoverAdapter } from "./discover.ts";
import { microCenterAdapter } from "./micro-center.ts";

const PORTAL_ADAPTERS: Record<PortalId, PortalAdapter> = {
  apple_card: appleCardAdapter,
  capital_one: capitalOneAdapter,
  chase: chaseAdapter,
  discover: discoverAdapter,
  american_express: amexAdapter,
  micro_center: microCenterAdapter,
};

export function getPortalAdapter(portalId: PortalId): PortalAdapter {
  const adapter = PORTAL_ADAPTERS[portalId];
  if (!adapter) {
    throw new Error(`Unknown portal: ${portalId}`);
  }
  return adapter;
}

export function listPortals(): PortalAdapter[] {
  return Object.values(PORTAL_ADAPTERS);
}

export function parsePortalId(value: string): PortalId {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");

  if (normalized in PORTAL_ADAPTERS) {
    return normalized as PortalId;
  }

  const aliases: Record<string, PortalId> = {
    apple: "apple_card",
    amex: "american_express",
    capitalone: "capital_one",
    microcenter: "micro_center",
  };

  const alias = aliases[normalized];
  if (alias) {
    return alias;
  }

  throw new Error(
    `Unknown portal "${value}". Choose one of: ${Object.keys(PORTAL_ADAPTERS).join(", ")}`,
  );
}
