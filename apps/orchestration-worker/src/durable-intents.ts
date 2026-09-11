import { QueueJobSchema, type QueueJob } from "./queue-jobs";

export type IntentState = "PENDING" | "CLAIMED" | "DISPATCHED" | "RETRY";

export interface DurableIntent {
  idempotencyKey: string;
  payload: QueueJob;
  state: IntentState;
  leaseUntil?: number;
  attempts: number;
}

export interface DurableIntentStore {
  load(idempotencyKey: string): Promise<DurableIntent | null>;
  listDue(now: number): Promise<DurableIntent[]>;
  /** Must be atomic in the database: only one live lease may be granted. */
  claim(idempotencyKey: string, now: number, leaseMs: number): Promise<boolean>;
  markDispatched(idempotencyKey: string): Promise<void>;
  markRetry(idempotencyKey: string, nextRunAt: number, error: string): Promise<void>;
}

export interface DurableQueue {
  send(payload: QueueJob): Promise<void>;
}

export function proposalAdmissibilityIntent(proposalId: string): DurableIntent {
  if (!proposalId) throw new Error("proposal id required");
  const idempotencyKey = `admissibility:${proposalId}`;
  return {
    idempotencyKey,
    payload: { kind: "market-admissibility", proposalId, idempotencyKey },
    state: "PENDING",
    attempts: 0,
  };
}

/**
 * Dispatches a persisted outbox intent. Queue delivery is deliberately not
 * treated as financial completion; the consumer must claim and execute the
 * workflow from authoritative state. A crash after send and before
 * markDispatched is safe because the deterministic consumer key makes the
 * duplicate harmless and reconciliation can retry the intent.
 */
export async function dispatchIntent(store: DurableIntentStore, queue: DurableQueue, intent: DurableIntent, now = Date.now(), leaseMs = 60_000): Promise<"dispatched" | "duplicate" | "busy"> {
  const payload = QueueJobSchema.parse(intent.payload);
  if (payload.idempotencyKey !== intent.idempotencyKey) throw new Error("intent key does not match payload");
  const current = await store.load(intent.idempotencyKey);
  if (current?.state === "DISPATCHED") return "duplicate";
  if (!(await store.claim(intent.idempotencyKey, now, leaseMs))) return "busy";
  try {
    await queue.send(payload);
    await store.markDispatched(intent.idempotencyKey);
    return "dispatched";
  } catch (error) {
    await store.markRetry(intent.idempotencyKey, now + 60_000, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function reconcileIntents(store: DurableIntentStore, queue: DurableQueue, now = Date.now()): Promise<number> {
  let dispatched = 0;
  for (const intent of await store.listDue(now)) {
    if (await dispatchIntent(store, queue, intent, now) === "dispatched") dispatched++;
  }
  return dispatched;
}
