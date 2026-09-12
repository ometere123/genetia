/**
 * Unit tests for the pure functions in resolution-manifest.ts.
 *
 * These have no side-effects and need no mocks — just deterministic hashing
 * and JSON canonicalization logic.
 */

import {
  buildResolutionManifest,
  canonicalStringify,
  extractTrustedSources,
  hashResolutionManifestString,
  hashResolutionManifest,
  GENETIA_PROMPT_VERSION,
  GENETIA_MANIFEST_VERSION,
  type ManifestMarketInput,
} from "../resolution-manifest";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_MARKET: ManifestMarketInput = {
  id: "cm-test-market-001",
  title: "Will Argentina win the 2026 FIFA World Cup?",
  expiry: new Date("2026-07-19T20:00:00.000Z"),
  arcAddress: "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef",
  resolutionCriteria:
    "Resolves YES if Argentina wins the 2026 FIFA World Cup final.",
  resolutionSource:
    "https://www.fifa.com/2026\nhttps://www.espn.com/soccer/worldcup2026",
};

// ── canonicalStringify ────────────────────────────────────────────────────────

describe("canonicalStringify", () => {
  it("produces identical output regardless of key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { m: 3, z: 1, a: 2 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("sorts nested object keys recursively", () => {
    const obj = { outer: { z: "last", a: "first" } };
    const json = canonicalStringify(obj);
    const parsed = JSON.parse(json) as Record<string, Record<string, string>>;
    const keys = Object.keys(parsed.outer);
    expect(keys).toEqual(["a", "z"]);
  });

  it("preserves array order (arrays are not sorted)", () => {
    const obj = { items: ["c", "a", "b"] };
    const parsed = JSON.parse(canonicalStringify(obj)) as { items: string[] };
    expect(parsed.items).toEqual(["c", "a", "b"]);
  });
});

// ── hashResolutionManifestString ──────────────────────────────────────────────

describe("hashResolutionManifestString", () => {
  it("produces a sha256: prefixed hex digest", () => {
    const hash = hashResolutionManifestString('{"test":1}');
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is deterministic — same input always gives same hash", () => {
    const input = canonicalStringify(buildResolutionManifest(BASE_MARKET));
    expect(hashResolutionManifestString(input)).toBe(
      hashResolutionManifestString(input),
    );
  });

  it("different inputs produce different hashes", () => {
    expect(hashResolutionManifestString("aaa")).not.toBe(
      hashResolutionManifestString("bbb"),
    );
  });
});

// ── buildResolutionManifest ───────────────────────────────────────────────────

describe("buildResolutionManifest", () => {
  it("includes all required fields", () => {
    const m = buildResolutionManifest(BASE_MARKET);
    expect(m.market_id).toBe(BASE_MARKET.id);
    expect(m.arc_market_address).toBe(BASE_MARKET.arcAddress);
    expect(m.question).toBe(BASE_MARKET.title.trim());
    expect(m.resolution_rule).toBe(BASE_MARKET.resolutionCriteria!.trim());
    expect(m.close_time).toBe(BASE_MARKET.expiry.toISOString());
    expect(m.resolution_available_time).toBe(BASE_MARKET.expiry.toISOString());
    expect(m.prompt_version).toBe(GENETIA_PROMPT_VERSION);
    expect(m.manifest_version).toBe(GENETIA_MANIFEST_VERSION);
  });

  it("extracts trusted sources from newline-delimited string", () => {
    const m = buildResolutionManifest(BASE_MARKET);
    expect(m.trusted_sources).toContain("https://www.fifa.com/2026");
    expect(m.trusted_sources).toContain("https://www.espn.com/soccer/worldcup2026");
  });

  it("falls back to title as resolution_rule when criteria is null", () => {
    const m = buildResolutionManifest({ ...BASE_MARKET, resolutionCriteria: null });
    expect(m.resolution_rule).toBe(BASE_MARKET.title.trim());
  });

  it("uses empty string for arc_market_address when arcAddress is null", () => {
    const m = buildResolutionManifest({ ...BASE_MARKET, arcAddress: null });
    expect(m.arc_market_address).toBe("");
  });

  it("produces deterministic canonical JSON", () => {
    const jsonA = canonicalStringify(buildResolutionManifest(BASE_MARKET));
    const jsonB = canonicalStringify(buildResolutionManifest({ ...BASE_MARKET }));
    expect(jsonA).toBe(jsonB);
  });

  it("produces a different hash when any field changes", () => {
    const hashA = hashResolutionManifest(buildResolutionManifest(BASE_MARKET));
    const hashB = hashResolutionManifest(
      buildResolutionManifest({ ...BASE_MARKET, title: "Will Brazil win?" }),
    );
    expect(hashA).not.toBe(hashB);
  });
});

// ── extractTrustedSources ─────────────────────────────────────────────────────

describe("extractTrustedSources", () => {
  it("returns empty array for null", () => {
    expect(extractTrustedSources(null)).toEqual([]);
  });

  it("parses JSON array of URLs", () => {
    const raw = JSON.stringify([
      "https://example.com",
      "https://other.org",
    ]);
    const result = extractTrustedSources(raw);
    expect(result).toEqual(["https://example.com", "https://other.org"]);
  });

  it("splits on newlines", () => {
    const result = extractTrustedSources(
      "https://a.com\nhttps://b.com\nhttps://c.com",
    );
    expect(result).toEqual(["https://a.com", "https://b.com", "https://c.com"]);
  });

  it("filters out non-http strings", () => {
    const result = extractTrustedSources("not-a-url\nhttps://valid.com");
    expect(result).toEqual(["https://valid.com"]);
  });

  it("limits to 8 sources", () => {
    const many = Array.from(
      { length: 12 },
      (_, i) => `https://source${i}.com`,
    ).join("\n");
    expect(extractTrustedSources(many)).toHaveLength(8);
  });
});
