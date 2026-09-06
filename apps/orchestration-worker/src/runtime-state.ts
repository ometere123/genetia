export type WorkflowStage =
  | "PROPOSAL"
  | "ADMISSIBILITY"
  | "RESOLVER_DEPLOYMENT"
  | "BASE_BINDING"
  | "FUNDING"
  | "ACTIVE"
  | "RESOLUTION"
  | "FINALITY"
  | "WATCHER_COLLECTION"
  | "SETTLEMENT"
  | "TERMINAL"
  | "EXPIRED";

const order: readonly WorkflowStage[] = [
  "PROPOSAL", "ADMISSIBILITY", "RESOLVER_DEPLOYMENT", "BASE_BINDING", "FUNDING",
  "ACTIVE", "RESOLUTION", "FINALITY", "WATCHER_COLLECTION", "SETTLEMENT", "TERMINAL", "EXPIRED",
];

export function workflowIdempotencyKey(workflow: string, entityId: string): string {
  if (!workflow || !entityId) throw new Error("workflow identity is required");
  return `${workflow}:${entityId}`;
}

export function externalSubmissionKey(marketId: string, attempt: number): string {
  if (!marketId || !Number.isInteger(attempt) || attempt < 0) throw new Error("invalid external submission identity");
  return `genlayer:${marketId}:attempt:${attempt}`;
}

/** Five-minute deterministic reconciliation bucket; retries in one bucket coalesce. */
export function reconciliationKey(nowMs: number): string {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("invalid reconciliation time");
  return `reconcile:${Math.floor(nowMs / 300_000) * 300_000}`;
}

export function transitionStage(current: WorkflowStage, next: WorkflowStage): WorkflowStage {
  if (current === next) return current;
  if (current === "EXPIRED" || current === "TERMINAL") throw new Error("terminal workflow cannot transition");
  if (order.indexOf(next) !== order.indexOf(current) + 1) throw new Error(`invalid workflow transition ${current}->${next}`);
  return next;
}
