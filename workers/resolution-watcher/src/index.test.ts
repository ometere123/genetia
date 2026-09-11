import { abi as genlayerAbi } from "genlayer-js";
import type { GenLayerTransaction } from "genlayer-js/types";
import { bytesToHex, type Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { assertWatcherEligible, canonicalEvidenceCommitment, canonicalResolverResultCommitment, stableEvidenceJson, type FinalizedResolverState, type ResolutionEnvelope } from "./index";

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
} as GenLayerTransaction;
const trace = { result_code: 1, return_data: returnData, stderr: "", finalizedState };

describe("watcher finality gate", () => {
  beforeAll(async () => { const evidenceCommitment = await canonicalEvidenceCommitment(finalizedState); finalizedState.resolverResultCommitment = await canonicalResolverResultCommitment(finalizedState, envelopeBase.baseMarket); envelope = { ...envelopeBase, evidenceCommitment, resultCommitment: finalizedState.resolverResultCommitment }; });
  it("accepts only finalized successful execution", async () => await expect(assertWatcherEligible(finalized, trace, envelope)).resolves.toBeUndefined());
  it.each(["processing", "decided"])("rejects %s lifecycle", async (state) => {
    const tx = { ...finalized, lifecycle: state === "processing" ? { state, phase: "pending" } : { state, outcome: "accepted" } } as GenLayerTransaction;
    await expect(assertWatcherEligible(tx, trace, envelope)).rejects.toThrow("not finalized");
  });
  it("rejects finalized failed execution", async () => {
    const tx = { ...finalized, txExecutionResult: 2, txExecutionResultName: "FINISHED_WITH_ERROR" } as GenLayerTransaction;
    await expect(assertWatcherEligible(tx, trace, envelope)).rejects.toThrow("not successful");
  });
  it("rejects wrong resolver", async () => await expect(assertWatcherEligible(finalized, trace, { ...envelope, resolver: `0x${"88".repeat(20)}` })).rejects.toThrow("wrong resolver"));
  it("rejects wrong transaction", async () => await expect(assertWatcherEligible(finalized, trace, { ...envelope, genlayerTxId: `0x${"99".repeat(32)}` })).rejects.toThrow("wrong transaction"));
  it("rejects altered outcome", async () => await expect(assertWatcherEligible(finalized, trace, { ...envelope, outcome: 1 })).rejects.toThrow("altered outcome"));
  it("rejects failed trace", async () => await expect(assertWatcherEligible(finalized, { ...trace, result_code: 2 }, envelope)).rejects.toThrow("trace was not successful"));
  it("rejects wrong commitment", async () => await expect(assertWatcherEligible(finalized, trace, { ...envelope, resultCommitment: `0x${"aa".repeat(32)}` })).rejects.toThrow("wrong result commitment"));
  it("rejects a trace-only commitment without finalized resolver state", async () => await expect(assertWatcherEligible(finalized, { result_code: 1, return_data: returnData, stderr: "" }, envelope)).rejects.toThrow("finalized resolver state is required"));
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
    await expect(assertWatcherEligible(finalized, trace, { ...envelope, ...mutation } as ResolutionEnvelope)).rejects.toThrow();
  });
});

describe("cross-language commitment vector", () => {
  const state = { marketId: "market-42" as Hex, baseMarket: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01" as Hex, manifestHash: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD" as Hex, resolverReleaseId: "0xDeFabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFabcDEFab" as Hex, attempt: 3, outcome: "YES" as const, evidence: [{ identity: "source-a", url: "https://a.example/z", contentHash: "0xABCDEFabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefABCD" as Hex }, { identity: "source-a", url: "https://a.example/a", contentHash: "0x1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF" as Hex }], resolverResultCommitment: "0x00" as Hex, result: { terminal: true } };
  it("matches the locked canonical evidence JSON and SHA-256", async () => {
    expect(stableEvidenceJson(state)).toBe("[{\"content_hash\":\"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\",\"identity\":\"source-a\",\"url\":\"https://a.example/a\"},{\"content_hash\":\"abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd\",\"identity\":\"source-a\",\"url\":\"https://a.example/z\"}]");
    expect(await canonicalEvidenceCommitment(state)).toBe("0x8d4b401db887ec93ad8e96851f2f70313d8b3898b71ab3e063a605e767d0f8e6");
    expect(await canonicalResolverResultCommitment(state, state.baseMarket)).toBe("0x721dc060e1df53b6ec9bd912cfeb82fe19123c61f77b79c8251d535441bbfe1e");
  });
});
