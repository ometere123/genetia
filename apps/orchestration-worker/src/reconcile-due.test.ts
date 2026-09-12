import { describe, expect, it, vi } from "vitest";
import { reconcileDueLifecycleIntents, type DueLifecycleIntent, type DueLifecycleStore } from "./reconcile-due";

const now = new Date("2026-09-12T03:00:00.000Z");
const dueAt = new Date("2026-09-12T02:00:00.000Z");
const row: DueLifecycleIntent = {
  idempotencyKey: "market-admissibility:proposal-1",
  nextRunAt: dueAt,
  payload: { kind: "market-admissibility", proposalId: "proposal-1", idempotencyKey: "proposal-1" },
};

function store(rows: DueLifecycleIntent[] = [row]) {
  return {
    claimDue: vi.fn(async () => rows),
    releaseForRetry: vi.fn(async () => undefined),
  } satisfies DueLifecycleStore & { claimDue: ReturnType<typeof vi.fn>; releaseForRetry: ReturnType<typeof vi.fn> };
}

describe("due lifecycle reconciliation", () => {
  it("redispatches a nonfinal operation with stable continuation identity", async () => {
    const db = store(); const send = vi.fn(async () => undefined);
    await expect(reconcileDueLifecycleIntents(db, { send }, now)).resolves.toEqual({ claimed: 1, dispatched: 1, failed: 0 });
    expect(send).toHaveBeenCalledWith({ kind: "market-admissibility", proposalId: "proposal-1", idempotencyKey: "market-admissibility:proposal-1:resume:2026-09-12T02:00:00.000Z" });
  });

  it("retries a queue failure without losing the persisted operation", async () => {
    const db = store(); const send = vi.fn(async () => { throw new Error("queue unavailable"); });
    await expect(reconcileDueLifecycleIntents(db, { send }, now)).resolves.toEqual({ claimed: 1, dispatched: 0, failed: 1 });
    expect(db.releaseForRetry).toHaveBeenCalledWith(row.idempotencyKey, new Date(now.getTime() + 60_000), "queue unavailable");
  });

  it("releases malformed persisted payloads for retry rather than dropping them", async () => {
    const db = store([{ ...row, payload: { kind: "market-admissibility" } }]); const send = vi.fn();
    await expect(reconcileDueLifecycleIntents(db, { send }, now)).resolves.toEqual({ claimed: 1, dispatched: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(db.releaseForRetry).toHaveBeenCalledOnce();
  });

  it("uses the same continuation ID for duplicate dispatch of one due row", async () => {
    const db = store(); const sent: unknown[] = []; const send = vi.fn(async (job) => { sent.push(job); });
    await reconcileDueLifecycleIntents(db, { send }, now);
    await reconcileDueLifecycleIntents(db, { send }, now);
    expect(sent[0]).toEqual(sent[1]);
  });
});
