import { describe, expect, it } from "vitest";
import { classifyQueueError, expectedJobKey, validateQueueJob } from "./queue-jobs";

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
});
