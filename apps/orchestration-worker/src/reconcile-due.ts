import { validateQueueJob, type QueueJob } from "./queue-jobs";

export interface DueLifecycleIntent {
  idempotencyKey: string;
  nextRunAt: Date;
  payload: unknown;
}

export interface DueLifecycleStore {
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<DueLifecycleIntent[]>;
  releaseForRetry(idempotencyKey: string, retryAt: Date, error: string): Promise<void>;
}

export interface QueueSender { send(message: QueueJob): Promise<unknown> }

/**
 * Re-dispatches durable lifecycle rows whose observation window elapsed.
 * Queue delivery remains at-least-once; operation identity and WorkflowState
 * CAS/unique keys make every continuation converge on the same operation.
 */
export async function reconcileDueLifecycleIntents(
  store: DueLifecycleStore,
  queue: QueueSender,
  now = new Date(),
  limit = 100,
): Promise<{ claimed: number; dispatched: number; failed: number }> {
  const leaseUntil = new Date(now.getTime() + 5 * 60_000);
  const rows = await store.claimDue(now, leaseUntil, limit);
  let dispatched = 0;
  let failed = 0;

  for (const row of rows) {
    let original: QueueJob;
    try {
      const legacyProposalId = row.idempotencyKey.startsWith("admissibility:") ? row.idempotencyKey.slice("admissibility:".length) : null;
      const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
      original = validateQueueJob(payload.kind === "market-admissibility" ? payload : legacyProposalId ? { kind: "market-admissibility", proposalId: legacyProposalId, idempotencyKey: row.idempotencyKey } : row.payload);
    } catch {
      await store.releaseForRetry(row.idempotencyKey, new Date(now.getTime() + 60_000), "invalid persisted lifecycle payload");
      failed += 1;
      continue;
    }
    if (original.kind !== "market-admissibility") {
      await store.releaseForRetry(row.idempotencyKey, new Date(now.getTime() + 60_000), "unsupported due lifecycle kind");
      failed += 1;
      continue;
    }

    // Stable for duplicate Cron ticks racing over the same persisted dueAt.
    const resumeIdentity = `${row.idempotencyKey}:resume:${row.nextRunAt.toISOString()}`;
    try {
      await queue.send({ ...original, idempotencyKey: resumeIdentity });
      dispatched += 1;
    } catch (error) {
      await store.releaseForRetry(
        row.idempotencyKey,
        new Date(now.getTime() + 60_000),
        error instanceof Error ? error.message.slice(0, 300) : "queue dispatch failed",
      );
      failed += 1;
    }
  }

  return { claimed: rows.length, dispatched, failed };
}
