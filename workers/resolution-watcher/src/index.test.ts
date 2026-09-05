import { abi as genlayerAbi } from "genlayer-js";
import type { GenLayerTransaction } from "genlayer-js/types";
import { bytesToHex, keccak256, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { assertWatcherEligible, type ResolutionEnvelope } from "./index";

const txId = `0x${"11".repeat(32)}` as Hex;
const resolver = `0x${"22".repeat(20)}` as Hex;
const returnData = bytesToHex(genlayerAbi.calldata.encode("YES"));
const envelope: ResolutionEnvelope = {
  marketId: `0x${"33".repeat(32)}`, baseMarket: `0x${"44".repeat(20)}`,
  baseChainId: 84532, resolver, genlayerChainId: 61997, genlayerTxId: txId,
  manifestHash: `0x${"55".repeat(32)}`, resolverReleaseId: `0x${"66".repeat(32)}`,
  attempt: 0, outcome: 0, resultCommitment: keccak256(returnData), gateway: `0x${"77".repeat(20)}`,
};
const finalized = {
  txId, recipient: resolver, lifecycle: { state: "finalized", outcome: "accepted" },
  status: 7, statusName: "FINALIZED", txExecutionResult: 1,
  txExecutionResultName: "FINISHED_WITH_RETURN",
} as GenLayerTransaction;
const trace = { result_code: 1, return_data: returnData, stderr: "" };

describe("watcher finality gate", () => {
  it("accepts only finalized successful execution", () => expect(() => assertWatcherEligible(finalized, trace, envelope)).not.toThrow());
  it.each(["processing", "decided"])("rejects %s lifecycle", (state) => {
    const tx = { ...finalized, lifecycle: state === "processing" ? { state, phase: "pending" } : { state, outcome: "accepted" } } as GenLayerTransaction;
    expect(() => assertWatcherEligible(tx, trace, envelope)).toThrow("not finalized");
  });
  it("rejects finalized failed execution", () => {
    const tx = { ...finalized, txExecutionResult: 2, txExecutionResultName: "FINISHED_WITH_ERROR" } as GenLayerTransaction;
    expect(() => assertWatcherEligible(tx, trace, envelope)).toThrow("not successful");
  });
  it("rejects wrong resolver", () => expect(() => assertWatcherEligible(finalized, trace, { ...envelope, resolver: `0x${"88".repeat(20)}` })).toThrow("wrong resolver"));
  it("rejects wrong transaction", () => expect(() => assertWatcherEligible(finalized, trace, { ...envelope, genlayerTxId: `0x${"99".repeat(32)}` })).toThrow("wrong transaction"));
  it("rejects altered outcome", () => expect(() => assertWatcherEligible(finalized, trace, { ...envelope, outcome: 1 })).toThrow("altered outcome"));
  it("rejects failed trace", () => expect(() => assertWatcherEligible(finalized, { ...trace, result_code: 2 }, envelope)).toThrow("trace was not successful"));
  it("rejects wrong commitment", () => expect(() => assertWatcherEligible(finalized, trace, { ...envelope, resultCommitment: `0x${"aa".repeat(32)}` })).toThrow("wrong result commitment"));
});
