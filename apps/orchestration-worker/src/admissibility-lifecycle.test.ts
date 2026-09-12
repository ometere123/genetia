import { abi as genlayerAbi } from "genlayer-js";
import type { DebugTraceResult, GenLayerTransaction, TransactionHash } from "genlayer-js/types";
import { bytesToHex, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { classifyAdmissibility, createStudioAdmissibilityClient, followAdmissibility, submitAdmissibilityOnce, type AdmissibilityOperation, type AdmissibilityStore } from "./admissibility-lifecycle";

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
  it("recovers an accepted submission from Studio Dev address history after the local persistence crash", async () => {
    let state: AdmissibilityOperation | null = null;
    let submissions = 0;
    let persistAttempts = 0;
    const store: AdmissibilityStore = {
      createIfAbsent: async (value) => state ??= value,
      load: async () => state,
      claimSubmission: async () => { state = { ...state!, lifecycle: "SUBMITTING" }; return true; },
      persistSubmission: async (_key, id) => {
        persistAttempts += 1;
        if (persistAttempts === 1) throw new Error("process crashed before tx persistence");
        state = { ...state!, txId: id, lifecycle: "SUBMITTED" };
      },
      persistObservation: async () => undefined,
    };
    const client = { writeContract: vi.fn(async () => { submissions += 1; return { hash: txId }; }), findSubmission: vi.fn(async () => txId), getTransaction: vi.fn(), debugTraceTransaction: vi.fn() };
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "crash-window", contract, manifest: "{}" })).rejects.toThrow("persistence");
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "crash-window", contract, manifest: "{}" })).resolves.toBe(txId);
    expect(client.findSubmission).toHaveBeenCalledWith({ address: contract, proposalId: "crash-window" });
    expect(submissions).toBe(1);
  });
  it("keeps ambiguous SUBMITTING state in recovery instead of blindly submitting again", async () => {
    const state: AdmissibilityOperation = { proposalId: "ambiguous", operationId: "admissibility:ambiguous", lifecycle: "SUBMITTING" };
    const store: AdmissibilityStore = { createIfAbsent: async () => state, load: async () => state, claimSubmission: async () => false, persistSubmission: async () => undefined, persistObservation: async () => undefined, deferSubmissionRecovery: async () => undefined };
    const client = { writeContract: vi.fn(), findSubmission: vi.fn(async () => undefined), getTransaction: vi.fn(), debugTraceTransaction: vi.fn() };
    await expect(submitAdmissibilityOnce(client, store, { proposalId: "ambiguous", contract, manifest: "{}" })).rejects.toThrow("submission outcome is uncertain");
    expect(client.writeContract).not.toHaveBeenCalled();
  });
  for (const decision of ["APPROVED", "NEEDS_REVISION", "REJECTED"] as const) it(`accepts finalized successful ${decision}`, () => expect(classifyAdmissibility(tx("finalized"), trace(decision))).toMatchObject({ lifecycle: "FINALIZED", decision, attestable: true }));
  it("requires finalized get_assessment readback and persists its issue codes", async () => {
    let state: AdmissibilityOperation | null = { proposalId: "proposal-readback", operationId: "admissibility:proposal-readback", txId, lifecycle: "SUBMITTED" };
    let observation: Partial<AdmissibilityOperation> | undefined;
    const store: AdmissibilityStore = { createIfAbsent: async (v) => v, load: async () => state, persistSubmission: async () => undefined, persistObservation: async (_id, patch) => { observation = patch; state = { ...state!, ...patch }; } };
    const client = { writeContract: vi.fn(), getTransaction: vi.fn(async () => tx("finalized")), debugTraceTransaction: vi.fn(async () => trace("NEEDS_REVISION")), readAssessment: vi.fn(async () => JSON.stringify({ decision: "NEEDS_REVISION", issue_codes: ["AMBIGUOUS_SCOPE"] })) };
    await expect(followAdmissibility(client, store, "proposal-readback")).resolves.toMatchObject({ decision: "NEEDS_REVISION", issues: ["AMBIGUOUS_SCOPE"] });
    expect(client.readAssessment).toHaveBeenCalledWith({ address: contract, proposalId: "proposal-readback" });
    expect(observation).toMatchObject({ decision: "NEEDS_REVISION", issues: ["AMBIGUOUS_SCOPE"] });
  });
  it("uses finalized storage when Studio Dev does not expose the debug trace RPC", async () => {
    let state: AdmissibilityOperation | null = { proposalId: "proposal-no-trace", operationId: "admissibility:proposal-no-trace", txId, lifecycle: "SUBMITTED" };
    const store: AdmissibilityStore = { createIfAbsent: async (value) => value, load: async () => state, persistSubmission: async () => undefined, persistObservation: async (_id, patch) => { state = { ...state!, ...patch }; } };
    const client = { writeContract: vi.fn(), getTransaction: vi.fn(async () => tx("finalized")), debugTraceTransaction: vi.fn(async () => { throw new Error("Method not found: gen_dbg_traceTransaction"); }), readAssessment: vi.fn(async () => JSON.stringify({ decision: "APPROVED", issue_codes: [] })) };
    await expect(followAdmissibility(client, store, "proposal-no-trace")).resolves.toMatchObject({ lifecycle: "FINALIZED", decision: "APPROVED", issues: [], traceDecisionVerified: false });
    expect(client.readAssessment).toHaveBeenCalledWith({ address: contract, proposalId: "proposal-no-trace" });
    expect(state).toMatchObject({ lifecycle: "FINALIZED", decision: "APPROVED", issues: [] });
  });
});
