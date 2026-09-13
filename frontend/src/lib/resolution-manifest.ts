import "server-only";

import { createHash } from "node:crypto";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");

export const GENETIA_PROMPT_VERSION = "genetia-resolver-v2";
export const GENETIA_MANIFEST_VERSION = "1";

export type ResolutionManifest = {
  market_id: string;
  arc_market_address: string;
  arc_chain_id: number;
  question: string;
  yes_meaning: string;
  no_meaning: string;
  resolution_rule: string;
  trusted_sources: string[];
  void_conditions: string[];
  close_time: string;
  resolution_available_time: string;
  prompt_version: string;
  manifest_version: string;
};

export type ManifestMarketInput = {
  id: string;
  title: string;
  expiry: Date;
  arcAddress: string | null;
  resolutionCriteria: string | null;
  resolutionSource: string | null;
};

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, stableSort(inner)]),
    );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

export function hashResolutionManifestString(manifestJson: string): string {
  return `sha256:${createHash("sha256").update(manifestJson).digest("hex")}`;
}

export function hashResolutionManifest(manifest: ResolutionManifest): string {
  return hashResolutionManifestString(canonicalStringify(manifest));
}

export function extractTrustedSources(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  const filterHttp = (items: unknown[]) =>
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => /^https?:\/\/[^\s]+$/i.test(item))
      .slice(0, 8);

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return filterHttp(parsed);
      }
    } catch {
      // Fall through to delimiter splitting.
    }
  }

  return filterHttp(trimmed.split(/[\n,]+/));
}

export function buildResolutionManifest(market: ManifestMarketInput): ResolutionManifest {
  const trustedSources = extractTrustedSources(market.resolutionSource);

  return {
    market_id: market.id,
    arc_market_address: String(market.arcAddress ?? "").trim(),
    arc_chain_id: ARC_CHAIN_ID,
    question: market.title.trim(),
    yes_meaning: "YES means the market question resolves in the affirmative under the resolution rule.",
    no_meaning: "NO means the market question does not resolve in the affirmative under the resolution rule.",
    resolution_rule: String(market.resolutionCriteria ?? market.title).trim(),
    trusted_sources: trustedSources,
    void_conditions: [
      "Void if the trusted sources are unavailable, contradictory, or insufficient for a fair resolution.",
      "Void if the market question or resolution rule is malformed such that neither YES nor NO can be determined fairly.",
    ],
    close_time: market.expiry.toISOString(),
    resolution_available_time: market.expiry.toISOString(),
    prompt_version: GENETIA_PROMPT_VERSION,
    manifest_version: GENETIA_MANIFEST_VERSION,
  };
}
