import { describe, expect, it } from "vitest";
import { externalSubmissionKey, reconciliationKey, transitionStage, workflowIdempotencyKey } from "./runtime-state";

describe("durable workflow identity", () => {
  it("uses stable keys for workflow and external resolution submissions", () => {
    expect(workflowIdempotencyKey("proposal", "p1")).toBe("proposal:p1");
    expect(externalSubmissionKey("m1", 2)).toBe("genlayer:m1:attempt:2");
  });

  it("coalesces reconciliation retries inside one deterministic bucket", () => {
    expect(reconciliationKey(300_001)).toBe(reconciliationKey(599_999));
    expect(reconciliationKey(600_000)).not.toBe(reconciliationKey(599_999));
  });

  it("allows only adjacent durable stages and is idempotent", () => {
    expect(transitionStage("PROPOSAL", "ADMISSIBILITY")).toBe("ADMISSIBILITY");
    expect(transitionStage("ADMISSIBILITY", "ADMISSIBILITY")).toBe("ADMISSIBILITY");
    expect(() => transitionStage("PROPOSAL", "ACTIVE")).toThrow("invalid workflow transition");
    expect(() => transitionStage("TERMINAL", "EXPIRED")).toThrow("terminal workflow");
  });
});
