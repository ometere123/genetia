/**
 * E2E integration test for the manifest-bound resolver pipeline.
 *
 * Proves the trust story the submission requires:
 *   market → manifest built → manifest_hash computed → register_market →
 *   resolve_market → get_resolution → manifest_hash verified →
 *   YES/NO settles Arc │ VOID blocks │ UNRESOLVED/INVALID retries │
 *   manifest_mismatch never touches Arc
 *
 * All I/O is mocked; the resolution + validation logic runs for real.
 */

// ── Module mocks (Jest hoists these above imports) ────────────────────────────

jest.mock("server-only", () => ({}));

jest.mock("@/lib/db", () => ({
  prisma: {
    market: { findMany: jest.fn() },
    settlement: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock("@/lib/genlayer", () => ({
  getRegisteredMarket: jest.fn(),
  registerMarket: jest.fn(),
  resolveMarket: jest.fn(),
  getResolution: jest.fn(),
  getResolutionStatus: jest.fn(),
}));

jest.mock("@/lib/lmsr-abi", () => ({
  LMSR_MARKET_ABI: [],
  OUTCOME: { NO: 1, YES: 2, INVALID: 3 },
}));

// Intercept the dynamic require("viem") inside arcWriteContract.
const mockWriteContract = jest.fn();
const mockReadContract = jest.fn();
jest.mock("viem", () => ({
  createWalletClient: jest.fn().mockReturnValue({ writeContract: mockWriteContract }),
  createPublicClient: jest.fn().mockReturnValue({ readContract: mockReadContract }),
  http: jest.fn().mockReturnValue({}),
}));
jest.mock("viem/accounts", () => ({
  privateKeyToAccount: jest.fn().mockReturnValue({ address: "0xrelayer" }),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { runResolverTick } from "../resolver-pipeline";
import * as genlayer from "@/lib/genlayer";
import { prisma } from "@/lib/db";
import {
  buildResolutionManifest,
  canonicalStringify,
  hashResolutionManifestString,
} from "../resolution-manifest";
import type { GenLayerVerdict } from "@/lib/genlayer";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const MARKET_ID = "test-market-pipeline-001";
const ARC_ADDRESS = "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef";

/** The market data stored in the DB — exactly what the pipeline reads. */
const MOCK_MARKET = {
  id: MARKET_ID,
  title: "Will Argentina win the 2026 FIFA World Cup?",
  resolutionCriteria: "Resolves YES if Argentina wins the 2026 FIFA World Cup final.",
  resolutionSource: "https://www.fifa.com/2026",
  arcAddress: ARC_ADDRESS,
  status: "active",
  expiry: new Date("2026-07-19T20:00:00.000Z"),
  lmsrStatus: null,
  proposedOutcome: null,
  pendingSince: null,
};

/** Pre-compute the manifest hash the pipeline will produce for this market. */
const EXPECTED_MANIFEST_HASH = hashResolutionManifestString(
  canonicalStringify(buildResolutionManifest(MOCK_MARKET)),
);

/** A settlement row in pending_resolve state. */
const MOCK_SETTLEMENT = {
  id: "settlement-test-001",
  marketId: MARKET_ID,
  status: "pending_resolve",
  sources: {
    trustedSources: ["https://www.fifa.com/2026"],
    attemptStatus: "READY_TO_RESOLVE",
  },
  arcTxHash: null,
  genlayerTxHash: null,
  resolution: null,
  reasoning: null,
  confidence: null,
  requestedAt: new Date(),
  submittedAt: null,
  finalizedAt: null,
  arcResolvedAt: null,
  settledAt: new Date(),
  market: MOCK_MARKET,
};

/** Build a valid GenLayerVerdict with the correct manifest hash. */
function makeVerdict(
  outcome: GenLayerVerdict["outcome"],
  overrides: Partial<GenLayerVerdict> = {},
): GenLayerVerdict {
  const isVoid = outcome === "VOID";
  const isUnresolved = outcome === "UNRESOLVED";
  return {
    market_id: MARKET_ID,
    manifest_hash: EXPECTED_MANIFEST_HASH,
    outcome,
    confidence: 85,
    sources_checked: ["https://www.fifa.com/2026"],
    evidence_summary: ["Match result confirmed"],
    reasoning: isUnresolved ? "" : "Clear evidence found.",
    void_reason: isVoid ? "Event was cancelled due to force majeure." : "",
    unresolved_reason: isUnresolved ? "Match has not yet been played." : "",
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const db = prisma as unknown as {
  market: { findMany: jest.Mock };
  settlement: { findMany: jest.Mock; update: jest.Mock; create: jest.Mock; upsert: jest.Mock };
};

const gl = genlayer as jest.Mocked<typeof genlayer>;

/** Return all settlement.update calls that set a particular status. */
function updatesWithStatus(status: string) {
  return (db.settlement.update as jest.Mock).mock.calls.filter(
    ([arg]) => arg?.data?.status === status,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // No new expired markets to queue — tests work with in-flight settlements.
  db.market.findMany.mockResolvedValue([]);
  db.settlement.findMany.mockResolvedValue([{ ...MOCK_SETTLEMENT }]);
  db.settlement.update.mockResolvedValue({});
  db.settlement.create.mockResolvedValue({});

  // GenLayer: fresh market (not registered yet), all txs succeed.
  gl.getRegisteredMarket.mockResolvedValue(null);
  gl.registerMarket.mockResolvedValue({ status: "SUCCESS", hash: "0xreg_tx_hash" });
  gl.resolveMarket.mockResolvedValue({ status: "SUCCESS", hash: "0xresolve_tx_hash" });
  gl.getResolutionStatus.mockResolvedValue("terminal");

  // Arc: mock viem — market is Active (status=0), proposeResolution returns hash.
  mockReadContract.mockResolvedValue(0n);
  mockWriteContract.mockResolvedValue("0xarc_propose_tx_hash");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Resolver Pipeline — manifest building and hashing", () => {
  it("produces a sha256: prefixed hash", () => {
    expect(EXPECTED_MANIFEST_HASH).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("manifest includes the market_id and arc_market_address", () => {
    const manifest = buildResolutionManifest(MOCK_MARKET);
    expect(manifest.market_id).toBe(MARKET_ID);
    expect(manifest.arc_market_address).toBe(ARC_ADDRESS);
  });

  it("identical market data always produces the same hash", () => {
    const hashA = hashResolutionManifestString(
      canonicalStringify(buildResolutionManifest(MOCK_MARKET)),
    );
    const hashB = hashResolutionManifestString(
      canonicalStringify(buildResolutionManifest({ ...MOCK_MARKET })),
    );
    expect(hashA).toBe(hashB);
  });
});

describe("Resolver Pipeline — YES outcome", () => {
  it("registers manifest, resolves via GenLayer, verifies hash, proposes OUTCOME.YES (2) on Arc", async () => {
    gl.getResolution.mockResolvedValue(makeVerdict("YES"));

    const result = await runResolverTick();

    // GenLayer side
    expect(gl.registerMarket).toHaveBeenCalledWith(
      MARKET_ID,
      expect.any(String),  // manifestJson
      EXPECTED_MANIFEST_HASH,
    );
    expect(gl.resolveMarket).toHaveBeenCalledWith(MARKET_ID);
    expect(gl.getResolution).toHaveBeenCalledWith(MARKET_ID);

    // Arc side — proposeResolution called with OUTCOME.YES = 2
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "proposeResolution",
        args: [2],
      }),
    );

    // Pipeline result
    expect(result.proposedOnArc).toBe(1);
    expect(result.steps[0].type).toBe("proposed_settlement");
    expect(updatesWithStatus("proposed_on_arc")).toHaveLength(1);
  });
});

describe("Resolver Pipeline — NO outcome", () => {
  it("proposes OUTCOME.NO (1) on Arc", async () => {
    gl.getResolution.mockResolvedValue(makeVerdict("NO"));

    const result = await runResolverTick();

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "proposeResolution",
        args: [1],
      }),
    );
    expect(result.proposedOnArc).toBe(1);
    expect(updatesWithStatus("proposed_on_arc")).toHaveLength(1);
  });
});

describe("Resolver Pipeline — manifest_mismatch", () => {
  it("blocks settlement when verdict manifest_hash does not match expected hash", async () => {
    // Verdict returns a DIFFERENT manifest hash than what the pipeline computed.
    gl.getResolution.mockResolvedValue(
      makeVerdict("YES", { manifest_hash: "sha256:" + "f".repeat(64) }),
    );

    const result = await runResolverTick();

    // Arc must NOT be called.
    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(result.proposedOnArc).toBe(0);

    // Settlement must be set to manifest_mismatch.
    expect(updatesWithStatus("manifest_mismatch")).toHaveLength(1);

    const step = result.steps[0];
    expect(step.type).toBe("invalid_verdict");
    expect((step as { reason: string }).reason).toMatch(/manifest.hash/i);
  });

  it("blocks settlement when on-chain registration has a different hash", async () => {
    // Simulates a market whose manifest was changed after first registration.
    gl.getRegisteredMarket.mockResolvedValue({
      manifestHash: "sha256:" + "e".repeat(64),
      manifestJson: "{}",
    });

    const result = await runResolverTick();

    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(updatesWithStatus("manifest_mismatch")).toHaveLength(1);
    expect(result.steps[0].type).toBe("invalid_verdict");
  });
});

describe("Resolver Pipeline — UNRESOLVED outcome", () => {
  it("sets retry_later, does NOT settle Arc", async () => {
    gl.getResolution.mockResolvedValue(makeVerdict("UNRESOLVED"));

    const result = await runResolverTick();

    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(result.proposedOnArc).toBe(0);
    expect(updatesWithStatus("retry_later")).toHaveLength(1);

    const retryCall = updatesWithStatus("retry_later")[0][0] as {
      data: { sources: { attemptStatus: string } };
    };
    expect(retryCall.data.sources.attemptStatus).toBe("UNRESOLVED_RETRY_LATER");

    expect(result.steps[0].type).toBe("pending");
  });
});

describe("Resolver Pipeline — INVALID outcome", () => {
  it("sets retry_later with INVALID_NEEDS_RETRY, does NOT settle Arc", async () => {
    gl.getResolution.mockResolvedValue(makeVerdict("INVALID"));

    const result = await runResolverTick();

    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(result.proposedOnArc).toBe(0);
    expect(updatesWithStatus("retry_later")).toHaveLength(1);

    const retryCall = updatesWithStatus("retry_later")[0][0] as {
      data: { sources: { attemptStatus: string } };
    };
    expect(retryCall.data.sources.attemptStatus).toBe("INVALID_NEEDS_RETRY");
  });
});

describe("Resolver Pipeline — VOID outcome", () => {
  it("sets blocked with VOID_BLOCKED_NO_REFUND_PATH, does NOT settle Arc", async () => {
    gl.getResolution.mockResolvedValue(makeVerdict("VOID"));

    const result = await runResolverTick();

    expect(mockWriteContract).not.toHaveBeenCalled();
    expect(result.proposedOnArc).toBe(0);

    // Settlement must be blocked, not retry_later and NOT proposed_on_arc.
    expect(updatesWithStatus("blocked")).toHaveLength(1);
    expect(updatesWithStatus("proposed_on_arc")).toHaveLength(0);

    const blockedCall = updatesWithStatus("blocked")[0][0] as {
      data: { resolution: string; sources: { attemptStatus: string } };
    };
    expect(blockedCall.data.resolution).toBe("VOID");
    expect(blockedCall.data.sources.attemptStatus).toBe("VOID_BLOCKED_NO_REFUND_PATH");

    const step = result.steps[0];
    expect(step.type).toBe("invalid_verdict");
    expect((step as { reason: string }).reason).toMatch(/VOID/i);
  });

  it("VOID is never silently mapped to NO", async () => {
    gl.getResolution.mockResolvedValue(makeVerdict("VOID"));

    await runResolverTick();

    // proposeResolution must never be called with arg 1 (NO).
    const noCalls = mockWriteContract.mock.calls.filter(
      ([arg]) => JSON.stringify(arg?.args) === JSON.stringify([1]),
    );
    expect(noCalls).toHaveLength(0);
  });
});

describe("Resolver Pipeline — existing registered market (happy path)", () => {
  it("uses existing registration and proceeds to YES settlement", async () => {
    // Market already registered with the matching hash — no re-registration needed.
    gl.getRegisteredMarket.mockResolvedValue({
      manifestHash: EXPECTED_MANIFEST_HASH,
      manifestJson: canonicalStringify(buildResolutionManifest(MOCK_MARKET)),
    });
    gl.getResolution.mockResolvedValue(makeVerdict("YES"));

    const result = await runResolverTick();

    // register_market should NOT be called again.
    expect(gl.registerMarket).not.toHaveBeenCalled();
    expect(result.proposedOnArc).toBe(1);
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [2] }),
    );
  });
});
