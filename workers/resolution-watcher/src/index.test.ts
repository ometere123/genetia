import { abi as genlayerAbi } from "genlayer-js";
import { readFileSync } from "node:fs";
import type { GenLayerTransaction } from "genlayer-js/types";
import { bytesToHex, type Hex } from "viem";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assertWatcherEligible, attestWithClient, canonicalEvidenceCommitment, canonicalResolverResultCommitment, canonicalResolverResultJson, stableEvidenceJson, type FinalizedResolverState, type ResolutionEnvelope } from "./index";

const txId = `0x${"11".repeat(32)}` as Hex;
const resolver = `0x${"22".repeat(20)}` as Hex;
const returnData = bytesToHex(genlayerAbi.calldata.encode("YES"));
const finalizedState: FinalizedResolverState = {
  marketId: `0x${"33".repeat(32)}`, baseMarket: `0x${"44".repeat(20)}`, manifestHash: `0x${"55".repeat(32)}`, resolverReleaseId: `0x${"66".repeat(32)}`,
  attempt: 0, outcome: "YES", evidence: [{ identity: "source-a", url: "https://example.com/a", contentHash: `0x${"88".repeat(32)}` }], resolverResultCommitment: `0x${"00".repeat(32)}`, result: { terminal: true },
};
const envelopeBase: Omit<ResolutionEnvelope, "resultCommitment"> = {
  marketId: `0x${"33".repeat(32)}`, baseMarket: `0x${"44".repeat(20)}`,
  baseChainId: 84532, resolver, genlayerChainId: 61997, genlayerTxId: txId,
  manifestHash: `0x${"55".repeat(32)}`, resolverReleaseId: `0x${"66".repeat(32)}`,
  attempt: 0, outcome: 0, evidenceCommitment: `0x${"00".repeat(32)}`, gateway: `0x${"77".repeat(20)}`,
};
let envelope: ResolutionEnvelope;
const finalized = {
  txId, recipient: resolver, lifecycle: { state: "finalized", outcome: "accepted" },
  status: 7, statusName: "FINALIZED", txExecutionResult: 1,
  txExecutionResultName: "FINISHED_WITH_RETURN",
  data: { calldata: { raw: Array.from(genlayerAbi.calldata.encode(genlayerAbi.calldata.makeCalldataObject("resolve", [finalizedState.marketId, 0], {}))) } },
} as GenLayerTransaction;

describe("watcher finality gate", () => {
  beforeAll(async () => { const evidenceCommitment = await canonicalEvidenceCommitment(finalizedState); finalizedState.resolverResultCommitment = await canonicalResolverResultCommitment(finalizedState, envelopeBase.baseMarket); envelope = { ...envelopeBase, evidenceCommitment, resultCommitment: finalizedState.resolverResultCommitment }; });
  it("accepts only finalized successful execution with decoded resolve arguments", async () => await expect(assertWatcherEligible(finalized, finalizedState, envelope)).resolves.toBeUndefined());
  it.each(["processing", "decided"])("rejects %s lifecycle", async (state) => {
    const tx = { ...finalized, lifecycle: state === "processing" ? { state, phase: "pending" } : { state, outcome: "accepted" } } as GenLayerTransaction;
    await expect(assertWatcherEligible(tx, finalizedState, envelope)).rejects.toThrow("not finalized");
  });
  it("rejects finalized failed execution", async () => {
    const tx = { ...finalized, txExecutionResult: 2, txExecutionResultName: "FINISHED_WITH_ERROR" } as GenLayerTransaction;
    await expect(assertWatcherEligible(tx, finalizedState, envelope)).rejects.toThrow("not successful");
  });
  it("rejects wrong resolver", async () => await expect(assertWatcherEligible(finalized, finalizedState, { ...envelope, resolver: `0x${"88".repeat(20)}` })).rejects.toThrow("wrong resolver"));
  it("rejects wrong transaction", async () => await expect(assertWatcherEligible(finalized, finalizedState, { ...envelope, genlayerTxId: `0x${"99".repeat(32)}` })).rejects.toThrow("wrong transaction"));
  it("rejects altered outcome", async () => await expect(assertWatcherEligible(finalized, finalizedState, { ...envelope, outcome: 1 })).rejects.toThrow("wrong resolver result"));
  it("rejects wrong commitment", async () => await expect(assertWatcherEligible(finalized, finalizedState, { ...envelope, resultCommitment: `0x${"aa".repeat(32)}` })).rejects.toThrow("wrong result commitment"));
  it.each([
    ["marketId", { marketId: `0x${"aa".repeat(32)}` }],
    ["baseMarket", { baseMarket: `0x${"aa".repeat(20)}` }],
    ["baseChainId", { baseChainId: 1 }],
    ["genlayerChainId", { genlayerChainId: 1 }],
    ["resolver", { resolver: `0x${"aa".repeat(20)}` }],
    ["resolverReleaseId", { resolverReleaseId: `0x${"aa".repeat(32)}` }],
    ["genlayerTxId", { genlayerTxId: `0x${"aa".repeat(32)}` }],
    ["manifestHash", { manifestHash: `0x${"aa".repeat(32)}` }],
    ["attempt", { attempt: 1 }],
    ["outcome", { outcome: 1 }],
    ["evidenceCommitment", { evidenceCommitment: `0x${"aa".repeat(32)}` }],
    ["resultCommitment", { resultCommitment: `0x${"aa".repeat(32)}` }],
  ])("rejects mutation of signed %s field", async (_field, mutation) => {
    await expect(assertWatcherEligible(finalized, finalizedState, { ...envelope, ...mutation } as ResolutionEnvelope)).rejects.toThrow();
  });
});

describe("production attest state acquisition", () => {
  it("reads finalized binding and attempt state instead of trusting trace or caller state", async () => {
    const readContract = vi.fn(async ({ functionName }: Record<string, unknown>) => {
      if (functionName === "get_binding_state") return JSON.stringify({ market_id: finalizedState.marketId, base_market: finalizedState.baseMarket, manifest_hash: finalizedState.manifestHash, resolver_release_id: finalizedState.resolverReleaseId, status: "RESOLVED" });
      if (functionName === "get_attempt") return JSON.stringify({ attempt: finalizedState.attempt, outcome: finalizedState.outcome, evidence: finalizedState.evidence.map((item) => ({ identity: item.identity, url: item.url, content_hash: item.contentHash.slice(2) })), evidence_commitment: envelope.evidenceCommitment, result_commitment: finalizedState.resolverResultCommitment });
      throw new Error("unexpected resolver method");
    });
    const client = {
      getTransaction: vi.fn(async () => finalized),
      readContract,
    };
    const result = await attestWithClient(envelope, { WATCHER_ID: "watcher-test", WATCHER_PRIVATE_KEY: `0x${"aa".repeat(32)}` as Hex, GENLAYER_RPC: "https://studio-dev.genlayer.com/api" }, client);
    expect(result.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(client.getTransaction).toHaveBeenCalledWith({ hash: txId });
    expect(readContract).toHaveBeenCalledTimes(2);
    expect(readContract.mock.calls.map(([call]) => call.functionName)).toEqual(["get_binding_state", "get_attempt"]);
    expect(readContract.mock.calls.every(([call]) => call.transactionHashVariant === "latest-final")).toBe(true);
  });

  it("rejects when finalized resolver state contradicts the caller envelope", async () => {
    const client = {
      getTransaction: vi.fn(async () => finalized),
      readContract: vi.fn(async ({ functionName }: Record<string, unknown>) => functionName === "get_binding_state"
        ? JSON.stringify({ market_id: finalizedState.marketId, base_market: `0x${"99".repeat(20)}`, manifest_hash: finalizedState.manifestHash, resolver_release_id: finalizedState.resolverReleaseId, status: "RESOLVED" })
        : JSON.stringify({ attempt: 0, outcome: "YES", evidence: [], evidence_commitment: envelope.evidenceCommitment, result_commitment: envelope.resultCommitment })),
    };
    await expect(attestWithClient(envelope, { WATCHER_ID: "watcher-test", WATCHER_PRIVATE_KEY: `0x${"aa".repeat(32)}` as Hex, GENLAYER_RPC: "https://studio-dev.genlayer.com/api" }, client)).rejects.toThrow("wrong base market state");
  });
});

describe("cross-language commitment vector", () => {
  const vector = JSON.parse(readFileSync(new URL("../../../contracts/genlayer/commitment_vector.json", import.meta.url), "utf8")) as Record<string, any>;
  const state: FinalizedResolverState = { marketId: vector.market_id, baseMarket: vector.base_market, manifestHash: vector.manifest_hash, resolverReleaseId: vector.resolver_release_id, attempt: vector.attempt, outcome: vector.outcome, evidence: vector.evidence.map((item: { identity: string; url: string; content_hash: string }) => ({ identity: item.identity, url: item.url, contentHash: item.content_hash as Hex })), resolverResultCommitment: vector.result_commitment, result: { terminal: true } };
  it("matches the locked canonical evidence JSON and SHA-256", async () => {
    expect(stableEvidenceJson(state)).toBe(vector.canonical_evidence_json);
    expect(await canonicalEvidenceCommitment(state)).toBe(vector.evidence_commitment);
    expect(canonicalResolverResultJson({ ...state, resolverResultCommitment: vector.evidence_commitment }, state.baseMarket)).toBe(vector.canonical_result_json);
    expect(await canonicalResolverResultCommitment(state, state.baseMarket)).toBe(vector.result_commitment);
  });
});
