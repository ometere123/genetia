import { describe, expect, it } from "vitest";
import { scheduledReconciliationJobs } from "./scheduler-jobs";

describe("Supabase Cron tick scheduling", () => {
  it("creates stable lifecycle and Base index jobs for the same tick", () => {
    expect(scheduledReconciliationJobs("tick-123", "46703768")).toEqual([
      { kind: "reconcile-due-markets", idempotencyKey: "reconcile:tick-123" },
      { kind: "base-index", chainId: 84532, fromBlock: "46703768", idempotencyKey: "base-index:tick-123" },
    ]);
    expect(scheduledReconciliationJobs("reconcile:tick-123", "46703768")[0]).toEqual({ kind: "reconcile-due-markets", idempotencyKey: "reconcile:tick-123" });
  });

  it("rejects missing scheduler identity and malformed deployment block", () => {
    expect(() => scheduledReconciliationJobs("", "46703768")).toThrow("scheduler tick");
    expect(() => scheduledReconciliationJobs("tick", "../../unsafe")).toThrow("deployment block");
  });
});
