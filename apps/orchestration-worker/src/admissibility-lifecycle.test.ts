import { abi as genlayerAbi } from "genlayer-js";
import type { DebugTraceResult, GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { bytesToHex, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { classifyAdmissibility, createStudioAdmissibilityClient, submitAdmissibilityOnce, type AdmissibilityOperation, type AdmissibilityStore } from "./admissibility-lifecycle";

const txId = `0x${"12".repeat(32)}` as TransactionHash;
const contract = `0x${"34".repeat(20)}` as Address;
const trace = (value: string): DebugTraceResult => ({ transaction_id: txId, result_code: 1, return_data: bytesToHex(genlayerAbi.calldata.encode(value)), stdout: "", stderr: "", genvm_log: [], storage_proof: "", run_time: "0", eq_outputs: [], });
const tx = (state: "decided" | "finalized", execution = "FINISHED_WITH_RETURN"): GenLayerTransaction => ({ txId, recipient: contract, lifecycle: { state }, statusName: state === "finalized" ? "FINALIZED" : "ACCEPTED", txExecutionResultName: execution } as GenLayerTransaction);

describe("GenLayer admissibility side effects", () => {
  it("encodes assess with proposal identity and persists one external transaction", async () => {
    let state: AdmissibilityOperation | null = null;
    const store: AdmissibilityStore = { createIfAbsent: async (v) => state ??= v, load: async () => state, claimSubmission: async () => true, persistSubmission: async (_key, id) => { state = { ...state!, txId: id, lifecycle: "SUBMITTED" }; }, persistObservation: async () => undefined };
    const client = { writeContract: vi.fn(async () => ({ hash: txId })), getTransaction: vi.fn(), debugTraceTransaction: vi.fn() };
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "proposal-1", contract, manifest: "{}" })).resolves.toBe(txId);
    expect(client.writeContract).toHaveBeenCalledWith({ address: contract, functionName: "assess", args: ["proposal-1", "{}"] });
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "proposal-1", contract, manifest: "{}" })).resolves.toBe(txId);
    expect(client.writeContract).toHaveBeenCalledTimes(1);
  });
  it("does not make Accepted or failed execution attestable", () => {
    expect(classifyAdmissibility(tx("decided"))).toMatchObject({ lifecycle: "ACCEPTED", attestable: false });
    expect(classifyAdmissibility(tx("finalized", "ERROR"), trace("APPROVED"))).toMatchObject({ lifecycle: "FAILED", attestable: false });
  });
  it("fails closed unless the Studio Dev signer and contract are configured", () => {
    expect(() => createStudioAdmissibilityClient({ GENLAYER_RPC: "https://studio-dev.genlayer.com/api" })).toThrow("signer");
    expect(() => createStudioAdmissibilityClient({ GENLAYER_RPC: "https://example.invalid", GENLAYER_PRIVATE_KEY: `0x${"11".repeat(32)}` })).toThrow("network");
  });
  it("does not blindly resubmit after an accepted submission loses local persistence", async () => {
    let state: AdmissibilityOperation | null = null;
    let submissions = 0;
    let claims = 0;
    const store: AdmissibilityStore = {
      createIfAbsent: async (value) => state ??= { ...value, lifecycle: "SUBMITTING" },
      load: async () => state,
      claimSubmission: async () => { claims += 1; return claims === 1; },
      persistSubmission: async () => { throw new Error("process crashed before tx persistence"); },
      persistObservation: async () => undefined,
    };
    const client = { writeContract: vi.fn(async () => { submissions += 1; return { hash: txId }; }), getTransaction: vi.fn(), debugTraceTransaction: vi.fn() };
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "crash-window", contract, manifest: "{}" })).rejects.toThrow("persistence");
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "crash-window", contract, manifest: "{}" })).rejects.toThrow("already owned");
    expect(submissions).toBe(1);
  });
  for (const decision of ["APPROVED", "NEEDS_REVISION", "REJECTED"] as const) it(`accepts finalized successful ${decision}`, () => expect(classifyAdmissibility(tx("finalized"), trace(decision))).toMatchObject({ lifecycle: "FINALIZED", decision, attestable: true }));
});
