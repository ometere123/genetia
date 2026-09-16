import type { QueueJob } from "./queue-jobs";

/** Supabase Cron is the sole scheduler; this function makes one authenticated
 * tick produce stable reconciliation and indexer queue identities. */
export function scheduledReconciliationJobs(tick: string, deploymentBlock: string): [QueueJob, QueueJob] {
  if (!tick.trim() || !/^\d+$/.test(deploymentBlock)) throw new Error("scheduler tick or Base deployment block is invalid");
  const reconciliationKey = tick.startsWith("reconcile:") ? tick : `reconcile:${tick}`;
  return [
    { kind: "reconcile-due-markets", idempotencyKey: reconciliationKey },
    { kind: "base-index", chainId: 84532, fromBlock: deploymentBlock, idempotencyKey: `base-index:${tick}` },
  ];
}
