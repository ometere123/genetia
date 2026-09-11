import { abi as genlayerAbi } from "genlayer-js";
import type { DebugTraceResult, GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { bytesToHex, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { classifyFinality, followPersistedTransaction, resolutionIdempotencyKey, submitOnce, type AttemptStore, type ResolutionAttemptState } from "./genlayer-lifecycle.js";

const txId = (`0x${"12".repeat(32)}`) as TransactionHash;
const resolver = (`0x${"34".repeat(20)}`) as Address;
const encoded = (value: string) => bytesToHex(genlayerAbi.calldata.encode(value));
const trace = (value: string, patch: Partial<DebugTraceResult> = {}): DebugTraceResult => ({
  transaction_id: txId, result_code: 1, return_data: encoded(value), stdout: "", stderr: "", genvm_log: [], storage_proof: "", run_time: "0", eq_outputs: [], ...patch,
});
const transaction = (state: "pending" | "decided" | "finalized", execution = "FINISHED_WITH_RETURN"): GenLayerTransaction => ({
  txId,
  recipient: resolver,
  lifecycle: { state },
  statusName: state === "finalized" ? "FINALIZED" : state === "decided" ? "ACCEPTED" : "PENDING",
  txExecutionResultName: execution,
} as GenLayerTransaction);

describe("Studio Dev finality boundary", () => {
  it("Accepted only cannot settle Base", () => expect(classifyFinality(transaction("decided"))).toMatchObject({ lifecycle: "ACCEPTED", attestable: false }));
  it("Accepted plus execution error cannot settle Base", () => expect(classifyFinality(transaction("decided", "ERROR"))).toMatchObject({ attestable: false }));
  it("Finalized plus failed execution cannot settle Base", () => expect(classifyFinality(transaction("finalized", "ERROR"), trace("YES"))).toMatchObject({ lifecycle: "FAILED", attestable: false }));
  for (const outcome of ["YES", "NO", "VOID"] as const) {
    it(`Finalized plus successful ${outcome} is attestable`, () => expect(classifyFinality(transaction("finalized"), trace(outcome))).toEqual({
      lifecycle: "FINALIZED", executionStatus: "FINISHED_WITH_RETURN", outcome, attestable: true,
    }));
  }
  it("treats UNRESOLVED as successful nonterminal evidence", () => expect(classifyFinality(transaction("finalized"), trace("UNRESOLVED"))).toEqual({
    lifecycle: "FINALIZED", executionStatus: "FINISHED_WITH_RETURN", outcome: "UNRESOLVED", attestable: false,
  }));
  it("Finalized execution with a failed GenVM trace cannot settle Base", () => expect(classifyFinality(transaction("finalized"), trace("YES", { result_code: 0 }))).toMatchObject({ lifecycle: "FAILED", attestable: false }));
});

describe("restart-safe transaction persistence", () => {
  it("derives one stable key for every market attempt", () => {
    expect(resolutionIdempotencyKey("market-1", 0)).toBe("resolution:market-1:attempt:0");
    expect(resolutionIdempotencyKey("market-1", 0)).toBe(resolutionIdempotencyKey("market-1", 0));
  });

  it("persists the returned ID immediately and resumes that same ID", async () => {
    let state: ResolutionAttemptState | null = null;
    const store: AttemptStore = {
      load: async () => state,
      createIfAbsent: async (initial) => state ??= initial,
      persistSubmission: async (_key, hash, submittedAt) => { state = { ...state!, genlayerTxId: hash, submittedAt, lifecycle: "SUBMITTED" }; },
      persistObservation: async (_key, patch) => { state = { ...state!, ...patch }; },
    };
    const client = {
      writeContract: vi.fn(async () => ({ hash: txId })),
      getTransaction: vi.fn(async () => transaction("finalized")),
      debugTraceTransaction: vi.fn(async () => trace("YES")),
    };
    const submission = { idempotencyKey: "market:attempt:0", resolver, marketId: "market-1", attempt: 0 };
    expect(await submitOnce(client, store, submission)).toBe(txId);
    expect(await submitOnce(client, store, submission)).toBe(txId);
    expect(client.writeContract).toHaveBeenCalledTimes(1);
    expect(client.writeContract).toHaveBeenCalledWith({ address: resolver, functionName: "resolve", args: ["market-1", 0n] });
    expect((await followPersistedTransaction(client, store, "market:attempt:0")).txId).toBe(txId);
    expect(client.getTransaction).toHaveBeenCalledWith({ hash: txId });
  });

  it("does not allow a second durable claimant to submit", async () => {
    let state: ResolutionAttemptState | null = null;
    let claimed = false;
    const store: AttemptStore = {
      load: async () => state,
      createIfAbsent: async (initial) => state ??= initial,
      claimSubmission: async () => { if (claimed) return false; claimed = true; return true; },
      persistSubmission: async (_key, hash, submittedAt) => { state = { ...state!, genlayerTxId: hash, submittedAt, lifecycle: "SUBMITTED" }; },
      persistObservation: async (_key, patch) => { state = { ...state!, ...patch }; },
    };
    const client = { writeContract: vi.fn(async () => ({ hash: txId })), getTransaction: vi.fn(), debugTraceTransaction: vi.fn() };
    const submission = { idempotencyKey: "market:attempt:1", resolver, marketId: "market-1", attempt: 1 };
    await expect(submitOnce(client, store, submission)).resolves.toBe(txId);
    const second = await submitOnce(client, store, submission);
    expect(second).toBe(txId);
    expect(client.writeContract).toHaveBeenCalledTimes(1);
  });
});
