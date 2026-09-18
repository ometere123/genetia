import { describe, expect, it } from "vitest";
import { classifyQueueError, expectedJobKey, validateQueueJob } from "./queue-jobs";
import { dispatchQueueJob, workflowId } from "./queue-dispatch";

describe("durable queue contracts", () => {
  it("validates every job before execution and derives stable identities", () => {
    const job = validateQueueJob({ kind: "resolution-due", marketId: "m1", attempt: 2, idempotencyKey: "job:m1:2" });
    expect(expectedJobKey(job)).toBe("genlayer:m1:attempt:2");
    expect(() => validateQueueJob({ kind: "resolution-due", marketId: "m1", attempt: 9 })).toThrow();
  });
  it("routes malformed/terminal work to DLQ and infrastructure failures to retry", () => {
    expect(classifyQueueError(new Error("malformed payload"))).toBe("dead-letter");
    expect(classifyQueueError(new Error("GenLayer RPC unavailable"))).toBe("retry");
  });

  it("creates one durable Workflow instance from a validated queue job", async () => {
    const calls: Array<{ id: string; params: unknown }> = [];
    const id = await dispatchQueueJob(
      { kind: "market-admissibility", proposalId: "p1", idempotencyKey: "admissibility:p1" },
      { GENETIA_WORKFLOWS: { create: async (options: { id: string; params: unknown }) => { calls.push(options); } } },
    );
    expect(id).toBe(workflowId({ kind: "market-admissibility", proposalId: "p1", idempotencyKey: "admissibility:p1" }));
    expect(id).toMatch(/^genetia-market-admissibility-[a-f0-9]{16}$/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe(id);
    expect(calls[0]?.params).toMatchObject({ proposalId: "p1", kind: "market-admissibility" });
  });

  it("treats a duplicate Workflow instance as successful delivery", async () => {
    const id = await dispatchQueueJob(
      { kind: "market-admissibility", proposalId: "p1", idempotencyKey: "admissibility:p1" },
      { GENETIA_WORKFLOWS: { create: async () => { throw new Error("instance already exists"); } } },
    );
    expect(id).toMatch(/^genetia-market-admissibility-[a-f0-9]{16}$/);
  });
});
